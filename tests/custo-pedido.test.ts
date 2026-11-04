import { expect, test } from "bun:test";
import { custoItemPedido } from "../src/lib/custo-pedido";

test("custo preservado independe de atualização do produto e preserva zero", () => {
  for (const custo_medio of [0, 10, 14, 100]) {
    expect(custoItemPedido({ custo_unitario_base: "10" }, { custo_medio }, false)).toEqual({
      valor: 10,
      estimado: false,
    });
    expect(custoItemPedido({ custo_unitario_base: 0 }, { custo_medio }, false)).toEqual({
      valor: 0,
      estimado: false,
    });
  }
  expect(custoItemPedido({ custo_unitario_base: 12 }, undefined, false).valor).toBe(12);
});
test("legado sem snapshot usa custo positivo e identifica estimativa", () => {
  expect(custoItemPedido({}, { custo_medio: 0, preco_custo: 12, ultimo_custo: 15 }, false)).toEqual(
    { valor: 12, estimado: true },
  );
  expect(
    custoItemPedido({}, { custo_medio: null, preco_custo: 0, ultimo_custo: 15 }, false).valor,
  ).toBe(15);
  expect(custoItemPedido({}, { custo_medio: 0 }, false)).toEqual({ valor: null, estimado: true });
});
test("intermediação mantém custo próprio e não usa custo do estoque", () => {
  expect(custoItemPedido({ custo_unitario_base: 32.5 }, { custo_medio: 500 }, true)).toEqual({
    valor: 32.5,
    estimado: false,
  });
  expect(custoItemPedido({}, { custo_medio: 500 }, true).valor).toBeNull();
});
