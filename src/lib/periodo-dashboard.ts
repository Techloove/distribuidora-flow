import { hojeSaoPaulo } from "./painel-trabalho";
export const mesDashboardAtual = (agora = new Date()) => hojeSaoPaulo(agora).slice(0, 7);
export function moverMesDashboard(mes: string, deslocamento: number) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw Error("Mês inválido");
  const [ano, numero] = mes.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, numero! - 1 + deslocamento, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function rotuloMesDashboard(mes: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${mes}-01T12:00:00Z`));
}
