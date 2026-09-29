/** Exportações simples de relatórios (CSV/Excel e PDF via impressão). */

type Row = Record<string, unknown>;

export type Coluna = { key: string; label: string };

export function escapar(v: unknown) {
  const raw = v === null || v === undefined ? "" : String(v);
  // Neutraliza fórmulas que planilhas executariam ao abrir o CSV.
  // eslint-disable-next-line no-control-regex -- inclui controles antes de fórmulas.
  const s = typeof v === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Gera e baixa um CSV (abre no Excel) com as colunas informadas. */
export function exportarCsv(nome: string, colunas: Coluna[], rows: Row[]) {
  const linhas = [
    colunas.map((c) => escapar(c.label)).join(";"),
    ...rows.map((r) => colunas.map((c) => escapar(r[c.key])).join(";")),
  ];
  const blob = new Blob(["\uFEFF" + linhas.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Abre a caixa de impressão do navegador (permite salvar em PDF). */
export function exportarPdf() {
  window.print();
}
