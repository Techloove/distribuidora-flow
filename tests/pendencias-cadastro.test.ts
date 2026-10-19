import { expect, test } from "bun:test";
import { camposFaltantesCliente } from "../src/lib/pendencias-cadastro";
const completo = {
  tipo_pessoa: "PJ",
  cnpj_cpf: "12.345.678/0001-95",
  inscricao_estadual: "123456",
  rota_id: "rota",
  representante_id: "rep",
  logradouro: "Rua A",
  numero: "S/N",
  bairro: "Centro",
  cidade: "Cidade",
  uf: "ES",
  cep: "29000-000",
};
test("cadastro completo não gera pendência; cada campo solicitado é discriminado", () => {
  expect(camposFaltantesCliente(completo)).toEqual([]);
  expect(
    camposFaltantesCliente({
      ...completo,
      cnpj_cpf: "   ",
      inscricao_estadual: null,
      rota_id: null,
      representante_id: "",
      logradouro: " ",
      cep: null,
    }),
  ).toEqual(["CNPJ", "Inscrição estadual", "Rota", "Representante", "Endereço (logradouro, CEP)"]);
  expect(camposFaltantesCliente({ ...completo, numero: "" })).toEqual(["Endereço (número)"]);
});
test("isento, não contribuinte e pessoa física não recebem falsa pendência de IE", () => {
  for (const indicador_contribuinte_icms of [
    "2",
    "9",
    "2 - Contribuinte isento",
    "Não contribuinte",
  ])
    expect(
      camposFaltantesCliente({ ...completo, inscricao_estadual: "", indicador_contribuinte_icms }),
    ).toEqual([]);
  expect(camposFaltantesCliente({ ...completo, inscricao_estadual: "ISENTO" })).toEqual([]);
  expect(
    camposFaltantesCliente({
      ...completo,
      tipo_pessoa: "PF",
      cnpj_cpf: "...",
      inscricao_estadual: null,
    }),
  ).toEqual(["CPF"]);
  expect(
    camposFaltantesCliente({
      ...completo,
      inscricao_estadual: "",
      indicador_contribuinte_icms: "1",
    }),
  ).toEqual(["Inscrição estadual"]);
});

test("situação fiscal atual do cadastro unificado prevalece sobre a cópia antiga do cliente", () => {
  expect(
    camposFaltantesCliente({
      ...completo,
      inscricao_estadual: "",
      indicador_contribuinte_icms: "1",
      pessoa_fiscal: { indicador_contribuinte_icms: "9" },
    }),
  ).toEqual([]);
  expect(
    camposFaltantesCliente({
      ...completo,
      inscricao_estadual: "",
      indicador_contribuinte_icms: "NÃO ISENTO",
    }),
  ).toEqual(["Inscrição estadual"]);
});
