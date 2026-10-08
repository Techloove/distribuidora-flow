import { describe, expect, test } from "bun:test";
import { conferirPedido, hojeSaoPaulo, perfilPainel } from "../src/lib/painel-trabalho";
describe("Painel e conferência de pedido", () => {
  test("perfil combinado mantém representante restrito, com exceção do administrador", () => {
    expect(perfilPainel(["gestor", "representante"])).toBe("representante");
    expect(perfilPainel(["admin", "representante"])).toBe("gestao");
    expect(perfilPainel(["financeiro"])).toBe("financeiro");
    expect(perfilPainel(["estoque"])).toBe("operacao");
  });
  test("vencimentos e metas usam o dia de São Paulo na virada UTC", () => {
    expect(hojeSaoPaulo(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10-31");
  });
  test("pedido completo é liberado, dados ausentes e item inválido são sinalizados", () => {
    const doc = {
      cliente_id: "cliente",
      centro_id: "centro",
      rota_id: "rota",
      forma_pagamento_id: "forma",
      total_liquido: 120,
    };
    expect(conferirPedido(doc, [{ quantidade: 2, preco_unitario: 60 }])).toEqual([]);
    expect(
      conferirPedido({ ...doc, rota_id: null }, [{ quantidade: 2, preco_unitario: 60 }]),
    ).toContain("Rota de entrega: preenchimento obrigatório.");
    expect(conferirPedido(doc, [])).toContain("Adicione ao menos um item ao pedido.");
    expect(conferirPedido(doc, [{ quantidade: 0, preco_unitario: 60 }])).toContain(
      "Confira a quantidade e o preço dos itens.",
    );
    expect(
      conferirPedido({ ...doc, total_liquido: NaN }, [{ quantidade: 2, preco_unitario: 60 }]),
    ).toContain("O total do pedido deve ser maior que zero.");
  });
});
