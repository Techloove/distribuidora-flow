import type { SaasStatus } from "./saas";
export function rotaForaDoErp(pathname: string): boolean {
  return ["/", "/auth", "/recuperar-senha", "/assinatura", "/plataforma"].includes(
    pathname === "/" ? pathname : pathname.replace(/\/$/, ""),
  );
}
export function avisoMensalidade(status: SaasStatus | null | undefined) {
  if (
    !status ||
    !(status.master || status.proprietario) ||
    !status.controle_ativo ||
    !["a_vencer", "em_tolerancia", "bloqueado"].includes(status.estado)
  )
    return null;
  const dias = status.dias_ate_bloqueio;
  return {
    titulo: status.bloqueado
      ? "Uso do sistema suspenso"
      : status.estado === "em_tolerancia"
        ? "Pagamento pendente: regularize para evitar o bloqueio"
        : "Mensalidade próxima do vencimento",
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
