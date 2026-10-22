export const MENSAGEM_TROCA_PROVEDOR =
  "Novas emissões FAZNOTAS foram desativadas. A integração Forecast Fiscal aguarda documentação e homologação.";
export function bloquearNovasEmissoesFaznotas(): void {
  throw new Error(MENSAGEM_TROCA_PROVEDOR);
}
