import { brl, dataBr } from "./formatacao";

/** Detalhes compartilhados pela central de pendências e pelo dashboard. */
export function detalhePendencia(
  categoria: { id: string; label: string },
  registro: Record<string, unknown>,
): string {
  const { id, label } = categoria;
  if (id === "agenda" || id === "cobranca")
    return `Próxima ação ${dataBr(registro["proxima_acao"])} · ${registro["observacao"] ?? "Confira a agenda"}`;
  if (id === "extrato")
    return String(registro["descricao"] ?? "Vincule ao movimento correspondente.");
  if (id === "comissao") return `Valor a conferir: ${brl(registro["valor"])}`;
  if (id === "vencimento")
    return `Alteração ${String(registro["estado"])} · vencimento ${dataBr(registro["vencimento_novo"])}`;
  return String(
    registro["erro"] ??
      registro["divergencia_obs"] ??
      (id === "vencido" ? `Vencimento ${dataBr(registro["vencimento"])}` : label),
  );
}
