import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de produtos com EAN, NCM, unidade, custo médio, preço de venda e níveis de estoque.",
      },
      { property: "og:title", content: "Produtos — ERP Distribuidora" },
      { property: "og:description", content: "Catálogo e parâmetros de estoque dos produtos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProdutosPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "descricao", label: "Descrição", span: 2, inTable: true, required: true },
  { name: "categoria", label: "Categoria", inTable: true },
  { name: "marca", label: "Marca" },
  { name: "unidade", label: "Unidade" },
  { name: "peso_kg", label: "Peso (kg)", type: "number", step: "0.001" },
  { name: "preco_custo", label: "Preço de custo", type: "number", step: "0.0001", inTable: true },
  { name: "ultimo_custo", label: "Último custo", type: "number", step: "0.0001" },
  { name: "custo_reposicao", label: "Custo de reposição", type: "number", step: "0.0001" },
  { name: "custo_medio", label: "Custo médio", type: "number", step: "0.0001", inTable: true },
  { name: "preco_venda", label: "Preço de venda", type: "number", step: "0.0001", inTable: true },
  { name: "preco_promocional", label: "Preço promocional", type: "number", step: "0.0001" },
  { name: "markup_percentual", label: "Markup (%)", auto: true, inTable: true },
  { name: "comissao_percentual", label: "Comissão do produto (%)", type: "number", step: "0.01" },
  { name: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "0.001" },
  { name: "estoque_maximo", label: "Estoque máximo", type: "number", step: "0.001" },
  { name: "estoque_atual", label: "Estoque atual", type: "number", step: "0.001", inTable: true },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];


function ProdutosPage() {
  return (
    <ErpLayout
      title="Produtos"
      description="Catálogo que alimenta pedidos, precificação, estoque e compras."
    >
      <CrudPage
        table="produtos"
        fields={fields}
        orderBy="descricao"
        emptyLabel="Nenhum produto cadastrado ainda."
        searchColumns={["codigo", "descricao", "ean", "categoria", "marca"]}
      />
    </ErpLayout>
  );
}
