import { describe, expect, test } from "bun:test";
import {
  gerarHtmlPedidos,
  pesoPedidoImpressao,
  type PedidoImpressao,
} from "../src/lib/pedido-impressao";

const pedido: PedidoImpressao = {
  pedido: { numero: 423, data_pedido: "2026-09-21", total_liquido: 3716.79 },
  cliente: { razao_social: "CLIENTE <script>alert(1)</script>" },
  empresa: {},
  centro: { nome: "FERRAGENS" },
  representante: {},
  forma: {},
  itens: [160, 40, 80, 41, 20, 20, 40].map((quantidade) => ({
    item: { quantidade, preco_unitario: 8.95 },
    produto: { descricao: "ARAME", unidade: "KG", peso_kg: 1 },
  })),
};
describe("Impressão de pedidos", () => {
  test("soma os pesos da foto: 401 kg", () => expect(pesoPedidoImpressao(pedido)).toBe(401));
  test("converte unidades e não duplica KG", () => {
    expect(
      pesoPedidoImpressao({
        ...pedido,
        itens: [
          { item: { quantidade: 3 }, produto: { unidade: "UN", peso_kg: 25 } },
          { item: { quantidade: 10 }, produto: { unidade: "KG", peso_kg: 0 } },
        ],
      }),
    ).toBe(85);
  });
  test("escapa dados e usa o total gravado", () => {
    const html = gerarHtmlPedidos([pedido], "");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("401 kg");
    expect(html).toContain("3.716,79");
  });
  test("um documento completo para cada pedido", () => {
    expect(gerarHtmlPedidos([pedido, pedido], "").match(/class="order-sheet"/g)?.length).toBe(2);
  });
});
