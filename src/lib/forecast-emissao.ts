import { z } from "zod";
import { montarPreviaForecast } from "./forecast-previa";

export const opcoesHomologacaoSchema = z.object({
  natureza_operacao: z.string().trim().min(1).max(60),
  modalidade_frete: z.enum(["0", "1", "2", "3", "4", "9"]),
  consumidor_final: z.enum(["0", "1"]),
  presenca_comprador: z.enum(["1", "4"]),
  forma_pagamento: z.enum(["01", "02", "15", "16", "17", "18", "90"]),
  codigo_municipio_destinatario: z.string().regex(/^\d{7}$/),
});
export type OpcoesHomologacao = z.infer<typeof opcoesHomologacaoSchema>;
export function montarEmissaoHomologacao(contexto: unknown, entrada: unknown) {
  const opcoes = opcoesHomologacaoSchema.parse(entrada);
  const previa = montarPreviaForecast(contexto);
  if (!previa.payload_proposto)
    throw new Error("Corrija as pendências da prévia antes de enviar para homologação.");
  const p = previa.payload_proposto;
  if (!/^\d{14}$/.test(p.cnpj_emitente))
    throw new Error("Esta fase de homologação aceita somente CNPJ numérico.");
  for (const valor of [
    p.logradouro_destinatario,
    p.numero_destinatario,
    p.bairro_destinatario,
    p.municipio_destinatario,
    p.complemento_destinatario ?? "",
  ])
    if (valor.length > 60)
      throw new Error("Endereço do destinatário excede o limite de 60 caracteres por campo.");
  if (opcoes.modalidade_frete === "9" && p.valor_frete !== "0.00")
    throw new Error("Frete cobrado exige modalidade de frete correspondente.");
  const { forma_pagamento, ...campos } = opcoes;
  return {
    ...p,
    ...campos,
    ambiente: "HOMOLOGACAO" as const,
    tipo_documento: "1",
    finalidade_emissao: "1",
    formas_pagamento: [
      {
        forma_pagamento,
        valor_pagamento: forma_pagamento === "90" ? "0.00" : p.valor_total,
      },
    ],
  };
}
export type ResultadoForecast = {
  estado: "processando" | "autorizada" | "rejeitada" | "incerta" | "cancelada";
  mensagem: string;
  chave?: string;
  protocolo?: string;
  numero?: string;
  serie?: string;
};
export type IdentidadeForecast = { ref: string; cnpj: string; serie: string };
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Contrato de resposta incompleto: exigir identidade e prova antes de reconhecer autorização. */
export function interpretarRetornoForecast(
  body: unknown,
  esperado: IdentidadeForecast,
): ResultadoForecast {
  const incerto: ResultadoForecast = {
    estado: "incerta",
    mensagem: "Retorno sem prova suficiente. Consulte a mesma referência; não reenvie.",
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) return incerto;
  const b = body as Record<string, unknown>;
  if (
    str(b["ref"]) !== esperado.ref ||
    str(b["cnpj_emitente"]).replace(/[./-]/g, "") !== esperado.cnpj ||
    !["HOMOLOGACAO", "homologacao", "2"].includes(str(b["ambiente"]))
  )
    return incerto;
  const status = str(b["status"]).toLowerCase();
  if (["processando_autorizacao", "processando", "pendente"].includes(status))
    return {
      estado: "processando",
      mensagem: "Documento em processamento de homologação. Consulte esta referência novamente.",
    };
  if (["erro_autorizacao", "rejeitado", "rejeitada", "denegado", "denegada"].includes(status))
    return {
      estado: "rejeitada",
      mensagem:
        "A Forecast informou rejeição/denegação em homologação. Confira o detalhe no painel do provedor; esta referência não será reenviada.",
    };
  if (!["autorizado", "autorizada"].includes(status)) return incerto;
  const chave = str(b["chave_nfe"]),
    protocolo = str(b["protocolo"]),
    numero = str(b["numero"]),
    serie = str(b["serie"]);
  if (
    !/^\d{44}$/.test(chave) ||
    chave.slice(6, 20) !== esperado.cnpj ||
    chave.slice(20, 22) !== "55" ||
    !/^\d{15}$/.test(protocolo) ||
    !/^\d{1,9}$/.test(numero) ||
    Number(numero) <= 0 ||
    serie !== esperado.serie ||
    Number(chave.slice(22, 25)) !== Number(serie) ||
    Number(chave.slice(25, 34)) !== Number(numero)
  )
    return incerto;
  let soma = 0;
  for (let i = 42, peso = 2; i >= 0; i--, peso = peso === 9 ? 2 : peso + 1)
    soma += Number(chave[i]) * peso;
  const dv = 11 - (soma % 11);
  if (Number(chave[43]) !== (dv >= 10 ? 0 : dv)) return incerto;
  return {
    estado: "autorizada",
    mensagem:
      "Retorno de homologação com identidade e dados fiscais conferidos. Sem efeito sobre a nota operacional.",
    chave,
    protocolo,
    numero,
    serie,
  };
}
