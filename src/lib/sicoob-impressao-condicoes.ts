import { brl, dataBr } from "./formatacao";
type Row = Record<string, unknown>;
const percentual = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inteiro = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v)
    ? v
    : typeof v === "string" && /^\d+$/.test(v)
      ? Number(v)
      : null;
const valor = (v: unknown) => {
  if (!(typeof v === "number" || (typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v))))
    return null;
  const n = Number(v);
  return Number.isFinite(n) &&
    n >= 0 &&
    n <= 999999999999.99 &&
    Math.abs(n * 100 - Math.round(n * 100)) < 0.00001
    ? n
    : null;
};
const inicio = (v: unknown) =>
  dataBr(v) === "—" ? " (início não informado pelo banco)" : ` a partir de ${dataBr(v)}`;
/** Apenas campos bancários explícitos. Ausência não é isenção e não consulta padrões atuais da loja. */
export function condicoesImpressaoSicoob(b: Row) {
  const j = inteiro(b["tipoJurosMora"]),
    m = inteiro(b["tipoMulta"]),
    p = inteiro(b["codigoProtesto"]);
  const juros = valor(b["valorJurosMora"]),
    multa = valor(b["valorMulta"]),
    dias = inteiro(b["numeroDiasProtesto"]);
  const linhas = [
    j === 3
      ? "Juros: isento."
      : (j === 1 || j === 2) && juros !== null
        ? `Juros: ${j === 1 ? `${brl(juros)} por dia` : `${percentual.format(juros)}% ao mês`}${inicio(b["dataJurosMora"])}.`
        : "Juros: condição não informada pelo banco.",
    m === 0
      ? "Multa: isento."
      : (m === 1 || m === 2) && multa !== null
        ? `Multa: ${m === 1 ? brl(multa) : `${percentual.format(multa)}%`}${inicio(b["dataMulta"])}.`
        : "Multa: condição não informada pelo banco.",
    p === 3
      ? "Protesto: não protestar."
      : dias !== null && dias > 0 && dias <= 99
        ? `Protesto: prazo de ${dias} dias${p === 1 ? " corridos" : p === 2 ? " úteis" : " (contagem não informada pelo banco)"} após o vencimento.`
        : "Protesto: prazo não informado pelo banco.",
  ];
  return linhas;
}
