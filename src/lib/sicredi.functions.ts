import { createServerFn } from "@tanstack/react-start";

/**
 * Integracao com a API de Cobranca do Sicredi (portal de parceiros).
 * As credenciais ficam em variaveis de ambiente do servidor:
 *   SICREDI_API_KEY, SICREDI_USERNAME, SICREDI_PASSWORD,
 *   SICREDI_COOPERATIVA, SICREDI_POSTO, SICREDI_CODIGO_BENEFICIARIO,
 *   SICREDI_AMBIENTE ("homologacao" | "producao")
 */

type Conf = {
  apiKey: string;
  username: string;
  password: string;
  cooperativa: string;
  posto: string;
  beneficiario: string;
  ambiente: string;
  base: string;
};

function conf(): Conf {
  const ambiente = (process.env["SICREDI_AMBIENTE"] ?? "homologacao").toLowerCase();
  const base =
    ambiente === "producao"
      ? "https://api-parceiro.sicredi.com.br"
      : "https://api-parceiro.sicredi.com.br/sb";
  const c: Conf = {
    apiKey: process.env["SICREDI_API_KEY"] ?? "",
    username: process.env["SICREDI_USERNAME"] ?? "",
    password: process.env["SICREDI_PASSWORD"] ?? "",
    cooperativa: process.env["SICREDI_COOPERATIVA"] ?? "",
    posto: process.env["SICREDI_POSTO"] ?? "",
    beneficiario: process.env["SICREDI_CODIGO_BENEFICIARIO"] ?? "",
    ambiente,
    base,
  };
  const faltando = Object.entries({
    SICREDI_API_KEY: c.apiKey,
    SICREDI_USERNAME: c.username,
    SICREDI_PASSWORD: c.password,
    SICREDI_COOPERATIVA: c.cooperativa,
    SICREDI_POSTO: c.posto,
    SICREDI_CODIGO_BENEFICIARIO: c.beneficiario,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltando.length > 0) {
    throw new Error(
      `Credenciais do Sicredi ausentes: ${faltando.join(", ")}. Cadastre os segredos e publique o app.`,
    );
  }
  return c;
}

async function token(c: Conf): Promise<string> {
  const body = new URLSearchParams({
    username: c.username,
    password: c.password,
    scope: "cobranca",
    grant_type: "password",
  });
  const res = await fetch(`${c.base}/auth/openapi/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": c.apiKey,
      context: "COBRANCA",
    },
    body,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Falha na autenticacao Sicredi (${res.status}): ${txt.slice(0, 300)}`);
  const json = JSON.parse(txt) as { access_token?: string };
  if (!json.access_token) throw new Error("Sicredi nao retornou access_token");
  return json.access_token;
}

function headers(c: Conf, tk: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tk}`,
    "x-api-key": c.apiKey,
    cooperativa: c.cooperativa,
    posto: c.posto,
  };
}

/** Status da configuracao — usado pela tela para avisar o usuario. */
export const sicrediStatus = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const c = conf();
    return {
      configurado: true,
      ambiente: c.ambiente,
      cooperativa: c.cooperativa,
      posto: c.posto,
      beneficiario: c.beneficiario,
      erro: null as string | null,
    };
  } catch (e) {
    return {
      configurado: false,
      ambiente: (process.env["SICREDI_AMBIENTE"] ?? "homologacao").toLowerCase(),
      cooperativa: "",
      posto: "",
      beneficiario: "",
      erro: (e as Error).message,
    };
  }
});

type EmitirInput = {
  seuNumero: string;
  valor: number;
  vencimento: string;
  pagador: {
    tipoPessoa: string;
    documento: string;
    nome: string;
    endereco: string;
    cidade: string;
    uf: string;
    cep: string;
    telefone?: string;
    email?: string;
  };
  informativo?: string;
  diasProtesto?: number;
  juros?: number;
  multa?: number;
};

/** Registra o boleto no Sicredi e devolve nosso numero / linha digitavel / PIX. */
export const sicrediEmitirBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: EmitirInput) => data)
  .handler(async ({ data }) => {
    const c = conf();
    const tk = await token(c);
    const payload = {
      tipoCobranca: "HIBRIDO",
      codigoBeneficiario: c.beneficiario,
      especieDocumento: "DUPLICATA_MERCANTIL_INDICACAO",
      seuNumero: data.seuNumero,
      dataVencimento: data.vencimento,
      valor: Number(data.valor.toFixed(2)),
      tipoDesconto: "NAO_TEM_DESCONTO",
      tipoJuro: data.juros && data.juros > 0 ? "PERCENTUAL" : "ISENTO",
      ...(data.juros && data.juros > 0 ? { juros: data.juros } : {}),
      ...(data.multa && data.multa > 0 ? { multa: data.multa } : {}),
      ...(data.diasProtesto && data.diasProtesto > 0
        ? { validadeAposVencimento: data.diasProtesto }
        : {}),
      ...(data.informativo ? { informativos: [data.informativo.slice(0, 80)] } : {}),
      pagador: {
        tipoPessoa: data.pagador.tipoPessoa,
        documento: data.pagador.documento.replace(/\D/g, ""),
        nome: data.pagador.nome.slice(0, 40),
        endereco: data.pagador.endereco.slice(0, 40),
        cidade: data.pagador.cidade.slice(0, 20),
        uf: data.pagador.uf.slice(0, 2).toUpperCase(),
        cep: data.pagador.cep.replace(/\D/g, ""),
        ...(data.pagador.telefone ? { telefone: data.pagador.telefone.replace(/\D/g, "") } : {}),
        ...(data.pagador.email ? { email: data.pagador.email } : {}),
      },
    };
    const res = await fetch(`${c.base}/cobranca/boleto/v1/boletos`, {
      method: "POST",
      headers: headers(c, tk),
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (!res.ok) {
      throw new Error(`Sicredi recusou o boleto (${res.status}): ${txt.slice(0, 400)}`);
    }
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    return {
      nossoNumero: String(json["nossoNumero"] ?? ""),
      linhaDigitavel: String(json["linhaDigitavel"] ?? ""),
      codigoBarras: String(json["codigoBarras"] ?? ""),
      qrCode: String(json["qrCode"] ?? json["txid"] ?? ""),
      txid: String(json["txid"] ?? ""),
      cooperativa: c.cooperativa,
      posto: c.posto,
      beneficiario: c.beneficiario,
      ambiente: c.ambiente,
      retorno: json,
    };
  });

/** Consulta a situacao atual do boleto no Sicredi. */
export const sicrediConsultarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = conf();
    const tk = await token(c);
    const url = `${c.base}/cobranca/boleto/v1/boletos?codigoBeneficiario=${encodeURIComponent(
      c.beneficiario,
    )}&nossoNumero=${encodeURIComponent(data.nossoNumero)}`;
    const res = await fetch(url, { headers: headers(c, tk) });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Consulta Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    const situacao = String(
      (json["situacao"] as string) ?? (json["situacaoBoleto"] as string) ?? "",
    ).toLowerCase();
    return {
      situacao,
      liquidado: situacao.includes("liquidad"),
      baixado: situacao.includes("baixad") || situacao.includes("cancelad"),
      retorno: json,
    };
  });

/** Solicita a baixa (cancelamento) do boleto. */
export const sicrediBaixarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/${encodeURIComponent(data.nossoNumero)}/baixa`,
      { method: "PATCH", headers: headers(c, tk), body: JSON.stringify({}) },
    );
    const txt = await res.text();
    if (!res.ok) throw new Error(`Baixa no Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    return { ok: true, retorno: txt.slice(0, 500) };
  });

/** Segunda via em PDF (base64) do boleto registrado. */
export const sicrediPdfBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/pdf?linhaDigitavel=&nossoNumero=${encodeURIComponent(
        data.nossoNumero,
      )}&codigoBeneficiario=${encodeURIComponent(c.beneficiario)}`,
      { headers: headers(c, tk) },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PDF do boleto indisponivel (${res.status}): ${txt.slice(0, 300)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return { base64: btoa(bin) };
  });
