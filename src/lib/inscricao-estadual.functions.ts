import { createServerFn } from "@tanstack/react-start";

/**
 * Camada de serviço da consulta de Inscrição Estadual (IE) por CNPJ.
 * Desacoplada do cadastro de clientes: trocar de provedor no futuro exige
 * mudar apenas este arquivo.
 *
 * Fluxo: frontend -> esta função de servidor -> provedor fiscal.
 * Nenhuma credencial trafega ou aparece no frontend.
 *
 * Provedores (na ordem):
 *  1. Provedor genérico configurável — IE_API_URL (aceita {documento}),
 *     IE_API_KEY e IE_API_HEADER (padrão "Authorization"), IE_API_NOME.
 *  2. CNPJá — CNPJA_API_KEY (api.cnpja.com/office/{doc}?registrations=BR),
 *     que consulta os cadastros estaduais (SINTEGRA/SEFAZ).
 *  3. CNPJá aberto — sem chave; costuma não retornar cadastro estadual,
 *     usado apenas para confirmar a existência/UF do estabelecimento.
 */

export type RegistroFiscal = {
  inscricao: string;
  uf?: string | undefined;
  situacao?: string | undefined;
  /** SIM | NAO | ISENTO | undefined quando a fonte não informa. */
  contribuinte_icms?: string | undefined;
  /** Fonte declarou explicitamente isenção / não contribuinte. */
  isento?: boolean | undefined;
};

export type ConsultaIeResultado =
  | {
      ok: true;
      documento: string;
      provedor: string;
      uf_estabelecimento?: string | undefined;
      registros: RegistroFiscal[];
      /** Fonte informou explicitamente que não é contribuinte de ICMS. */
      isento: boolean;
      mensagem?: string | undefined;
      validadeDias: number;
    }
  | {
      ok: false;
      documento: string;
      codigo:
        | "invalido"
        | "nao_encontrado"
        | "sem_ie"
        | "indisponivel"
        | "limite"
        | "credencial"
        | "sem_provedor"
        | "incompleto";
      mensagem: string;
    };

const digitos = (v: string) => (v ?? "").replace(/\D+/g, "");

const txt = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

function cnpjValido(cnpj: string) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const dv = 11 - (soma % 11);
    return dv > 9 ? 0 : dv;
  };
  const base = cnpj.slice(0, 12);
  return calc(base) === Number(cnpj[12]) && calc(base + cnpj[12]) === Number(cnpj[13]);
}

/** Normaliza a IE: somente dígitos (algumas UFs usam letras, então preservamos alfanumérico). */
const normalizarIe = (v: string) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Formato CNPJá / SINTEGRA: office.registrations[] */
function mapCnpja(j: Record<string, unknown>): {
  registros: RegistroFiscal[];
  uf?: string | undefined;
  isento: boolean;
} {
  const endereco = (j["address"] ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(j["registrations"])
    ? (j["registrations"] as Record<string, unknown>[])
    : [];
  const registros: RegistroFiscal[] = [];
  for (const r of lista) {
    const numero = normalizarIe(String(r["number"] ?? ""));
    if (!numero) continue;
    const status = (r["status"] ?? {}) as Record<string, unknown>;
    const tipo = (r["type"] ?? {}) as Record<string, unknown>;
    registros.push({
      inscricao: numero,
      uf: txt(r["state"]),
      situacao: txt(status["text"]),
      contribuinte_icms: r["enabled"] === false ? "NAO" : "SIM",
      ...(txt(tipo["text"]) ? { isento: /isent/i.test(String(tipo["text"])) } : {}),
    });
  }
  return {
    registros,
    uf: txt(endereco["state"]),
    isento: registros.length === 0 && j["registrations"] !== undefined,
  };
}

/** Formato genérico: aceita várias formas comuns de retorno de provedores fiscais. */
function mapGenerico(j: Record<string, unknown>): {
  registros: RegistroFiscal[];
  uf?: string | undefined;
  isento: boolean;
} {
  if (Array.isArray(j["registrations"]) || j["taxId"]) return mapCnpja(j);

  const cand =
    (Array.isArray(j["inscricoes_estaduais"]) && (j["inscricoes_estaduais"] as unknown[])) ||
    (Array.isArray(j["inscricoes"]) && (j["inscricoes"] as unknown[])) ||
    (Array.isArray(j["data"]) && (j["data"] as unknown[])) ||
    null;

  const registros: RegistroFiscal[] = [];
  if (cand) {
    for (const item of cand as Record<string, unknown>[]) {
      const numero = normalizarIe(
        String(item["inscricao_estadual"] ?? item["inscricao"] ?? item["numero"] ?? item ?? ""),
      );
      if (!numero) continue;
      registros.push({
        inscricao: numero,
        uf: txt(item["uf"] ?? item["estado"]),
        situacao: txt(item["situacao"] ?? item["situacao_cadastral"]),
        contribuinte_icms: txt(item["contribuinte_icms"] ?? item["contribuinte"]),
      });
    }
  } else {
    const unica = normalizarIe(String(j["inscricao_estadual"] ?? j["inscricao"] ?? ""));
    if (unica) {
      registros.push({
        inscricao: unica,
        uf: txt(j["uf"] ?? j["estado"]),
        situacao: txt(j["situacao_ie"] ?? j["situacao"]),
        contribuinte_icms: txt(j["contribuinte_icms"] ?? j["contribuinte"]),
      });
    }
  }

  const isentoDeclarado =
    j["isento"] === true ||
    /isent|n[aã]o\s*contribuinte/i.test(String(j["contribuinte_icms"] ?? j["situacao_ie"] ?? ""));

  return { registros, uf: txt(j["uf"] ?? j["estado"]), isento: isentoDeclarado };
}

type Fonte = { nome: string; url: string; headers: Record<string, string> };

function fontes(doc: string): Fonte[] {
  const lista: Fonte[] = [];

  const base = process.env["IE_API_URL"];
  if (base) {
    const url = base.includes("{documento}")
      ? base.replace("{documento}", doc)
      : `${base.replace(/\/$/, "")}/${doc}`;
    const key = process.env["IE_API_KEY"];
    const header = process.env["IE_API_HEADER"] ?? "Authorization";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers[header] = header.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
    lista.push({ nome: process.env["IE_API_NOME"] ?? "provedor_fiscal", url, headers });
  }

  const cnpja = process.env["CNPJA_API_KEY"];
  if (cnpja) {
    lista.push({
      nome: "cnpja",
      url: `https://api.cnpja.com/office/${doc}?registrations=BR`,
      headers: { Accept: "application/json", Authorization: cnpja },
    });
  }

  lista.push({
    nome: "cnpja_aberto",
    url: `https://open.cnpja.com/office/${doc}?registrations=BR`,
    headers: { Accept: "application/json" },
  });

  return lista;
}

/** Consulta a Inscrição Estadual de um CNPJ. Não inventa dados nem assume isenção. */
export const consultarInscricaoEstadual = createServerFn({ method: "POST" })
  .inputValidator((input: { documento: string }) => ({
    documento: String(input?.documento ?? ""),
  }))
  .handler(async ({ data }): Promise<ConsultaIeResultado> => {
    const doc = digitos(data.documento);
    if (doc.length !== 14) {
      return {
        ok: false,
        documento: doc,
        codigo: "invalido",
        mensagem: "A consulta de Inscrição Estadual exige um CNPJ com 14 números.",
      };
    }
    if (!cnpjValido(doc)) {
      return {
        ok: false,
        documento: doc,
        codigo: "invalido",
        mensagem: "CNPJ inválido. Confira os números digitados.",
      };
    }

    let ultimoErro: ConsultaIeResultado | null = null;

    for (const fonte of fontes(doc)) {
      try {
        const controle = new AbortController();
        const tempo = setTimeout(() => controle.abort(), 20000);
        const res = await fetch(fonte.url, { headers: fonte.headers, signal: controle.signal });
        clearTimeout(tempo);

        if (res.status === 404) {
          ultimoErro = {
            ok: false,
            documento: doc,
            codigo: "nao_encontrado",
            mensagem: "CNPJ não encontrado na base consultada.",
          };
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          ultimoErro = {
            ok: false,
            documento: doc,
            codigo: "credencial",
            mensagem:
              "A credencial da consulta fiscal foi recusada pelo provedor. Os dados já cadastrados foram preservados.",
          };
          continue;
        }
        if (res.status === 429) {
          ultimoErro = {
            ok: false,
            documento: doc,
            codigo: "limite",
            mensagem: "Limite de consultas fiscais atingido. Tente novamente mais tarde.",
          };
          continue;
        }
        if (!res.ok) {
          ultimoErro = {
            ok: false,
            documento: doc,
            codigo: "indisponivel",
            mensagem:
              "Não foi possível consultar a Inscrição Estadual neste momento. Os dados já cadastrados foram preservados.",
          };
          continue;
        }

        const j = (await res.json()) as Record<string, unknown>;
        const { registros, uf, isento } = mapGenerico(j);

        if (registros.length === 0) {
          // pode não ter IE, não ser contribuinte ou a fonte não trazer o cadastro estadual
          const semCadastroEstadual = j["registrations"] === undefined;
          if (semCadastroEstadual && fonte.nome === "cnpja_aberto") {
            ultimoErro = {
              ok: false,
              documento: doc,
              codigo: "incompleto",
              mensagem:
                "A fonte disponível não retornou o cadastro estadual. Configure um provedor fiscal para consultar a Inscrição Estadual automaticamente.",
            };
            continue;
          }
          return {
            ok: true,
            documento: doc,
            provedor: fonte.nome,
            uf_estabelecimento: uf,
            registros: [],
            isento,
            mensagem: isento
              ? "CNPJ consultado: a fonte informa que o estabelecimento não é contribuinte de ICMS."
              : "CNPJ consultado, porém não foi localizada Inscrição Estadual ativa.",
            validadeDias: 15,
          };
        }

        return {
          ok: true,
          documento: doc,
          provedor: fonte.nome,
          uf_estabelecimento: uf,
          registros,
          isento: false,
          validadeDias: 15,
        };
      } catch {
        ultimoErro = {
          ok: false,
          documento: doc,
          codigo: "indisponivel",
          mensagem:
            "A consulta fiscal não respondeu no tempo esperado. Os dados já cadastrados foram preservados.",
        };
      }
    }

    return (
      ultimoErro ?? {
        ok: false,
        documento: doc,
        codigo: "sem_provedor",
        mensagem:
          "Nenhum provedor de consulta fiscal está configurado para buscar a Inscrição Estadual.",
      }
    );
  });
