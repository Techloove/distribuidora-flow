import { expect, test } from "bun:test";
import { formatarEntradaMoeda, normalizarEntradaMoeda } from "../src/lib/entrada-moeda";

test("dinheiro sempre exibe vírgula e no mínimo duas casas, inclusive zero e centavos", () => {
  for (const [valor, esperado] of [
    [0, "0,00"],
    [0.5, "0,50"],
    [1.25, "1,25"],
    [1.3, "1,30"],
    [7.2, "7,20"],
    [1000, "1000,00"],
    [-0.5, "-0,50"],
  ] as const)
    expect(formatarEntradaMoeda(valor)).toBe(esperado);
});
test("formatação de dinheiro preserva custos com mais casas e campos opcionais vazios", () => {
  expect(formatarEntradaMoeda("1.2345")).toBe("1,2345");
  expect(formatarEntradaMoeda("27.0001")).toBe("27,0001");
  expect(formatarEntradaMoeda("")).toBe("");
  expect(formatarEntradaMoeda(null)).toBe("");
  expect(formatarEntradaMoeda("NaN")).toBe("");
});
test("digitação brasileira e colagem chegam aos cálculos como decimal canônico", () => {
  for (const [texto, esperado] of [
    ["0,50", "0.50"],
    ["1,30", "1.30"],
    ["1.25", "1.25"],
    ["1.2345", "1.2345"],
    ["R$ 1.234,50", "1234.50"],
    ["-0,50", "-0.50"],
    [",5", "0.5"],
    ["1,", "1"],
    ["", ""],
    ["-", ""],
  ])
    expect(normalizarEntradaMoeda(texto)).toBe(esperado);
  for (const s of ["abc", "NaN", "Infinity", "1,2,3", "12.34,50", "1.2.3", "1e3"])
    expect(normalizarEntradaMoeda(s)).toBeNull();
});
