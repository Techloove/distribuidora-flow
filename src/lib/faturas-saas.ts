import type { SaasParcela } from "./saas";
export type FaturaSaas = {
  id: string;
  competencia: string;
  vencimento: string;
  vencimento_final: string;
  itens: SaasParcela[];
  total: number;
  pago: number;
  saldo: number;
  estado: "pago" | "cancelado" | "parcial" | "vencido" | "pendente";
};
/** Uma fatura por competência; vencimentos originais permanecem no detalhamento. */
export function agruparFaturasSaas(parcelas: SaasParcela[]): FaturaSaas[] {
  const grupos = new Map<string, SaasParcela[]>();
  for (const p of parcelas) {
    const competencia = p.competencia.slice(0, 7) + "-01";
    grupos.set(competencia, [...(grupos.get(competencia) ?? []), p]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([competencia, itens]) => {
      const datas = itens.map((p) => p.vencimento).sort();
      const total = itens
        .filter((p) => p.estado !== "cancelado")
        .reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
      const pago = itens
        .filter((p) => p.estado === "pago")
        .reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
      return {
        id: `FAT-${competencia.slice(0, 7).replace("-", "")}`,
        competencia,
        vencimento: datas[0]!,
        vencimento_final: datas.at(-1)!,
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
  mensalidade: "Mensalidade",
  implantacao: "Setup / implantação",
  hospedagem: "Hospedagem",
  dominio: "Domínio",
  servico: "Outro serviço",
};

/** Alias de apresentação para descrições padrão antigas, sem regravar cobranças com histórico. */
export function nomeServicoSaas(descricao?: string | null): string {
  return descricao?.trim().toLocaleLowerCase("pt-BR") === "assinatura"
    ? "Mensalidade"
    : (descricao ?? "Serviço");
}
