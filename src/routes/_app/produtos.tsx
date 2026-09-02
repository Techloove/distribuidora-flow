import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { CrudPage, type CrudField, type Row } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";


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
  { name: "preco_custo", label: "Preço de custo", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "custo_medio", label: "Custo médio", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "markup_percentual", label: "% Markup", type: "number", step: "0.01", inTable: true, span: 1, virtual: true },
  { name: "preco_venda", label: "Preço de venda", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "ultimo_custo", label: "Último custo", type: "number", step: "0.01" },
  { name: "preco_promocional", label: "Preço promocional", type: "number", step: "0.01", inTable: true },
  { name: "comissao_percentual", label: "Comissão do produto (%)", type: "number", step: "0.01" },
  { name: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "0.001" },
  { name: "estoque_atual", label: "Estoque atual", type: "number", step: "0.001", inTable: true },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];


/**
 * Markup e preço de venda andam juntos, sempre sobre o custo médio:
 * alterando o markup recalcula o preço de venda; alterando custo médio ou
 * preço de venda recalcula o markup.
 */
function recalcularPreco(
  name: string,
  value: string,
  form: Record<string, string | boolean>,
): Record<string, string | boolean> | void {
  const num = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;
  const custo = num(form["custo_medio"]);
  if (name === "markup_percentual") {
    if (custo <= 0) return;
    return { preco_venda: (custo * (1 + num(value) / 100)).toFixed(2) };
  }
  if (name === "custo_medio") {
    const markup = num(form["markup_percentual"]);
    if (num(value) > 0 && markup > 0) {
      return { preco_venda: (num(value) * (1 + markup / 100)).toFixed(2) };
    }
    return;
  }
  if (name === "preco_venda") {
    if (custo <= 0) return;
    return { markup_percentual: (((num(value) - custo) / custo) * 100).toFixed(2) };
  }
}

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
        searchColumns={["codigo", "descricao", "categoria", "marca"]}
        onFieldChange={recalcularPreco}
      />
    </ErpLayout>
  );
}
