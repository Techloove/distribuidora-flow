/** Prévia do item de compra; o banco mantém custo e frete separados com quatro casas. */
export function calcularItemCompra(quantidade: string, custo: string, frete: string, ipi = "0") {
  if (!quantidade.trim() || !custo.trim() || !frete.trim()) return null;
  const q = Number(quantidade),
    c = Number(custo),
    f = Number(frete),
    i = Number(ipi);
  if (![q, c, f, i].every(Number.isFinite) || q <= 0 || c < 0 || f < 0 || i < 0 || i > 100)
    return null;
  const unitario =
    (Math.round((Math.round(c * 10000) / 10000) * (1 + Math.round(i * 10000) / 1000000) * 10000) +
      Math.round(f * 10000)) /
    10000;
  return { unitario, total: Math.round((q * unitario + Number.EPSILON) * 100) / 100 };
}
