import { test, expect } from "bun:test";
import {
  descricaoFaixaPreco,
  htmlTabelaPrecos,
  precoPorFaixa,
  type TabelaPrecos,
} from "../src/lib/tabela-precos";
const tabela: TabelaPrecos = {
  loja: { id: "loja", nome: "Ferragem <teste>" },
  consultado_em: "2026-11-18T13:00:00Z",
  itens: [
    {
      id: "produto",
      codigo: "A1",
      descricao: "Produto <script>alert(1)</script>",
      unidade: "UN",
      categoria: "Ferro",
      peso_kg: 10,
      preco_normal: 100,
    },
  ],
  faixas: Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    nome: `Condição ${i + 1}`,
    categoria: i === 1 ? "Ferro" : null,
    peso_min: i * 1000,
    peso_max: i === 6 ? null : (i + 1) * 1000 - 0.001,
    percentual: i + 1,
    ordem: i,
    ativo: true,
  })),
};
test("preços por peso são projeções independentes sobre preço normal", () => {
  expect(precoPorFaixa(100, 5)).toBe(95);
  expect(precoPorFaixa(100, 10)).toBe(90);
  expect(precoPorFaixa(19.99, 3)).toBe(19.3903);
  expect(precoPorFaixa(100, 100)).toBe(0);
  expect(precoPorFaixa(0, 5)).toBe(0);
  for (const p of [null, -1, NaN, Infinity]) expect(precoPorFaixa(p, 5)).toBeNull();
  for (const d of [-1, 101, Infinity, NaN]) expect(precoPorFaixa(10, d)).toBeNull();
});
test("faixas novas não truncam impressão e identificam condição por categoria", () => {
  expect(descricaoFaixaPreco(tabela.faixas[1]!)).toContain("peso da categoria Ferro");
  expect(descricaoFaixaPreco(tabela.faixas[6]!)).toContain("ou mais");
  const html = htmlTabelaPrecos(tabela, tabela.itens, tabela.faixas);
  expect(html.match(/<section/g)?.length).toBe(1);
  expect(html.match(/Preço normal/g)?.length).toBe(1);
  for (const f of tabela.faixas) expect(html).toContain(f.nome);
  expect(html.match(/<td class="valor">/g)?.length).toBe(8);
  expect(html).toContain("99,00");
  expect(html).toContain("93,00");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Ferragem &lt;teste&gt;");
});
test("formato normal não imprime condições, busca vazia não inventa produtos", () => {
  const normal = htmlTabelaPrecos(tabela, tabela.itens, []);
  expect(normal).not.toContain("Condição 1");
  expect(normal).toContain("100,00");
  expect(normal.match(/<section/g)?.length).toBe(1);
  const vazio = htmlTabelaPrecos(tabela, [], []);
  expect(vazio).toContain("0 produto(s)");
  expect(vazio).not.toContain("A1");
});

test("paisagem e retrato preservam todas as colunas e preços", () => {
  const paisagem = htmlTabelaPrecos(tabela, tabela.itens, tabela.faixas, "landscape");
  const retrato = htmlTabelaPrecos(tabela, tabela.itens, tabela.faixas, "portrait");
  expect(paisagem).toContain("size:A4 landscape");
  expect(retrato).toContain("size:A4 portrait");
  for (const html of [paisagem, retrato]) {
    expect(html.match(/<td class="valor">/g)?.length).toBe(8);
    expect(html).toContain("100,00");
    expect(html).toContain("99,00");
    expect(html).toContain("93,00");
  }
});
