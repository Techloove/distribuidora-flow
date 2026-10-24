import { fetchWithTimeout } from "./fetch-timeout";
import {
  interpretarRetornoForecast,
  type IdentidadeForecast,
  type ResultadoForecast,
} from "./forecast-emissao";

type Payload = ReturnType<typeof import("./forecast-emissao").montarEmissaoHomologacao>;
export async function transmitirOuConsultarForecast(
  token: string,
  identidade: IdentidadeForecast,
  payload: Payload | null,
  transporte: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<ResultadoForecast> {
  if (
    !/^[\x21-\x39\x3b-\x7e]{1,2048}$/.test(token) ||
    !/^CPRHML[a-f0-9]{32}$/.test(identidade.ref) ||
    !/^\d{14}$/.test(identidade.cnpj)
  )
    throw new Error("Credencial ou identificação de homologação inválida.");
  if (
    payload &&
    (payload.ambiente !== "HOMOLOGACAO" ||
      payload.cnpj_emitente !== identidade.cnpj ||
      payload.ref !== identidade.ref ||
      payload.serie !== identidade.serie)
  )
    throw new Error("Payload fora do vínculo de homologação.");
  try {
    const url = payload
      ? "https://forecastfiscal.com.br/api/v2/nfe"
      : `https://forecastfiscal.com.br/api/v2/nfe/${encodeURIComponent(identidade.ref)}`;
    const r = await transporte(
      url,
      {
        method: payload ? "POST" : "GET",
        redirect: "error",
        headers: {
          Authorization: `Basic ${btoa(`${token}:`)}`,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      },
      20_000,
    );
    // Mesmo 4xx/404 não autoriza novo POST: uma tentativa já pode ter sido aceita.
    if (!r.ok)
      return {
        estado: "incerta",
        mensagem: `A Forecast retornou HTTP ${r.status}. Confira o acesso e consulte a mesma referência; não reenvie.`,
      };
    const texto = await r.text();
    if (texto.length > 1_000_000) throw new Error("Resposta extensa");
    return interpretarRetornoForecast(JSON.parse(texto), identidade);
  } catch {
    return {
      estado: "incerta",
      mensagem: "Comunicação ou resposta não confirmada. Consulte a mesma referência; não reenvie.",
    };
  }
}

export type JobHomologacao = {
  nota_id: string;
  centro_id: string;
  ref: string;
  cnpj: string;
  serie: string;
  payload: Payload;
  lease: string;
  token: string;
};
/** Reservar/assumir são operações duráveis anteriores à chamada; sem repetição de POST. */
export async function executarHomologacao(
  acao: "enviar" | "consultar",
  io: {
    assumir: () => Promise<JobHomologacao | null>;
    registrar: (lease: string, resultado: ResultadoForecast) => Promise<void>;
    transporte?: typeof fetchWithTimeout;
  },
) {
  const job = await io.assumir();
  if (!job) return { executado: false };
  const resultado = await transmitirOuConsultarForecast(
    job.token,
    { ref: job.ref, cnpj: job.cnpj, serie: job.serie },
    acao === "enviar" ? job.payload : null,
    io.transporte,
  );
  await io.registrar(job.lease, resultado);
  return { executado: true };
}
