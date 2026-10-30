import { expect, test } from "bun:test";
import { calcularIntermediacao } from "../src/lib/intermediacao";
test("cem sacas cobram fábrica, frete e margem, mas o ganho dos itens é somente a margem", () => {
  expect(calcularIntermediacao({ quantidade: 100, fabrica: 28.5, frete: 3, margem: 2.5 })).toEqual({
    custoSaca: 31.5,
    precoSaca: 34,
    fabricaTotal: 2850,
    freteTotal: 300,
    custoTotal: 3150,
    margemTotal: 250,
    total: 3400,
  });
});
test("precificação conserva quatro casas unitárias e arredonda total monetário a centavos", () => {
  const c = calcularIntermediacao({
    quantidade: 3,
    fabrica: 28.1234,
    frete: 1.2345,
    margem: 2.3456,
  })!;
  expect(c.custoSaca).toBe(29.3579);
  expect(c.precoSaca).toBe(31.7035);
  expect(c.total).toBe(95.11);
  expect(c.margemTotal).toBe(7.04);
});
test("não sugere preço com cotação ausente, fração de saca ou custos inválidos", () => {
  const base = { quantidade: 1, fabrica: 20, frete: 0, margem: 0 };
  expect(calcularIntermediacao(base)?.total).toBe(20);
  for (const patch of [
    { fabrica: 0 },
    { quantidade: 0 },
    { quantidade: 1.5 },
    { frete: -1 },
    { margem: -1 },
    { fabrica: NaN },
    { quantidade: Infinity },
  ])
    expect(calcularIntermediacao({ ...base, ...patch })).toBeNull();
});
