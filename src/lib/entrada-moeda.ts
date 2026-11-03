/** Valor canônico para cálculos/APIs; vírgula e ponto decimal são aceitos na digitação. */
export function normalizarEntradaMoeda(texto: string): string | null {
  let s = texto.trim().replace(/^R\$\s*/, "");
  if (!s) return "";
  if (s.includes(",")) {
    if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d*)?,\d*$/.test(s)) return null;
    s = s.replaceAll(".", "").replace(",", ".");
  }
  if (!/^-?\d*(?:\.\d*)?$/.test(s)) return null;
  if (["-", ".", "-."].includes(s)) return "";
  s = s.replace(/^(-?)\./, (_, sinal: string) => `${sinal}0.`).replace(/\.$/, "");
  return Number.isFinite(Number(s)) ? s : null;
}

/** Ao sair do campo, mostra no mínimo duas casas sem arredondar a precisão cadastrada. */
export function formatarEntradaMoeda(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "";
  return numero.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  });
}
