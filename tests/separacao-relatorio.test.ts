import { expect, test } from "bun:test";
import {
  agruparItensSeparacao,
  gerarRelatorioSeparacao,
  linhasCompletasSelecionadas,
} from "../src/lib/separacao-relatorio";
const a = {
  pedido_id: "p1",
  numero: 1,
  item_id: "i1",
  produto_id: "sku1",
  produto_codigo: "001",
  produto: "Prego",
  unidade: "KG",
  quantidade: 10,
  cliente_id: "c1",
  cliente: "Cliente A",
  centro: "Ferragem",
};
const b = {
  ...a,
  pedido_id: "p2",
  numero: 2,
  item_id: "i2",
  quantidade: 5.5,
  cliente_id: "c2",
  cliente: "Cliente B",
};
test("consolida por SKU/unidade sem duplicar itens provenientes de joins", () => {
  const linhas = linhasCompletasSelecionadas([a, a, b], ["p1", "p2"]);
  expect(linhas.length).toBe(2);
  expect(agruparItensSeparacao(linhas)[0]?.quantidade).toBe(15.5);
  expect(agruparItensSeparacao([...linhas, { ...b, item_id: "i3", unidade: "CX" }]).length).toBe(2);
});
test("seleção usa os itens completos de cada pedido e falha se algum não estiver acessível", () => {
  const outro = { ...a, item_id: "i3", produto_id: "sku2", produto: "Outro item" };
  expect(linhasCompletasSelecionadas([a, b, outro], ["p1"]).length).toBe(2);
  expect(() => linhasCompletasSelecionadas([a], ["p1", "p2"])).toThrow("Nem todos");
  expect(() => linhasCompletasSelecionadas([a, { ...a, quantidade: 99 }], ["p1"])).toThrow(
    "divergentes",
  );
});
test("relatório por cliente mantém homônimos separados, códigos e escape de HTML", () => {
  const html = gerarRelatorioSeparacao(
    [
      { ...a, cliente: "<script>alert(1)</script>" },
      { ...b, cliente: "<script>alert(1)</script>" },
    ],
    ["p1", "p2"],
    "cliente",
  );
  expect(html.match(/<section>/g)?.length).toBe(2);
  expect(html).toContain("001");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  const consolidado = gerarRelatorioSeparacao([a, b], ["p1", "p2"], "consolidado");
  expect(consolidado.match(/<section>/g)?.length).toBe(1);
  expect(consolidado).toContain("15,5");
});
