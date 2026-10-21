import { expect, test } from "bun:test";
import { tarifaComum, chaveGrupo } from "../src/lib/frete-volume-grade";
const cidade = { cidade: "VENDA NOVA", uf: "ES" };
test("grade conserva tarifa comum e identifica preços parciais ou diferentes sem escolher um deles", () => {
  const tarifas = [
    { ...cidade, produto_id: "a", valor_unitario: 2.5, ativo: true },
    { ...cidade, produto_id: "b", valor_unitario: 2.5, ativo: true },
  ];
  expect(tarifaComum(cidade, ["a", "b"], tarifas)).toEqual({
    valor: "2.5",
    ativo: true,
    situacao: "Ativa",
  });
  expect(tarifaComum(cidade, ["a", "b"], [tarifas[0]!]).situacao).toContain("parciais");
  expect(
    tarifaComum(cidade, ["a", "b"], [tarifas[0]!, { ...tarifas[1]!, valor_unitario: 3 }]).valor,
  ).toBe("");
  expect(
    tarifaComum(cidade, ["a", "b"], [tarifas[0]!, { ...tarifas[1]!, ativo: false }]).situacao,
  ).toContain("diferentes");
  expect(tarifaComum({ ...cidade, uf: "MG" }, ["a"], tarifas).situacao).toBe("Sem tarifa");
  expect(tarifaComum(cidade, [], tarifas).valor).toBe("");
  expect(chaveGrupo("  Címento  e Argamassa ")).toBe("CIMENTO E ARGAMASSA");
});
