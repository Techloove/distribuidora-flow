import { expect, test } from "bun:test";
import {
  condicoesSicredi,
  instrucaoSicredi,
  condicoesCorrespondem,
} from "../src/lib/sicredi-condicoes";
const bank = {
  valorNominal: 100,
  abatimento: 0,
  tipoDesconto: "A - VALOR",
  descontos: [{ numeroOrdem: 1, valorDesconto: 5, dataLimite: "2026-11-10" }],
  dataVencimento: "2026-11-20",
  situacao: "EM CARTEIRA",
};
const hoje = "2026-10-29";
test("contratos distintos: abatimento string com centavos, desconto numérico e dataN", () => {
  const c = condicoesSicredi(bank);
  expect(instrucaoSicredi(c, { tipo: "abatimento", valor: 10 }, hoje)).toMatchObject({
    endpoint: "conceder-abatimento",
    body: { valorAbatimento: "10.00" },
    esperado: { abatimento: 10, nominal: 100 },
  });
  expect(instrucaoSicredi(c, { tipo: "desconto", ordem: 1, valor: 7.5 }, hoje).body).toEqual({
    valorDesconto1: 7.5,
  });
  expect(
    instrucaoSicredi(c, { tipo: "data_desconto", ordem: 1, data: "2026-11-12" }, hoje).body,
  ).toEqual({ data1: "2026-11-12" });
  expect(
    instrucaoSicredi({ ...c, abatimento: 10 }, { tipo: "cancelar_abatimento" }, hoje).body,
  ).toEqual({});
});
test("não inventa tipo ou novo desconto para boleto sem desconto", () => {
  const c = condicoesSicredi({ ...bank, tipoDesconto: "NAO_TEM_DESCONTO", descontos: [] });
  expect(() => instrucaoSicredi(c, { tipo: "desconto", ordem: 1, valor: 5 }, hoje)).toThrow(
    "já cadastrado",
  );
  expect(instrucaoSicredi(c, { tipo: "abatimento", valor: 5 }, hoje).esperado.abatimento).toBe(5);
});
test("rejeita valor nominal arbitrário, percentuais, datas, status e combinação excessiva", () => {
  const c = condicoesSicredi(bank);
  for (const valor of [-1, 0, 100, 101, 0.001, NaN, Infinity])
    expect(() => instrucaoSicredi(c, { tipo: "abatimento", valor }, hoje)).toThrow();
  expect(() => instrucaoSicredi(c, { tipo: "abatimento", valor: 95 }, hoje)).toThrow(
    "todo o valor",
  );
  expect(() =>
    instrucaoSicredi({ ...c, abatimento: 10 }, { tipo: "abatimento", valor: 5 }, hoje),
  ).toThrow("Já existe");
  expect(() => instrucaoSicredi(c, { tipo: "cancelar_abatimento" }, hoje)).toThrow("Não há");
  for (const data of ["2026-02-30", "2026-10-28", "2026-11-21"])
    expect(() => instrucaoSicredi(c, { tipo: "data_desconto", ordem: 1, data }, hoje)).toThrow();
  for (const situacao of [
    "LIQUIDADO",
    "BAIXADO POR SOLICITACAO",
    "EM CARTORIO",
    "PROTESTADO",
    "EM CARTEIRA PIX",
    "",
  ])
    expect(() =>
      instrucaoSicredi({ ...c, situacao }, { tipo: "abatimento", valor: 10 }, hoje),
    ).toThrow();
  const p = condicoesSicredi({ ...bank, tipoDesconto: "B - PERCENTUAL" });
  expect(
    instrucaoSicredi(p, { tipo: "desconto", ordem: 1, valor: 10 }, hoje).esperado.tipoDesconto,
  ).toBe("PERCENTUAL");
  expect(() => instrucaoSicredi(p, { tipo: "desconto", ordem: 1, valor: 100 }, hoje)).toThrow();
  expect(() => instrucaoSicredi(c, { tipo: "valor" as "abatimento", valor: 110 }, hoje)).toThrow();
});
test("confirma somente snapshot completo; não confirma por status de PATCH", () => {
  const c = condicoesSicredi(bank),
    e = instrucaoSicredi(c, { tipo: "abatimento", valor: 10 }, hoje).esperado;
  expect(condicoesCorrespondem(c, e)).toBe(false);
  expect(condicoesCorrespondem({ ...e, situacao: "VENCIDO" }, e)).toBe(true);
  expect(condicoesCorrespondem({ ...e, nominal: 101 }, e)).toBe(false);
  expect(
    condicoesCorrespondem({ ...e, descontos: [{ ordem: 1, valor: 5, data: "2026-11-11" }] }, e),
  ).toBe(false);
  for (const bad of [
    { ...bank, abatimento: undefined },
    { ...bank, descontos: undefined },
    { ...bank, descontos: [...bank.descontos, ...bank.descontos] },
  ])
    expect(() => condicoesSicredi(bad)).toThrow();
});
