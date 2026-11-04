/** O custo preservado pertence à venda, inclusive quando foi explicitamente zero. */
export function custoItemPedido(
  item: Record<string, unknown>,
  produto: Record<string, unknown> | undefined,
  intermediacao: boolean,
): { valor: number | null; estimado: boolean } {
  const gravado = item["custo_unitario_base"];
  if (gravado != null && Number.isFinite(Number(gravado)) && Number(gravado) >= 0)
    return { valor: Number(gravado), estimado: false };
  // Intermediação nunca toma emprestado o custo do estoque.
  if (!intermediacao) {
    for (const campo of ["custo_medio", "preco_custo", "ultimo_custo"]) {
      const valor = Number(produto?.[campo]);
      if (Number.isFinite(valor) && valor > 0) return { valor, estimado: true };
    }
  }
  return { valor: null, estimado: true };
}
