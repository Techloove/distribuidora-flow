/** Prévia do item de compra; o banco mantém custo e frete separados com quatro casas. */
export function calcularItemCompra(quantidade: string, custo: string, frete: string) {
  if (!quantidade.trim() || !custo.trim() || !frete.trim()) return null;
  const q = Number(quantidade),
    c = Number(custo),
    f = Number(frete);
  if (![q, c, f].every(Number.isFinite) || q <= 0 || c < 0 || f < 0) return null;
  const unitario = (Math.round(c * 10000) + Math.round(f * 10000)) / 10000;
  return { unitario, total: Math.round((q * unitario + Number.EPSILON) * 100) / 100 };
}
