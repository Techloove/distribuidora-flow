export type AbaCompras = "entradas" | "planejamento";
export const abaCompras = (valor: unknown): AbaCompras =>
  valor === "planejamento" ? "planejamento" : "entradas";
