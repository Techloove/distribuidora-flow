import { expect, test } from "bun:test";
import { recalcularBaixa } from "../src/lib/baixa-titulo";
test("recalcula juros, multa e desconto novos em centavos", () => {
  expect(recalcularBaixa(100, 10, 2, 5)).toEqual({
    saldo: 100,
    juros: 10,
    multa: 2,
    desconto: 5,
    total: 107,
  });
  expect(recalcularBaixa(0.1, 0.2, 0, 0)?.total).toBe(0.3);
  expect(recalcularBaixa(100, 0, 0, 15)?.total).toBe(85);
});
test("saldo de título parcial ou ajustado não reaplica valores anteriores", () => {
  // Saldo já considera encargos anteriores e recebimentos. Somente o incremento muda.
  expect(recalcularBaixa(112, 10, 0, 5)?.total).toBe(117);
  expect(recalcularBaixa(40, 5, 2, 3)?.total).toBe(44);
});
test("rejeita ajustes negativos, não finitos e desconto maior que o devido", () => {
  for (const args of [
    [100, -1, 0, 0],
    [100, 0, -1, 0],
    [100, 0, 0, -1],
    [100, 0, 0, 101],
    [100, NaN, 0, 0],
    [Infinity, 0, 0, 0],
  ] as const)
    expect(recalcularBaixa(...args)).toBeNull();
  expect(recalcularBaixa(100, 0, 0, 100)?.total).toBe(0);
});
