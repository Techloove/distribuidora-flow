export type TituloBoleto = {
  centro_id?: string | null;
  pedido_id?: string | null;
  id: string;
  parcela: number;
  vencimento: string;
  valor: number;
  status: string;
  juros?: number;
  multa?: number;
  acrescimo?: number;
  desconto?: number;
  valor_pago?: number;
};
export type BoletoDocumento = {
  valor: number;
  id: string;
  conta_receber_id: string;
  status: string;
  banco: string;
  canal: string;
  linha_digitavel: string | null;
  ambiente: string | null;
  created_at: string;
};
const ativos = new Set(["pendente", "em_processamento", "registrado", "liquidado"]);
/** Nunca volta a um boleto antigo encerrado se existe um ciclo ativo mais recente. */
export function boletoAtual(boletos: BoletoDocumento[], conta: string) {
  const lista = boletos
    .filter((b) => b.conta_receber_id === conta)
    .sort(
      (a, b) =>
        Number(ativos.has(b.status)) - Number(ativos.has(a.status)) ||
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id),
    );
  return lista[0] ?? null;
}
export function boletoImprimivel(
  b: Pick<BoletoDocumento, "banco" | "canal" | "status" | "linha_digitavel"> | null,
) {
  return (
    !!b &&
    ["sicredi", "sicoob"].includes(b.banco) &&
    b.canal === "api" &&
    ["registrado", "liquidado"].includes(b.status) &&
    (b.banco === "sicoob" ? /^756\d{44}$/ : /^748\d{44}$/).test(
      String(b.linha_digitavel ?? "").replace(/[ .-]/g, ""),
    )
  );
}
/** Mantém as páginas originais dos PDFs bancários; não reconstrói código de barras ou QR Code. */
export async function unirPdfsBoletos(arquivos: string[]) {
  if (!arquivos.length) throw new Error("Selecione ao menos um boleto para impressão.");
  const { PDFDocument } = await import("pdf-lib");
  const destino = await PDFDocument.create();
  for (const base64 of arquivos) {
    const origem = await PDFDocument.load(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    if (!origem.getPageCount()) throw new Error("O banco retornou um PDF sem páginas.");
    const paginas = await destino.copyPages(origem, origem.getPageIndices());
    paginas.forEach((p) => destino.addPage(p));
  }
  return destino.save();
}

export function saldoTituloBoleto(t: TituloBoleto) {
  return (
    Number(t.valor) +
    Number(t.juros ?? 0) +
    Number(t.multa ?? 0) +
    Number(t.acrescimo ?? 0) -
    Number(t.desconto ?? 0) -
    Number(t.valor_pago ?? 0)
  );
}

/** RLS limita a leitura; esta seleção evita misturar clientes ou imprimir ciclos superados. */
export function boletosParaImpressao<T extends BoletoDocumento & { cliente_id?: string }>(
  rows: T[],
  cliente: string,
) {
  return rows.filter(
    (b) =>
      (!cliente || b.cliente_id === cliente) &&
      boletoImprimivel(b) &&
      (!b.conta_receber_id || boletoAtual(rows, b.conta_receber_id)?.id === b.id),
  );
}

/** A cobrança segue a loja persistida nas parcelas, nunca o filtro da tela. */
export function centroEmissaoTitulos(titulos: Pick<TituloBoleto, "centro_id">[]) {
  const centro = titulos[0]?.centro_id;
  return typeof centro === "string" &&
    centro.length > 0 &&
    titulos.every((t) => t.centro_id === centro)
    ? centro
    : "";
}

/** A abertura após emissão só seleciona os ciclos imprimíveis das parcelas confirmadas. */
export function boletosParaAberturaAutomatica<T extends BoletoDocumento>(
  rows: T[],
  contas: string[],
): T[] {
  const ids = [...new Set(contas)];
  if (!ids.length) return [];
  const lote = ids.map((id) => boletoAtual(rows, id));
  return lote.every((b) => boletoImprimivel(b)) ? (lote as T[]) : [];
}
