import { dataBoleto } from "./boletos-lista";

type Row = Record<string, unknown>;
export type ConvenioFrancesinha = { cooperativa: string; posto: string; beneficiario: string };
export type DebitoFrancesinha = ConvenioFrancesinha & {
  dia: string;
  nosso_numero: string;
  descricao: string;
  valor: number;
};
function objeto(v: unknown): Row {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("RETORNO_INVALIDO");
  return v as Row;
}
function codigo(v: unknown, length: number): string {
  if (typeof v !== "string" || !new RegExp(`^\\d{1,${length}}$`).test(v))
    throw new Error("RETORNO_INVALIDO");
  return v.padStart(length, "0");
}
export function tarifaIdentificada(descricao: string): boolean {
  return /\bTARIFA\b/i.test(descricao);
}
/** Manual3.9.1 §7.21. Não infere tarifa a partir da diferença entre crédito e nominal. */
export function paginaFrancesinha(
  raw: unknown,
  convenio: ConvenioFrancesinha,
  dia: string,
  pagina: number,
) {
  const json = objeto(raw);
  if (
    !dataBoleto(dia) ||
    !Array.isArray(json["resultado"]) ||
    json["pagina"] !== pagina ||
    !Number.isSafeInteger(json["totalPaginas"]) ||
    Number(json["totalPaginas"]) < 0 ||
    !Number.isSafeInteger(json["total"]) ||
    Number(json["total"]) < 0
  )
    throw new Error("RETORNO_INVALIDO");
  const total = Number(json["total"]),
    totalPaginas = Number(json["totalPaginas"]);
  if (totalPaginas > 100 || (total > 0 && totalPaginas < 1) || (total === 0 && totalPaginas > 1))
    throw new Error("RETORNO_INVALIDO");
  const movimentos: DebitoFrancesinha[] = [];
  for (const value of json["resultado"]) {
    const r = objeto(value);
    const agencia = codigo(r["agencia"], 4),
      posto = codigo(r["posto"], 2),
      beneficiario = codigo(r["beneficiario"], 5);
    // O quadro do manual usa YYYY/MM/DD e seu exemplo usa YYYY-MM-DD.
    const lancamento =
      typeof r["dataLancamento"] === "string"
        ? dataBoleto(r["dataLancamento"].replaceAll("/", "-"))
        : "";
    if (
      agencia !== convenio.cooperativa ||
      posto !== convenio.posto ||
      beneficiario !== convenio.beneficiario ||
      lancamento !== dia ||
      r["tipoMovimento"] !== "DEBITO"
    )
      throw new Error("RETORNO_INVALIDO");
    if (
      typeof r["nossoNumero"] !== "string" ||
      !/^\d{1,9}$/.test(r["nossoNumero"]) ||
      typeof r["descMovimento"] !== "string" ||
      !r["descMovimento"].trim() ||
      r["descMovimento"].length > 300
    )
      throw new Error("RETORNO_INVALIDO");
    const valorRaw = r["valorMovimento"];
    if (
      (typeof valorRaw !== "number" && typeof valorRaw !== "string") ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(valorRaw))
    )
      throw new Error("RETORNO_INVALIDO");
    const valor = Number(valorRaw);
    if (!Number.isSafeInteger(Math.round(valor * 100)) || valor > 999999999999.99)
      throw new Error("RETORNO_INVALIDO");
    if (valor > 0)
      movimentos.push({
        cooperativa: convenio.cooperativa,
        posto: convenio.posto,
        beneficiario: convenio.beneficiario,
        dia,
        nosso_numero: r["nossoNumero"],
        descricao: r["descMovimento"].trim(),
        valor,
      });
  }
  return { movimentos, registros: json["resultado"].length, total, totalPaginas };
}

/** Nenhum consumidor recebe os dados de pagador ou o JSON bruto. */
export async function lerFrancesinhaCompleta(
  convenio: ConvenioFrancesinha,
  dia: string,
  consultar: (pagina: number) => Promise<unknown>,
): Promise<DebitoFrancesinha[]> {
  const movimentos: DebitoFrancesinha[] = [];
  let total: number | undefined,
    paginas: number | undefined,
    registros = 0;
  for (let p = 0; ; p++) {
    const page = paginaFrancesinha(await consultar(p), convenio, dia, p);
    total ??= page.total;
    paginas ??= page.totalPaginas;
    if (total !== page.total || paginas !== page.totalPaginas) throw new Error("RETORNO_INVALIDO");
    registros += page.registros;
    if (registros > total) throw new Error("RETORNO_INVALIDO");
    movimentos.push(...page.movimentos);
    if (p + 1 >= paginas) break;
  }
  if (registros !== total) throw new Error("RETORNO_INVALIDO");
  return movimentos;
}
