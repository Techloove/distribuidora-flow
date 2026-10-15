export type AgendaAba = "comercial" | "reativacao" | "cobranca" | "rotas";
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
  return value === "cobranca" || value === "reativacao" || value === "rotas" ? value : "comercial";
}

export function dataAgenda(value: unknown) {
  return value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
}

export const RESULTADOS_CONTATO = [
  { value: "contato_realizado", label: "Contato realizado" },
  { value: "nao_atendeu", label: "Não atendeu" },
  { value: "pediu_retorno", label: "Pediu retorno" },
  { value: "fez_pedido", label: "Fez pedido" },
  { value: "sem_interesse", label: "Não tem interesse" },
  { value: "cliente_fechado", label: "Cliente fechado" },
  { value: "nao_localizado", label: "Não localizado" },
  { value: "outro", label: "Outro" },
];
export function resultadoAgenda(value: unknown) {
  const text = String(value ?? "");
  return RESULTADOS_CONTATO.find((r) => r.value === text)?.label ?? text;
}
