import { test, expect } from "bun:test";
import { destinosRegularizacao } from "../src/lib/regularizacao-pedido";
test("regularização permite pular de separação até entregue sem inventar nota fiscal", () => {
  expect(destinosRegularizacao("separacao")).toEqual([
    "separado",
    "conferido",
    "faturado",
    "em_carga",
    "em_rota",
    "entregue",
  ]);
  expect(destinosRegularizacao("nf_emitida")).toEqual(["em_carga", "em_rota", "entregue"]);
  expect(destinosRegularizacao("em_rota")).toEqual(["entregue"]);
});
test("não regulariza início da venda, casos parciais ou finalizados e nunca retrocede", () => {
  for (const s of [
    "rascunho",
    "digitacao",
    "aprovado",
    "confirmado",
    "orcamento",
    "entregue",
    "cancelado",
    "devolvido",
    "parcial",
    "nao_entregue",
    "invalido",
  ])
    expect(destinosRegularizacao(s)).toEqual([]);
  for (const s of ["separado", "conferido", "faturado", "em_carga", "em_rota"]) {
    expect(destinosRegularizacao(s)).not.toContain(s);
    expect(destinosRegularizacao(s)).not.toContain("nf_emitida");
    expect(destinosRegularizacao(s)).not.toContain("separacao");
  }
});
