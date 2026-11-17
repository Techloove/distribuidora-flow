import { test, expect } from "bun:test";
import {
  valorTitulo,
  previsaoTitulo,
  subcategoriasTitulo,
  type CategoriaTitulo,
} from "../src/lib/lancamento-titulo";
test("valor brasileiro preserva centavos e rejeita texto ou precisão indevida", () => {
  for (const [texto, valor] of [
    ["R$ 1.234,56", 1234.56],
    ["2,90", 2.9],
    ["1234.56", 1234.56],
    ["1.234", 1234],
    ["10", 10],
  ] as const)
    expect(valorTitulo(texto)).toBe(valor);
  for (const t of ["", "-10", "10x", "1,234", "1.234,567", "1,2,3"])
    expect(Number.isNaN(valorTitulo(t))).toBe(true);
});
test("prévia replica o ajuste na última parcela, sem perder centavos nem deslocar data", () => {
  expect(previsaoTitulo(100, 3, "2026-10-31", 30)).toEqual({
    valor: 100,
    parcelas: 3,
    primeira: 33.33,
    ultima: 33.34,
    inicio: "2026-10-31",
    fim: "2026-12-30",
  });
  expect(previsaoTitulo(100, 6, "2026-10-31", 30)?.ultima).toBe(16.65);
  for (const args of [
    [0.03, 5, "2026-10-31", 30],
    [100, 2.5, "2026-10-31", 30],
    [100, 2, "2026-02-30", 30],
    [100, 2, "2026-10-31", 0],
    [NaN, 1, "2026-10-31", 30],
  ] as const)
    expect(previsaoTitulo(...args)).toBeNull();
});
test("subcategorias pertencem à categoria escolhida e mostram níveis sem loops", () => {
  const c = (id: string, parent_id: string | null, nome = id, ativo = true): CategoriaTitulo => ({
    id,
    parent_id,
    nome,
    ativo,
    tipo: "despesa",
  });
  const cats = [
    c("A", null),
    c("B", null),
    c("A1", "A", "Transporte"),
    c("A2", "A1", "Frete"),
    c("B1", "B"),
    c("inativa", "A", "Inativa", false),
    c("A", "A2"),
  ];
  expect(subcategoriasTitulo(cats, "A")).toEqual([
    { id: "A1", nome: "Transporte" },
    { id: "A2", nome: "Transporte › Frete" },
  ]);
  expect(subcategoriasTitulo(cats, "B")).toEqual([{ id: "B1", nome: "B1" }]);
});

test("prévia detalhada mostra documento, data e valor de cada parcela semanal", async () => {
  const { parcelasPrevistasTitulo, documentoParcelaTitulo } =
    await import("../src/lib/lancamento-titulo");
  const previa = previsaoTitulo(5000, 4, "2026-11-18", 7)!;
  expect(parcelasPrevistasTitulo(previa, "SN10", 7)).toEqual([
    { parcela: 1, documento: "SN10/1", vencimento: "2026-11-18", valor: 1250 },
    { parcela: 2, documento: "SN10/2", vencimento: "2026-11-25", valor: 1250 },
    { parcela: 3, documento: "SN10/3", vencimento: "2026-12-02", valor: 1250 },
    { parcela: 4, documento: "SN10/4", vencimento: "2026-12-09", valor: 1250 },
  ]);
  expect(documentoParcelaTitulo(" NF/2026 ", 2)).toBe("NF/2026/2");
  expect(documentoParcelaTitulo("", 1)).toBe("—");
  expect(documentoParcelaTitulo("SN10", null)).toBe("SN10");
});
test("todas as parcelas mantêm o total e o ajuste de centavos, inclusive em outra página", async () => {
  const { parcelasPrevistasTitulo } = await import("../src/lib/lancamento-titulo");
  const previa = previsaoTitulo(100, 6, "2026-12-31", 7)!;
  const itens = parcelasPrevistasTitulo(previa, "AJUSTE", 7);
  expect(itens.map((p) => Math.round(p.valor * 100))).toEqual([1667, 1667, 1667, 1667, 1667, 1665]);
  expect(itens.reduce((s, p) => s + Math.round(p.valor * 100), 0)).toBe(10000);
  expect(itens.at(-1)?.vencimento).toBe("2027-02-04");
  const muitas = previsaoTitulo(250, 25, "2026-11-18", 7)!;
  expect(parcelasPrevistasTitulo(muitas, "SN10", 7)).toHaveLength(12);
  expect(parcelasPrevistasTitulo(muitas, "SN10", 7, 24)).toEqual([
    { parcela: 25, documento: "SN10/25", vencimento: "2027-05-05", valor: 10 },
  ]);
  expect(parcelasPrevistasTitulo(muitas, "SN10", 7, 25)).toEqual([]);
  expect(parcelasPrevistasTitulo(muitas, "SN10", 7, 0, 0)).toEqual([]);
});
