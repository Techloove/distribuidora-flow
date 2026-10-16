import { expect, test } from "bun:test";
import {
  ETAPAS_PEDIDO,
  nomeStatusPedido,
  ordemStatusPedido,
  situacaoPedido,
} from "../src/lib/status-pedido";

test("fluxo comercial e logístico segue a ordem sem exibir códigos internos", () => {
  const fluxo = [
    "rascunho",
    "aguardando_aprovacao",
    "aprovado",
    "confirmado",
    "separacao",
    "separado",
    "conferido",
    "faturado",
    "em_carga",
    "em_rota",
    "entregue",
  ];
  let anterior = 0;
  for (const status of fluxo) {
    const etapa = ordemStatusPedido(status);
    expect(etapa).toBeGreaterThanOrEqual(anterior);
    expect(etapa).toBeLessThan(ETAPAS_PEDIDO.length);
    expect(nomeStatusPedido(status)).not.toContain("_");
    anterior = etapa;
  }
  expect(nomeStatusPedido("aprovado")).not.toBe(nomeStatusPedido("confirmado"));
  expect(nomeStatusPedido("separado")).not.toBe(nomeStatusPedido("conferido"));
});
test("parcial e tentativa sem entrega não indicam recebimento integral", () => {
  for (const status of ["parcial", "nao_entregue"]) {
    expect(situacaoPedido(status).atencao).toBe(true);
    expect(ordemStatusPedido(status)).toBeLessThan(ordemStatusPedido("entregue"));
  }
});
test("encerramentos excepcionais e status desconhecido não completam o indicador", () => {
  for (const status of [
    "cancelado",
    "recusado",
    "devolvido",
    "desconhecido",
    "constructor",
    "__proto__",
    null,
  ]) {
    expect(situacaoPedido(status).etapa).toBeNull();
    expect(situacaoPedido(status).atencao).toBe(true);
  }
});
