import { fetchWithTimeout } from "./fetch-timeout";

// Origem da documentação fornecida pelo usuário. Nunca aceitar URL do navegador.
const FORECAST_BASE_URL = "https://forecastfiscal.com.br/api/v2";

export async function testarAcessoForecast(
  token: string,
  cnpj: string,
  transporte: typeof fetchWithTimeout = fetchWithTimeout,
) {
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) throw new Error("CNPJ fiscal inválido.");
  if (!/^[\x21-\x39\x3b-\x7e]{1,2048}$/.test(token))
    throw new Error("Token Forecast inválido. Informe apenas o token, sem prefixo Basic.");
  let r: Response;
  try {
    r = await transporte(`${FORECAST_BASE_URL}/empresas/${cnpj}`, {
      method: "GET",
      headers: { Authorization: `Basic ${btoa(`${token}:`)}`, Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Não foi possível consultar a Forecast Fiscal. Confira a conectividade e tente novamente.",
    );
  }
  if (r.status === 401 || r.status === 403)
    throw new Error("A Forecast recusou o acesso. Confira o token e sua permissão para este CNPJ.");
  if (r.status === 404) throw new Error("Empresa não encontrada na Forecast para o CNPJ da loja.");
  if (r.status === 429)
    throw new Error("Limite da Forecast atingido. Aguarde antes de consultar novamente.");
  if (!r.ok) throw new Error(`Consulta Forecast indisponível (HTTP ${r.status}).`);
  const body: unknown = await r.json().catch(() => null);
  // O Swagger não especifica os campos da resposta. Falhar fechado, sem aceitar
  // HTTP200 como prova e sem repassar CSC, tokens ou outros dados da empresa.
  const remoto =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["cnpj"]
      : null;
  if (
    typeof remoto !== "string" ||
    !/^[A-Za-z0-9./-]+$/.test(remoto) ||
    remoto.replace(/[./-]/g, "").toUpperCase() !== cnpj
  )
    throw new Error(
      "A resposta Forecast não confirmou o CNPJ esperado. Confira o contrato da resposta com o provedor.",
    );
  return {
    sucesso: true,
    verificado_em: new Date().toISOString(),
    mensagem:
      "Consulta de leitura confirmou o CNPJ da loja. Nenhuma nota foi emitida. Esta consulta não comprova o ambiente do token, certificado, série ou autorização de emissão.",
  };
}
