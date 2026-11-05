import type { SaasParcela } from "./saas";
export type FaturaSaas = {
  id: string;
  vencimento: string;
  itens: SaasParcela[];
  total: number;
  pago: number;
  saldo: number;
  estado: "pago" | "cancelado" | "parcial" | "vencido" | "pendente";
};
/** Um vencimento por fatura, sem antecipar nem adiar os serviços contratados. */
export function agruparFaturasSaas(parcelas: SaasParcela[]): FaturaSaas[] {
  const grupos = new Map<string, SaasParcela[]>();
  for (const p of parcelas) grupos.set(p.vencimento, [...(grupos.get(p.vencimento) ?? []), p]);
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([vencimento, itens]) => {
      const total = itens
        .filter((p) => p.estado !== "cancelado")
        .reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
      const pago = itens
        .filter((p) => p.estado === "pago")
        .reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
      return {
        id: `FAT-${vencimento.replaceAll("-", "")}`,
        vencimento,
        itens,
        total: total / 100,
        pago: pago / 100,
        saldo: (total - pago) / 100,
        estado: itens.every((p) => p.estado === "cancelado")
          ? "cancelado"
          : total === pago
            ? "pago"
            : pago > 0
              ? "parcial"
              : itens.some((p) => p.estado === "vencido")
                ? "vencido"
                : "pendente",
      };
    });
}
export const nomeEstadoFatura = {
  pago: "Paga",
  cancelado: "Cancelada",
  parcial: "Pagamento parcial",
  vencido: "Vencida",
  pendente: "Pendente",
};
export const periodicidadesSaas: Record<string, string> = {
  mensal: "Mensal",
  anual: "Anual",
  unica: "Uma vez",
  parcelado: "Parcelado mensalmente",
};
export const tiposServicoSaas: Record<string, string> = {
  mensalidade: "Assinatura",
  implantacao: "Setup / implantação",
  hospedagem: "Hospedagem",
  dominio: "Domínio",
  servico: "Outro serviço",
};
