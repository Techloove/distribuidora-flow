import { expect, test } from "bun:test";
import {
  CONFIG_COMPRA,
  calcularCompra,
  validarConfigCompra,
  qtdCompra,
} from "../src/lib/planejamento-compras";
const fonte = {
  estoque_atual: 50,
  estoque_minimo: 20,
  estoque_maximo: 200,
  pendencia_aprovada: 10,
  em_transito: 15,
  venda_30: 90,
  venda_60: 150,
  venda_90: 180,
  venda_120: 210,
  prazo_fornecedor_dias: 10,
  unidade: "UN",
  custo_referencia: 2.9,
  dias_historico: 120,
};
test("cobertura usa saldo, pendências aprovadas, trânsito, prazo e mínimo sem duplicar a baixa", () => {
  const c = calcularCompra(fonte, CONFIG_COMPRA);
  expect(c.diario).toBe(2);
  expect(c.posicao).toBe(55);
  expect(c.alvo).toBe(100);
  expect(c.sugestao).toBe(45);
  expect(c.investimento).toBe(130.5);
  expect(c.cobertura).toBe(20);
  expect(
    calcularCompra({ ...fonte, pendencia_digitacao: 1000, pendencia_analise: 1000 }, CONFIG_COMPRA)
      .sugestao,
  ).toBe(45);
  const negativo = calcularCompra(
    { ...fonte, estoque_atual: -20, pendencia_aprovada: 0 },
    { ...CONFIG_COMPRA, metodo: "pendencias" },
  );
  expect(negativo.sugestao).toBe(5); // Trânsito15 compensa parte do déficit20 já no estoque.
});
test("mínimo, mínimo/máximo e pendências têm objetivos distintos", () => {
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, metodo: "minimo" }).sugestao).toBe(0);
  expect(
    calcularCompra({ ...fonte, estoque_atual: 10 }, { ...CONFIG_COMPRA, metodo: "minmax" })
      .sugestao,
  ).toBe(185);
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, metodo: "minmax" }).sugestao).toBe(0);
  expect(
    calcularCompra({ ...fonte, estoque_maximo: 0 }, { ...CONFIG_COMPRA, metodo: "minmax" }).erros
      .length,
  ).toBeGreaterThan(0);
  expect(
    calcularCompra(
      { ...fonte, estoque_atual: 0, pendencia_aprovada: 30 },
      { ...CONFIG_COMPRA, metodo: "pendencias" },
    ).sugestao,
  ).toBe(15);
});
test("bases acumuladas e ponderação usam faixas mensais sem contar 30d repetidamente", () => {
  const esperado = { "30": 3, "60": 2.5, "90": 2, "120": 1.75, ponderada: 2.1 };
  for (const [base, diario] of Object.entries(esperado))
    expect(calcularCompra(fonte, { ...CONFIG_COMPRA, base: base as "30" }).diario).toBeCloseTo(
      diario,
      8,
    );
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, ajuste: 50 }).diario).toBe(3);
  expect(
    calcularCompra(fonte, { ...CONFIG_COMPRA, usarPrazoProduto: false, prazoPadrao: 20 }).prazo,
  ).toBe(20);
  expect(
    calcularCompra({ ...fonte, prazo_fornecedor_dias: 0 }, { ...CONFIG_COMPRA, prazoPadrao: 7 })
      .prazo,
  ).toBe(7);
});
test("múltiplo e lote mínimo nunca compram abaixo da necessidade e não compram sem déficit", () => {
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, multiplo: 12 }).sugestao).toBe(48);
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, multiplo: 12, loteMinimo: 60 }).sugestao).toBe(
    60,
  );
  expect(
    calcularCompra({ ...fonte, estoque_atual: 500 }, { ...CONFIG_COMPRA, loteMinimo: 60 }).sugestao,
  ).toBe(0);
  const f = {
    ...fonte,
    estoque_atual: 0,
    estoque_minimo: 0,
    pendencia_aprovada: 0.3,
    em_transito: 0,
    unidade: "KG",
  };
  expect(calcularCompra(f, { ...CONFIG_COMPRA, metodo: "pendencias" }).sugestao).toBe(0.3);
  expect(
    calcularCompra({ ...f, unidade: "UN" }, { ...CONFIG_COMPRA, metodo: "pendencias" }).sugestao,
  ).toBe(1);
});
test("trânsito é opção explícita, ruptura não é escondida por uma entrega ainda não recebida", () => {
  expect(calcularCompra(fonte, { ...CONFIG_COMPRA, considerarTransito: false }).sugestao).toBe(60);
  const c = calcularCompra({ ...fonte, estoque_atual: -20, em_transito: 200 }, CONFIG_COMPRA);
  expect(c.sugestao).toBe(0);
  expect(c.status).toBe("Ruptura");
  expect(c.avisos.some((v) => v.includes("data de chegada"))).toBe(true);
});
test("configurações inconsistentes, dados inválidos e histórico curto não viram compra automática", () => {
  for (const config of [
    { ...CONFIG_COMPRA, cobertura: -1 },
    { ...CONFIG_COMPRA, cobertura: NaN },
    { ...CONFIG_COMPRA, ajuste: 301 },
    { ...CONFIG_COMPRA, multiplo: 0.0001 },
  ]) {
    expect(validarConfigCompra(config).length).toBeGreaterThan(0);
    expect(calcularCompra(fonte, config).sugestao).toBe(0);
  }
  expect(calcularCompra({ ...fonte, venda_60: 50 }, CONFIG_COMPRA).erros.length).toBeGreaterThan(0);
  expect(calcularCompra({ ...fonte, custo_referencia: null }, CONFIG_COMPRA).investimento).toBe(
    null,
  );
  expect(calcularCompra({ ...fonte, dias_historico: 5 }, CONFIG_COMPRA).diario).toBe(2);
  expect(
    calcularCompra({ ...fonte, dias_historico: 5 }, CONFIG_COMPRA).avisos.some((v) =>
      v.includes("Histórico recente"),
    ),
  ).toBe(true);
  expect(qtdCompra(NaN)).toBe("—");
  expect(qtdCompra(1234.5)).toBe("1.234,5");
});
