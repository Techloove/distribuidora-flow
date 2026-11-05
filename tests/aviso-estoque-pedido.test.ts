import { test, expect } from "bun:test";
import { avisoEstoquePedido } from "../src/lib/aviso-estoque-pedido";
test("item salvo informa falta de estoque sem inventar aprovação", () => {
  const a = {
    item_id: "item-94",
    estoque_disponivel: 0,
    quantidade_pedido: 20,
    insuficiente: true,
  };
  expect(avisoEstoquePedido(a, "rascunho")).toContain(
    "item mantido no pedido para análise comercial",
  );
  expect(avisoEstoquePedido(a, "aguardando_aprovacao")).toContain("Aguardando aprovação comercial");
  expect(avisoEstoquePedido(a, "aprovado")).toContain("aprovação comercial registrada");
  expect(avisoEstoquePedido({ ...a, insuficiente: false }, "rascunho")).toBeNull();
  expect(avisoEstoquePedido(undefined, "rascunho")).toBeNull();
});
