import { expect, test } from "bun:test";
import { calcularItemCompra } from "../src/lib/custo-compra";
test("compra soma o frete de cada unidade antes de multiplicar e mantém quatro casas", () => {
  expect(calcularItemCompra("500", "27", "5.5")).toEqual({ unitario: 32.5, total: 16250 });
  expect(calcularItemCompra("1.5", "1.23456", "0.12345")).toEqual({
    unitario: 1.3581,
    total: 2.04,
  });
  expect(calcularItemCompra("2", "10", "0")).toEqual({ unitario: 10, total: 20 });
});
test("compra não sugere total com quantidade, custo ou frete inválidos", () => {
  for (const campos of [
    ["0", "1", "0"],
    ["1", "-1", "0"],
    ["1", "1", "-1"],
    ["1", "", "0"],
    ["1", "1", ""],
    ["NaN", "1", "0"],
    ["1", "Infinity", "0"],
  ])
    expect(calcularItemCompra(...(campos as [string, string, string]))).toBeNull();
});
