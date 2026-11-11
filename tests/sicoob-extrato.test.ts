import { test, expect } from "bun:test";
import {
  consultaExtratoSicoob,
  valorExtratoSicoob,
  extratoParaConferenciaSicoob,
} from "../src/lib/sicoob-extrato";
test("extrato permite apenas a janela documentada, sem agrupamento", () => {
  expect(consultaExtratoSicoob("2016001", "2026-11", 1, 11, "2026-11-11")).toBe(
    "/extrato/11/2026?diaInicial=1&diaFinal=11&agruparCNAB=false&numeroContaCorrente=2016001",
  );
  expect(() => consultaExtratoSicoob("123", "2026-08", 1, 31, "2026-11-11")).not.toThrow();
  for (const [conta, mes, a, b] of [
    ["123", "2026-07", 1, 2],
    ["123", "2026-12", 1, 2],
    ["123", "2026-11", 1, 12],
    ["123", "2026-11", 10, 1],
    ["123", "2026-09", 1, 31],
    ["201.600-1", "2026-11", 1, 2],
    ["123", "2026-13", 1, 2],
    ["123", "2026-11", 1, 1.5],
  ] as const)
    expect(() => consultaExtratoSicoob(conta, mes, a, b, "2026-11-11")).toThrow();
});
test("valores ambíguos não viram dinheiro por suposição", () => {
  for (const [v, n] of [
    ["1.234,56", 1234.56],
    ["1234.56", 1234.56],
    ["1,02", 1.02],
    ["-1,02", -1.02],
    [0, 0],
  ] as const)
    expect(valorExtratoSicoob(v)).toBe(n);
  for (const v of ["1.234", "string", "R$ 1,02", {}, null, Infinity])
    expect(valorExtratoSicoob(v)).toBeNull();
});
test("conferência retira CPF e saldos, aceita identificador ausente e não transforma histórico em baixa", () => {
  const r = extratoParaConferenciaSicoob({
    saldoAtual: "privado",
    transacoes: [
      {
        tipo: "DEBITO",
        valor: "1,02",
        data: "2026-11-10",
        descricao: "TARIFA BAIXA",
        numeroDocumento: "123",
        cpfCnpj: "nao-retornar",
        descInfComplementar: "Boleto",
        transactionId: "evt-1",
      },
      { tipo: "CREDITO", valor: "100.00", descricao: "RECEBIMENTO" },
    ],
  });
  expect(r[0]).toMatchObject({ id: "evt-1", valor: 1.02, possivelTarifa: true });
  expect(r[1]).toMatchObject({ id: "", possivelTarifa: false });
  expect(JSON.stringify(r)).not.toMatch(/saldoAtual|cpfCnpj|nao-retornar|privado/);
  expect(() => extratoParaConferenciaSicoob({})).toThrow();
  expect(() => extratoParaConferenciaSicoob({ transacoes: [null] })).toThrow();
});

test("extrato aceita envelope resultado, sem confundir ausência de transações com limite", () => {
  expect(
    extratoParaConferenciaSicoob({
      resultado: { transacoes: [{ tipo: "DEBITO", valor: "1.02", descricao: "TARIFA" }] },
    })[0],
  ).toMatchObject({ valor: 1.02 });
  expect(extratoParaConferenciaSicoob({ transacoes: [] })).toEqual([]);
  expect(() =>
    extratoParaConferenciaSicoob({
      resultado: { transacoes: null, saldoAtual: "VALOR_PRIVADO" },
      access_token: "TOKEN_PRIVADO",
    }),
  ).toThrow("não trouxe a lista");
  try {
    extratoParaConferenciaSicoob({
      resultado: { saldoAtual: "VALOR_PRIVADO" },
      access_token: "TOKEN_PRIVADO",
    });
  } catch (e) {
    expect(String(e)).not.toMatch(/VALOR_PRIVADO|TOKEN_PRIVADO/);
  }
  expect(() => extratoParaConferenciaSicoob({ transacoes: Array(10001).fill({}) })).toThrow(
    "10.000",
  );
});
