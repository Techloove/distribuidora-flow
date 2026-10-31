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
