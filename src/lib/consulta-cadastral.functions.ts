import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { createServerFn } from "@tanstack/react-start";

/**
 * Camada de serviço de consulta cadastral (desacoplada do cadastro de clientes).
 *
 * Fluxo: frontend -> esta função de servidor -> provedor externo.
 * Nenhuma chave de API trafega no frontend.
 *
 * Provedores:
 *  - CNPJ: BrasilAPI (padrão, sem chave) e ReceitaWS como alternativa.
 *  - CPF : provedor autorizado configurável por secrets
 *          CPF_API_URL (use {documento} na URL) e, se necessário,
 *          CPF_API_KEY / CPF_API_HEADER (padrão "Authorization").
 *          Sem provedor configurado, a consulta é recusada — não usamos
 *          fontes não autorizadas de dados pessoais.
 *
 * Para trocar de provedor no futuro basta alterar este arquivo; o cadastro de
 * clientes continua chamando a mesma função.
 */

export type DadosCadastrais = {
  cnpj_cpf?: string | undefined;
  razao_social?: string | undefined;
  nome_fantasia?: string | undefined;
  situacao_cadastral?: string | undefined;
  data_abertura?: string | undefined;
  data_nascimento?: string | undefined;
  natureza_juridica?: string | undefined;
  porte?: string | undefined;
  cnae_principal?: string | undefined;
  cnae_secundarios?: string | undefined;
  inscricao_estadual?: string | undefined;
  cep?: string | undefined;
  logradouro?: string | undefined;
  numero?: string | undefined;
  complemento?: string | undefined;
  bairro?: string | undefined;
  cidade?: string | undefined;
  uf?: string | undefined;
  telefone?: string | undefined;
  email?: string | undefined;
};

export type ConsultaResultado =
  | {
      ok: true;
      documento: string;
      tipo: "PJ" | "PF";
      provedor: string;
      dados: DadosCadastrais;
      /** Dias de validade sugeridos para o cache. */
      validadeDias: number;
    }
  | {
      ok: false;
      documento: string;
      tipo: "PJ" | "PF" | null;
      /** invalido | nao_encontrado | indisponivel | limite | sem_provedor */
      codigo: "invalido" | "nao_encontrado" | "indisponivel" | "limite" | "sem_provedor";
      mensagem: string;
    };

const digitos = (v: string) => (v ?? "").replace(/\D+/g, "");

function cpfValido(cpf: string) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const corte of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < corte; i++) soma += Number(cpf[i]) * (corte + 1 - i);
    let dv = (soma * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== Number(cpf[corte])) return false;
  }
  return true;
}

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

const txt = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? undefined : s;
};

/** Normaliza datas (dd/mm/aaaa, ISO com hora) para aaaa-mm-dd. */
const dataIso = (v: unknown) => {
  const s = txt(v);
  if (!s) return undefined;
  const br = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
};

/** BrasilAPI: dados públicos da Receita Federal, sem chave de API. */
function mapBrasilApi(j: Record<string, unknown>): DadosCadastrais {
  const cnaes = Array.isArray(j["cnaes_secundarios"])
    ? (j["cnaes_secundarios"] as Record<string, unknown>[])
        .map((c) => `${txt(c["codigo"]) ?? ""} ${txt(c["descricao"]) ?? ""}`.trim())
        .filter(Boolean)
        .join(" | ")
    : undefined;
  const ddd = txt(j["ddd_telefone_1"]);
  return {
    cnpj_cpf: txt(j["cnpj"]),
    razao_social: txt(j["razao_social"]),
    nome_fantasia: txt(j["nome_fantasia"]),
    situacao_cadastral: txt(j["descricao_situacao_cadastral"]),
    data_abertura: dataIso(j["data_inicio_atividade"]),
    natureza_juridica: txt(j["natureza_juridica"]),
    porte: txt(j["porte"]),
    cnae_principal: [txt(j["cnae_fiscal"]), txt(j["cnae_fiscal_descricao"])]
      .filter(Boolean)
      .join(" - "),
    cnae_secundarios: cnaes,
    cep: txt(j["cep"]),
    logradouro: [txt(j["descricao_tipo_de_logradouro"]), txt(j["logradouro"])]
      .filter(Boolean)
      .join(" "),
    numero: txt(j["numero"]),
    complemento: txt(j["complemento"]),
    bairro: txt(j["bairro"]),
    cidade: txt(j["municipio"]),
    uf: txt(j["uf"]),
    telefone: ddd,
    email: txt(j["email"]),
  };
}

/** ReceitaWS: alternativa usada quando a BrasilAPI está indisponível. */
function mapReceitaWs(j: Record<string, unknown>): DadosCadastrais {
  const atividade = Array.isArray(j["atividade_principal"])
    ? (j["atividade_principal"] as Record<string, unknown>[])[0]
    : undefined;
  const secundarias = Array.isArray(j["atividades_secundarias"])
    ? (j["atividades_secundarias"] as Record<string, unknown>[])
        .map((a) => `${txt(a["code"]) ?? ""} ${txt(a["text"]) ?? ""}`.trim())
        .filter(Boolean)
        .join(" | ")
    : undefined;
  return {
    cnpj_cpf: txt(j["cnpj"]),
    razao_social: txt(j["nome"]),
    nome_fantasia: txt(j["fantasia"]),
    situacao_cadastral: txt(j["situacao"]),
    data_abertura: dataIso(j["abertura"]),
    natureza_juridica: txt(j["natureza_juridica"]),
    porte: txt(j["porte"]),
    cnae_principal: atividade
      ? [txt(atividade["code"]), txt(atividade["text"])].filter(Boolean).join(" - ")
      : undefined,
    cnae_secundarios: secundarias,
    cep: txt(j["cep"]),
    logradouro: txt(j["logradouro"]),
    numero: txt(j["numero"]),
    complemento: txt(j["complemento"]),
    bairro: txt(j["bairro"]),
    cidade: txt(j["municipio"]),
    uf: txt(j["uf"]),
    telefone: txt(j["telefone"]),
    email: txt(j["email"]),
  };
}

/** Provedor de CPF configurado por secret; mapeamento tolerante a nomes. */
function mapCpf(j: Record<string, unknown>): DadosCadastrais {
  const raiz = (j["data"] ?? j["result"] ?? j) as Record<string, unknown>;
  const g = (...nomes: string[]) => {
    for (const n of nomes) {
      const v = txt(raiz[n]);
      if (v) return v;
    }
    return undefined;
  };
  return {
    cnpj_cpf: g("cpf", "documento", "document"),
    razao_social: g("nome", "name", "nome_completo"),
    situacao_cadastral: g("situacao", "situacao_cadastral", "status"),
    data_nascimento: dataIso(g("data_nascimento", "nascimento", "birthdate")),
    cep: g("cep", "zip"),
    logradouro: g("logradouro", "endereco", "street"),
    numero: g("numero", "number"),
    complemento: g("complemento"),
    bairro: g("bairro", "district"),
    cidade: g("cidade", "municipio", "city"),
    uf: g("uf", "estado", "state"),
    telefone: g("telefone", "celular", "phone"),
    email: g("email"),
  };
}

async function consultarCnpj(doc: string): Promise<ConsultaResultado> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${doc}`);
    if (res.status === 404) {
      return {
        ok: false,
        documento: doc,
        tipo: "PJ",
        codigo: "nao_encontrado",
        mensagem: "CNPJ não encontrado na base da Receita Federal.",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        documento: doc,
        tipo: "PJ",
        codigo: "limite",
        mensagem: "Limite de consultas atingido. Tente novamente em alguns minutos.",
      };
    }
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      return {
        ok: true,
        documento: doc,
        tipo: "PJ",
        provedor: "brasilapi",
        dados: mapBrasilApi(j),
        validadeDias: 30,
      };
    }
  } catch {
    /* cai na alternativa */
  }

  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${doc}`);
    if (res.status === 429) {
      return {
        ok: false,
        documento: doc,
        tipo: "PJ",
        codigo: "limite",
        mensagem: "Limite de consultas atingido. Tente novamente em alguns minutos.",
      };
    }
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      if (String(j["status"] ?? "").toUpperCase() === "ERROR") {
        return {
          ok: false,
          documento: doc,
          tipo: "PJ",
          codigo: "nao_encontrado",
          mensagem: txt(j["message"]) ?? "CNPJ não encontrado.",
        };
      }
      return {
        ok: true,
        documento: doc,
        tipo: "PJ",
        provedor: "receitaws",
        dados: mapReceitaWs(j),
        validadeDias: 30,
      };
    }
  } catch {
    /* indisponível */
  }

  return {
    ok: false,
    documento: doc,
    tipo: "PJ",
    codigo: "indisponivel",
    mensagem: "Serviço de consulta indisponível no momento. Tente novamente mais tarde.",
  };
}

async function consultarCpf(doc: string): Promise<ConsultaResultado> {
  const base = process.env["CPF_API_URL"];
  if (!base) {
    return {
      ok: false,
      documento: doc,
      tipo: "PF",
      codigo: "sem_provedor",
      mensagem:
        "Consulta de CPF não configurada. É necessário contratar um provedor autorizado de dados pessoais e cadastrar a chave de acesso.",
    };
  }
  const url = base.includes("{documento}")
    ? base.replace("{documento}", doc)
    : `${base.replace(/\/$/, "")}/${doc}`;
  const key = process.env["CPF_API_KEY"];
  const header = process.env["CPF_API_HEADER"] ?? "Authorization";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers[header] = header.toLowerCase() === "authorization" ? `Bearer ${key}` : key;

  try {
    const res = await fetch(url, { headers });
    if (res.status === 404) {
      return {
        ok: false,
        documento: doc,
        tipo: "PF",
        codigo: "nao_encontrado",
        mensagem: "CPF não encontrado na base do provedor.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        documento: doc,
        tipo: "PF",
        codigo: "sem_provedor",
        mensagem: "O provedor recusou a credencial de consulta de CPF. Revise a chave cadastrada.",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        documento: doc,
        tipo: "PF",
        codigo: "limite",
        mensagem: "Limite de consultas do provedor atingido.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        documento: doc,
        tipo: "PF",
        codigo: "indisponivel",
        mensagem: "Serviço de consulta de CPF indisponível no momento.",
      };
    }
    const j = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      documento: doc,
      tipo: "PF",
      provedor: txt(process.env["CPF_API_NOME"]) ?? "provedor_cpf",
      dados: mapCpf(j),
      validadeDias: 7,
    };
  } catch {
    return {
      ok: false,
      documento: doc,
      tipo: "PF",
      codigo: "indisponivel",
      mensagem: "Não foi possível falar com o provedor de consulta de CPF.",
    };
  }
}

/** Consulta cadastral por CNPJ ou CPF. Valida e normaliza o documento. */
export const consultarDocumento = createServerFn({ method: "POST" })
  .inputValidator((input: { documento: string; accessToken?: string }) => ({
    documento: String(input?.documento ?? ""),
    accessToken: String(input?.accessToken ?? ""),
  }))
  .handler(async ({ data }): Promise<ConsultaResultado> => {
    const accessToken = String(data.accessToken ?? "").trim() || requestAccessToken();
    await requireServerAuth(accessToken, ["admin", "gestor"]);
    await enforceRateLimit(accessToken, "consulta-cadastral", 20, 60);
    const doc = digitos(data.documento);
    if (doc.length === 14) {
      if (!cnpjValido(doc)) {
        return {
          ok: false,
          documento: doc,
          tipo: "PJ",
          codigo: "invalido",
          mensagem: "CNPJ inválido. Confira os números digitados.",
        };
      }
      return consultarCnpj(doc);
    }
    if (doc.length === 11) {
      if (!cpfValido(doc)) {
        return {
          ok: false,
          documento: doc,
          tipo: "PF",
          codigo: "invalido",
          mensagem: "CPF inválido. Confira os números digitados.",
        };
      }
      return consultarCpf(doc);
    }
    return {
      ok: false,
      documento: doc,
      tipo: null,
      codigo: "invalido",
      mensagem: "Informe um CNPJ com 14 números ou um CPF com 11 números.",
    };
  });
