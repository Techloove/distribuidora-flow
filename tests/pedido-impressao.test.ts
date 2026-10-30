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

test("orçamento usa o mesmo modelo com título, validade e aviso próprios", () => {
  const proposta = {
    ...pedido,
    pedido: {
      ...pedido.pedido,
      tipo_documento: "orcamento",
      status: "rascunho",
      orcamento_situacao: "negociacao",
      orcamento_data: "2026-10-16",
      orcamento_validade: "2099-10-31",
    },
  };
  const html = gerarHtmlPedidos([proposta], "");
  expect(html).toContain("ORÇAMENTO Nº");
  expect(html).toContain("31/10/2099");
  expect(html).toContain("Não confirma venda nem reserva estoque");
  expect(html).toContain("Orçamento em negociação");
  expect(html).not.toContain("<strong>PEDIDO Nº");
  const convertido = gerarHtmlPedidos(
    [
      {
        ...proposta,
        pedido: { ...proposta.pedido, tipo_documento: "pedido", orcamento_situacao: "aceito" },
      },
    ],
    "",
  );
  expect(convertido).toContain("<strong>PEDIDO Nº");
  expect(convertido).not.toContain("Não confirma venda nem reserva estoque");
});

test("pedido e orçamento exibem frete manual, por volume e outras despesas separadamente", () => {
  for (const tipo_documento of ["pedido", "orcamento"]) {
    const html = gerarHtmlPedidos([
      {
        ...pedido,
        pedido: {
          ...pedido.pedido,
          tipo_documento,
          frete_valor: 10,
          frete_volume_valor: 250,
          outras_despesas: 20,
          total_liquido: 1380,
        },
      },
    ]);
    expect(html).toContain("Frete manual");
    expect(html).toContain("Frete por volume");
    expect(html).toContain("Outras despesas");
    expect(html).toContain("250,00");
    expect(html).toContain("1.380,00");
  }
});

test("imprime razão social, nome fantasia e observações ao final com texto seguro", () => {
  const html = gerarHtmlPedidos(
    [
      {
        ...pedido,
        cliente: { razao_social: "Razão Social Ltda", nome_fantasia: "Loja <Centro>" },
        pedido: {
          ...pedido.pedido,
          observacoes: "Entregar na lateral\nProcurar João <script>alert(1)</script>",
        },
      },
    ],
    "",
  );
  expect(html).toContain("Razão Social Ltda");
  expect(html).toContain("<strong>Nome fantasia:</strong> Loja &lt;Centro&gt;");
  expect(html).toContain("Entregar na lateral\nProcurar João &lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html.indexOf('class="order-observations"')).toBeGreaterThan(
    html.indexOf('class="totals"'),
  );
  expect(html.indexOf('class="order-observations"')).toBeLessThan(
    html.indexOf('class="signature"'),
  );
  expect(gerarHtmlPedidos([pedido], "")).not.toContain('class="order-observations"');
});

test("impressão inclui representante e rota do pedido, com texto seguro", () => {
  const html = gerarHtmlPedidos(
    [{ ...pedido, representante: { nome: "João <Silva>" }, rota: { nome: "Rota Centro & Sul" } }],
    "",
  );
  expect(html).toContain("<strong>Representante:</strong> João &lt;Silva&gt;");
  expect(html).toContain("<strong>Rota:</strong> Rota Centro &amp; Sul");
  expect(gerarHtmlPedidos([pedido], "")).toContain("<strong>Rota:</strong> —");
});

test("intermediação é identificada na impressão sem expor custo, frete de compra ou margem", () => {
  const html = gerarHtmlPedidos(
    [
      {
        ...pedido,
        pedido: { ...pedido.pedido, modalidade_venda: "intermediacao" },
        itens: [
          {
            item: {
              quantidade: 100,
              preco_unitario: 34,
              total: 3400,
              custo_fabrica_saca: 28.5,
              frete_saca: 3,
              margem_saca: 2.5,
            },
            produto: { descricao: "CIMENTO", unidade: "SC", peso_kg: 50 },
          },
        ],
      },
    ],
    "",
  );
  expect(html).toContain("PEDIDO • INTERMEDIAÇÃO");
  expect(html).not.toContain("28,50");
  expect(html).not.toContain("Margem");
  expect(html).toContain("5.000 kg");
});
