import { expect, test } from "bun:test";
import { montarPreviaForecast, type ContextoForecast } from "../src/lib/forecast-previa";

import { fixture } from "./fixtures/forecast";
test("prévia determinística confere valores e não libera emissão nem modifica a origem", () => {
  const c = fixture(),
    antes = JSON.stringify(c);
  const r = montarPreviaForecast(c);
  expect(r.pendencias).toEqual([]);
  expect(r.cadastro_conferido).toBe(true);
  expect(r.emissao_disponivel).toBe(false);
  expect(r.confirmacoes_externas.length).toBeGreaterThan(0);
  expect(r.payload_proposto?.ambiente).toBe("HOMOLOGACAO");
  expect(r.payload_proposto?.cnpj_emitente).toBe("12345678000195");
  expect(r.payload_proposto?.items[0]?.cfop).toBe("5102");
  expect(r.payload_proposto?.nome_destinatario).toContain("SEM VALOR FISCAL");
  expect(montarPreviaForecast(c).payload_proposto?.ref).toBe(r.payload_proposto?.ref);
  expect(JSON.stringify(c)).toBe(antes);
});
test("bloqueia produção, token ausente e vínculo de outro CNPJ", () => {
  for (const alterar of [
    (c: ContextoForecast) => (c.conexao.ambiente_declarado = "producao"),
    (c: ContextoForecast) => (c.conexao.token_configurado = false),
    (c: ContextoForecast) => (c.conexao.vinculo_atual = false),
    (c: ContextoForecast) => (c.conexao.cnpj_configurado = "99999999000199"),
  ]) {
    const c = fixture();
    alterar(c);
    const r = montarPreviaForecast(c);
    expect(r.cadastro_conferido).toBe(false);
    expect(r.payload_proposto).toBeNull();
    expect(r.emissao_disponivel).toBe(false);
  }
});
test("concilia descontos, acréscimos, frete simples e por volume conforme motor do ERP", () => {
  const c = fixture();
  Object.assign(c.pedido, {
    frete_valor: "2.50",
    frete_volume_valor: "7.50",
    outras_despesas: "1.25",
    forma_acrescimo_valor: "3.75",
    desconto_valor: "5.00",
    forma_desconto_valor: "2.00",
    total_liquido: 108,
  });
  c.nota["valor_total"] = 108;
  const r = montarPreviaForecast(c);
  expect(r.pendencias).toEqual([]);
  expect(r.payload_proposto?.valor_frete).toBe("10.00");
  expect(r.payload_proposto?.valor_desconto).toBe("7.00");
  expect(r.payload_proposto?.valor_outras_despesas).toBe("5.00");
  expect(r.payload_proposto?.valor_total).toBe("108.00");
  c.nota["valor_total"] = 109;
  expect(montarPreviaForecast(c).payload_proposto).toBeNull();
});
test("arredonda apenas o resultado da multiplicação descontada, em centavos", () => {
  const c = fixture();
  Object.assign(c.itens[0]!.item, {
    quantidade: "3",
    preco_unitario: "0.335",
    desconto_percentual: "10",
    total: "0.90",
  });
  Object.assign(c.pedido, { total_itens: "0.90", total_liquido: "0.90" });
  c.nota["valor_total"] = "0.90";
  const r = montarPreviaForecast(c);
  expect(r.pendencias).toEqual([]);
  expect(r.payload_proposto?.items[0]?.valor_bruto).toBe("1.01");
  expect(r.payload_proposto?.items[0]?.valor_desconto).toBe("0.11");
  c.itens[0]!.item["total"] = "0.91";
  expect(montarPreviaForecast(c).payload_proposto).toBeNull();
});
test("rejeita NaN, negativos, expoentes, centavos imprecisos, preço e quantidade zero", () => {
  for (const [campo, valor] of [
    ["quantidade", 0],
    ["quantidade", "1.00001"],
    ["quantidade", -1],
    ["preco_unitario", 0],
    ["preco_unitario", "1e3"],
    ["preco_unitario", NaN],
    ["desconto_percentual", 101],
    ["total", "100.001"],
  ] as const) {
    const c = fixture();
    c.itens[0]!.item[campo] = valor;
    expect(montarPreviaForecast(c).payload_proposto).toBeNull();
  }
});
test("recusa nota já autorizada, vínculos divergentes, produto de outra loja e cadastro incompleto", () => {
  for (const alterar of [
    (c: ContextoForecast) => (c.nota["chave_acesso"] = "123"),
    (c: ContextoForecast) => (c.nota["protocolo"] = "123"),
    (c: ContextoForecast) => (c.nota["status"] = "autorizada"),
    (c: ContextoForecast) => (c.pedido["centro_id"] = "00000000-0000-4000-8000-000000000099"),
    (c: ContextoForecast) => (c.nota["cliente_id"] = "00000000-0000-4000-8000-000000000099"),
    (c: ContextoForecast) => (c.itens[0]!.disponivel_loja = false),
    (c: ContextoForecast) => (c.itens[0]!.produto["origem_fiscal"] = ""),
    (c: ContextoForecast) => (c.fiscal["revisado_contador"] = false),
    (c: ContextoForecast) => (c.fiscal["serie"] = "2"),
    (c: ContextoForecast) => (c.cliente["cep"] = "123"),
    (c: ContextoForecast) => (c.cliente["indicador_contribuinte_icms"] = ""),
    (c: ContextoForecast) => (c.cliente["inscricao_estadual"] = ""),
    (c: ContextoForecast) => (c.bloqueio_faturamento = "Separação não conferida"),
    (c: ContextoForecast) => (c.itens = []),
  ]) {
    const c = fixture();
    alterar(c);
    expect(montarPreviaForecast(c).payload_proposto).toBeNull();
  }
});
test("CFOP interestadual usa a exceção local do produto sem inventar tributos", () => {
  const c = fixture();
  c.cliente["uf"] = "MG";
  c.itens[0]!.produto["cfop_interestadual"] = "6404";
  const r = montarPreviaForecast(c);
  expect(r.pendencias).toEqual([]);
  expect(r.payload_proposto?.items[0]?.cfop).toBe("6404");
  expect(r.payload_proposto?.items[0]).not.toHaveProperty("icms_situacao_tributaria");
  expect(r.payload_proposto).not.toHaveProperty("formas_pagamento");
});
