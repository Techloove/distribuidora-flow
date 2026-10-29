import { expect, test } from "bun:test";
import {
  camposFaltantesCliente,
  pendenciasComerciaisCliente,
  decorarPendenciasClientes,
  filtroPendenciaCliente,
} from "../src/lib/pendencias-cadastro";
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

test("pendências comerciais usam cadastro, incluindo limite vazio/zero, e não saldo utilizado", () => {
  for (const limite_credito of [null, undefined, "", 0, "0", "0.00"])
    expect(pendenciasComerciaisCliente({ ...completo, limite_credito })).toEqual({
      sem_loja: false,
      sem_rota: false,
      sem_representante: false,
      sem_limite: true,
    });
  expect(
    pendenciasComerciaisCliente({
      ...completo,
      rota_id: " ",
      representante_id: null,
      limite_credito: 500,
      saldo_disponivel: 0,
    }),
  ).toEqual({ sem_loja: false, sem_rota: true, sem_representante: true, sem_limite: false });
  expect(pendenciasComerciaisCliente({ ...completo, limite_credito: "0.01" }).sem_limite).toBe(
    false,
  );
});

test("filtros comerciais excluem fornecedores sem função cliente e preservam os dados originais", () => {
  const origem = [
    { ...completo, id: "cliente", is_cliente: true, limite_credito: 0, rota_id: null },
    { id: "fornecedor", is_fornecedor: true, limite_credito: 0 },
  ];
  const decorados = decorarPendenciasClientes(origem);
  expect(decorados[0]).toMatchObject({
    _cadastro_rota: "sem",
    _cadastro_representante: "com",
    _cadastro_limite: "sem",
  });
  expect(decorados[1]).toMatchObject({
    _cadastro_rota: "",
    _cadastro_representante: "",
    _cadastro_limite: "",
  });
  expect(origem[0]).not.toHaveProperty("_cadastro_rota");
  expect(filtroPendenciaCliente("sem_rota")).toBe("sem_rota");
  expect(filtroPendenciaCliente("sem_limite")).toBe("sem_limite");
  expect(filtroPendenciaCliente(["sem_rota"])).toBeUndefined();
  expect(filtroPendenciaCliente("qualquer")).toBeUndefined();
});

test("filtros por loja distinguem loja específica de cadastro compartilhado", () => {
  const rows = decorarPendenciasClientes([
    { is_cliente: true, centro_id: "loja-a" },
    { is_cliente: true, centro_id: null },
    { is_cliente: false, centro_id: "loja-a" },
  ]);
  expect(rows[0]).toMatchObject({ _cadastro_loja: "especifica", _cadastro_loja_id: "loja-a" });
  expect(rows[1]).toMatchObject({ _cadastro_loja: "compartilhado", _cadastro_loja_id: "" });
  expect(rows[2]).toMatchObject({ _cadastro_loja: "", _cadastro_loja_id: "" });
});

test("sem loja é explícito e não confunde clientes legados compartilhados", () => {
  const rows = decorarPendenciasClientes([
    { is_cliente: true, centro_id: null, loja_pendente: true },
    { is_cliente: true, centro_id: null },
    { is_cliente: true, centro_id: "loja-a", loja_pendente: false },
  ]);
  expect(rows.map((r) => r._cadastro_loja)).toEqual(["sem", "compartilhado", "especifica"]);
  expect(pendenciasComerciaisCliente({ centro_id: null }).sem_loja).toBe(false);
  expect(pendenciasComerciaisCliente({ centro_id: null, loja_pendente: true }).sem_loja).toBe(true);
  expect(filtroPendenciaCliente("sem_loja")).toBe("sem_loja");
});
