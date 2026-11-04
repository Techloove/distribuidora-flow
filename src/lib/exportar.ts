import { getModalidade, nomesModalidade } from "./modalidade-store";
import { dataBr, mesBr } from "./formatacao";
/** Exportações simples de relatórios (CSV/Excel e PDF via impressão). */

type Row = Record<string, unknown>;

export type Coluna = { key: string; label: string; formato?: "data" | "mes" };

export function escapar(v: unknown) {
  const raw = v === null || v === undefined ? "" : String(v);
  // Neutraliza fórmulas que planilhas executariam ao abrir o CSV.
  // eslint-disable-next-line no-control-regex -- inclui controles antes de fórmulas.
  const s = typeof v === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Formatos de exibição são explícitos; modelos de importação continuam técnicos. */
export function conteudoCsv(colunas: Coluna[], rows: Row[]) {
  return (
    "\uFEFF" +
    [
      colunas.map((c) => escapar(c.label)).join(";"),
      ...rows.map((r) =>
        colunas
          .map((c) => {
            const valor = r[c.key];
            return escapar(
              c.formato === "data" ? dataBr(valor) : c.formato === "mes" ? mesBr(valor) : valor,
            );
          })
          .join(";"),
      ),
    ].join("\r\n")
  );
}

/** Gera e baixa um CSV (abre no Excel) com as colunas informadas. */
export function exportarCsv(
  nome: string,
  colunas: Coluna[],
  rows: Row[],
  aplicarModalidade = true,
) {
  const blob = new Blob([conteudoCsv(colunas, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}${!aplicarModalidade || getModalidade() === "todos" ? "" : "-" + nomesModalidade[getModalidade()]}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Abre a caixa de impressão do navegador (permite salvar em PDF). */
export function exportarPdf() {
  window.print();
}
