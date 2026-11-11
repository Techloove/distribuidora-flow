import { expect, test } from "bun:test";
import { periodoRecuperacaoSicoob } from "../src/lib/sicoob-api";

test("recuperação amplia o vencimento original em 30 dias em cada direção", () => {
  expect(periodoRecuperacaoSicoob("2026-11-14")).toEqual({
    dataInicio: "2026-10-15",
    dataFim: "2026-12-14",
  });
});

test("janela atravessa ano e fevereiro bissexto sem desvio de fuso", () => {
  expect(periodoRecuperacaoSicoob("2027-01-01")).toEqual({
    dataInicio: "2026-12-02",
    dataFim: "2027-01-31",
  });
  expect(periodoRecuperacaoSicoob("2028-03-01")).toEqual({
    dataInicio: "2028-01-31",
    dataFim: "2028-03-31",
  });
});

test("data ausente ou impossível impede consulta sem limites válidos", () => {
  for (const data of [undefined, "", "2026-02-30", "14/11/2026"])
    expect(() => periodoRecuperacaoSicoob(data)).toThrow("Data bancária inválida");
});
