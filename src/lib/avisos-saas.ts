import type { SaasStatus } from "./saas";
import { hojeSaoPaulo } from "./painel-trabalho";

function diasAte(data: string | null, hoje: string): number | null {
  if (!data) return null;
  const dias = (Date.parse(`${data}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(dias) ? Math.max(0, Math.round(dias)) : null;
}

export function proximoVencimento(status: SaasStatus, hoje = hojeSaoPaulo()): string {
  const dias = diasAte(status.vencimento, hoje);
  if (!status.controle_ativo || dias === null) return "Mensalidade em dia";
  return dias === 0
    ? "Próximo vencimento hoje"
    : `Próximo vencimento em ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function rotaForaDoErp(pathname: string): boolean {
  return ["/", "/auth", "/recuperar-senha", "/assinatura", "/plataforma"].includes(
    pathname === "/" ? pathname : pathname.replace(/\/$/, ""),
  );
}
export function avisoMensalidade(status: SaasStatus | null | undefined, hoje = hojeSaoPaulo()) {
  if (
    !status ||
    !(status.master || status.proprietario) ||
    !status.controle_ativo ||
    !["a_vencer", "em_tolerancia", "bloqueado"].includes(status.estado)
  )
    return null;
  const dias = diasAte(status.data_bloqueio ?? null, hoje) ?? status.dias_ate_bloqueio;
  const vencimento = diasAte(status.vencimento, hoje);
  return {
    titulo: status.bloqueado
      ? "Uso do sistema suspenso"
      : status.estado === "em_tolerancia"
        ? "Pagamento pendente: regularize para evitar o bloqueio"
        : vencimento === null
          ? "Mensalidade próxima do vencimento"
          : vencimento === 0
            ? "A mensalidade vence hoje"
            : `A mensalidade vence em ${vencimento} ${vencimento === 1 ? "dia" : "dias"}`,
    prazo: status.bloqueado
      ? "Regularize a mensalidade para liberar o acesso."
      : dias == null
        ? "Confira as faturas e o prazo para regularização."
        : dias === 0
          ? "O bloqueio está previsto para hoje."
          : dias === 1
            ? "Falta 1 dia para o bloqueio do sistema."
            : `Faltam ${dias} dias para o bloqueio do sistema.`,
  };
}
