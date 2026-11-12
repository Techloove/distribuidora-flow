import { expect, test } from "bun:test";
import { camposDivergentesBoletoSicoob, type CondicoesSicoob } from "../src/lib/sicoob-api";
const c: CondicoesSicoob = {
  numeroCliente: 123,
  codigoModalidade: 1,
  seuNumero: "origem",
  nossoNumero: "3849",
  valor: 25,
  vencimento: "2026-11-15",
  abatimento: 0,
  tipoDesconto: 0,
  descontos: [],
  situacao: "EM ABERTO",
  linhaDigitavel: "",
  codigoBarras: "",
};
const b = { seu_numero: "origem", nosso_numero: null, valor: 25 },
  cfg = { numero_cliente: 123, numero_conta: 456 };
test("diagnóstico preserva conferência estrita e nosso número automático na primeira resposta", () => {
  expect(camposDivergentesBoletoSicoob(c, b, cfg, { numeroContaCorrente: 456 })).toEqual([]);
  expect(camposDivergentesBoletoSicoob(c, { ...b, nosso_numero: "3849" }, cfg, {})).toEqual([]);
  for (const [extra, campo] of [
    [{ numeroCliente: 321 }, "beneficiário (numeroCliente)"],
    [{ codigoModalidade: 3 }, "modalidade"],
    [{ seuNumero: "outra-origem" }, "identificador do título (seuNumero)"],
    [{ valor: 50 }, "valor nominal"],
  ] as const) {
    expect(camposDivergentesBoletoSicoob({ ...c, ...extra }, b, cfg, {})).toEqual([campo]);
  }
  expect(camposDivergentesBoletoSicoob(c, { ...b, nosso_numero: "3850" }, cfg, {})).toEqual([
    "nosso número",
  ]);
  expect(camposDivergentesBoletoSicoob(c, b, cfg, { numeroContaCorrente: 999 })).toEqual([
    "conta corrente",
  ]);
});
test("diagnóstico nunca interpola valores bancários, CPF ou credenciais", () => {
  const campos = camposDivergentesBoletoSicoob({ ...c, seuNumero: "token=segredo" }, b, cfg, {
    numeroContaCorrente: "senha=privada",
    pagador: { numeroCpfCnpj: "11122233300" },
  });
  expect(campos).toEqual(["identificador do título (seuNumero)", "conta corrente"]);
  expect(campos.join()).not.toMatch(/segredo|privada|11122233300/);
});
