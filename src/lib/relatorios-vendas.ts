import { hojeSaoPaulo } from "@/lib/painel-trabalho";
export type LinhaRelatorio = Record<string, unknown>;
export type RelatorioVendas = {
  rentabilidade: boolean;
  totais: LinhaRelatorio;
  anterior: LinhaRelatorio;
  ranking: LinhaRelatorio[];
  grupos: number;
  pedidos: LinhaRelatorio[];
  mensal: LinhaRelatorio[];
  comparativo: LinhaRelatorio[];
  produtos: LinhaRelatorio[];
  comissoes: LinhaRelatorio[];
  comparativo_inicio: string;
  comparativo_fim: string;
};
export const GRUPOS_VENDAS = [
  { value: "rota", label: "Rotas" },
  { value: "cidade", label: "Cidades" },
  { value: "representante", label: "Representantes" },
  { value: "cliente", label: "Clientes" },
  { value: "centro", label: "Centros de custo" },
  { value: "mes", label: "Meses" },
];
export function periodoMesVendas(mes: string) {
  const [ano, numero] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(ano!, numero!, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fim };
}
export function filtrosVendasIniciais() {
  const hoje = hojeSaoPaulo();
  return {
    inicio: `${hoje.slice(0, 7)}-01`,
    fim: hoje,
    centro: "",
    representante: "",
    rota: "",
    cidade: "",
    busca: "",
    status: "",
  };
}
export const numeroVendas = (v: unknown) => Number(v ?? 0);
export function variacaoVendas(atual: unknown, anterior: unknown) {
  const base = numeroVendas(anterior);
  return base === 0 ? null : ((numeroVendas(atual) - base) / Math.abs(base)) * 100;
}
