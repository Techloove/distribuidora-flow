export type AgendaAba = "comercial" | "reativacao" | "cobranca";
export type AgendaFiltros = {
  busca: string;
  representante: string;
  rota: string;
  cidade: string;
  dias: number;
};
export const FILTROS_AGENDA: AgendaFiltros = {
  busca: "",
  representante: "",
  rota: "",
  cidade: "",
  dias: 60,
};
export function abaAgenda(value: unknown): AgendaAba {
  return value === "cobranca" || value === "reativacao" ? value : "comercial";
}

export function dataAgenda(value: unknown) {
  return value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
}
