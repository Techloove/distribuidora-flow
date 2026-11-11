import { test, expect } from "bun:test";
import {
  condicoesEmissaoSicoob,
  validarEmissaoSicoob,
  padraoEmissaoSicoob as padrao,
} from "../src/lib/sicoob-emissao";
const gerar = (c: unknown, valor = 100) =>
  condicoesEmissaoSicoob(c, "2027-01-10", valor, "2026-12-01");
test("padrões Sicoob não enviam encargos opcionais nem número bancário", () => {
  const b = gerar(undefined);
  expect(b).toEqual({
    codigoEspecieDocumento: "DM",
    tipoFormularioImpressaoPDF: 1,
    codigoCadastrarPIX: 2,
    tipoMulta: 0,
    tipoJurosMora: 3,
    tipoDesconto: 0,
    codigoProtesto: 3,
    codigoNegativacao: 3,
  });
  expect(JSON.stringify(b)).not.toMatch(/null/);
});
test("encargos, desconto e limites calculam datas de calendário em virada de ano", () => {
  const b = gerar({
    ...padrao,
    multaTipo: 2,
    multaValor: 2,
    multaDias: 1,
    jurosTipo: 2,
    jurosValor: 1,
    jurosDias: 2,
    descontoTipo: 1,
    descontoValor: 5,
    descontoDias: 15,
    limiteDias: 60,
    protestoTipo: 2,
    protestoDias: 30,
    negativacaoTipo: 2,
    negativacaoDias: 60,
    formulario: 2,
    pix: 1,
    instrucoes: "Favor pagar até o vencimento.\nObrigado.",
  });
  expect(b).toMatchObject({
    dataMulta: "2027-01-11",
    valorMulta: 2,
    dataJurosMora: "2027-01-12",
    valorJurosMora: 1,
    dataPrimeiroDesconto: "2026-12-26",
    valorPrimeiroDesconto: 5,
    dataLimitePagamento: "2027-03-11",
    numeroDiasProtesto: 30,
    numeroDiasNegativacao: 60,
    tipoFormularioImpressaoPDF: 2,
    codigoCadastrarPIX: 1,
    mensagensInstrucao: ["Favor pagar até o vencimento.", "Obrigado."],
  });
});
test("campos numéricos rejeitam códigos desconhecidos, negativos e limites inválidos", () => {
  for (const c of [
    { multaTipo: 4 },
    { jurosTipo: 0 },
    { descontoTipo: 3 },
    { protestoTipo: 0 },
    { negativacaoTipo: 1 },
    { formulario: 4 },
    { pix: 3 },
    { multaDias: 0 },
    { protestoDias: 100 },
    { jurosDias: 1.5 },
    { multaTipo: 2, multaValor: 101 },
    { jurosTipo: 1, jurosValor: -2 },
    { multaTipo: 1, multaValor: 1.001 },
    { multaTipo: 1, multaValor: 2, multaDias: 5, limiteDias: 3 },
    { especie: "INVALIDA" },
  ])
    expect(() => validarEmissaoSicoob({ ...padrao, ...c })).toThrow();
});
test("desconto precisa ser possível para o título e a data de emissão", () => {
  expect(() => gerar({ ...padrao, descontoTipo: 1, descontoValor: 100 })).toThrow();
  expect(() => gerar({ ...padrao, descontoTipo: 2, descontoValor: 100 })).toThrow();
  expect(() => gerar({ ...padrao, descontoTipo: 2, descontoValor: 2, descontoDias: 60 })).toThrow();
  expect(() => condicoesEmissaoSicoob(padrao, "2027-02-30", 100, "2027-01-01")).toThrow();
});
test("instruções respeitam cinco linhas de quarenta caracteres", () => {
  expect(() => validarEmissaoSicoob({ ...padrao, instrucoes: "x".repeat(41) })).toThrow();
  expect(() => validarEmissaoSicoob({ ...padrao, instrucoes: "a\n".repeat(5) })).toThrow();
  expect(validarEmissaoSicoob({ ...padrao, instrucoes: "x".repeat(40) }).instrucoes).toHaveLength(
    40,
  );
});
