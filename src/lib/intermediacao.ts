export type LinhaIntermediacao = {
  quantidade: number;
  fabrica: number;
  frete: number;
  margem: number;
};
const arredondar = (v: number, casas = 2) =>
  Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas;
export function calcularIntermediacao({ quantidade, fabrica, frete, margem }: LinhaIntermediacao) {
  if (
    ![quantidade, fabrica, frete, margem].every(Number.isFinite) ||
    quantidade <= 0 ||
    !Number.isInteger(quantidade) ||
    fabrica <= 0 ||
    frete < 0 ||
    margem < 0
  )
    return null;
  const custoSaca = arredondar(fabrica + frete, 4),
    precoSaca = arredondar(custoSaca + margem, 4);
  return {
    custoSaca,
    precoSaca,
    fabricaTotal: arredondar(quantidade * fabrica),
    freteTotal: arredondar(quantidade * frete),
    custoTotal: arredondar(quantidade * custoSaca),
    margemTotal: arredondar(quantidade * margem),
    total: arredondar(quantidade * precoSaca),
  };
}
