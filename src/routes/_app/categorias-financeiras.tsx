import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/categorias-financeiras")({
  head: () => ({
    meta: [
      { title: "Categorias financeiras — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro hierárquico de categorias e subcategorias de receitas e despesas usadas no financeiro e na DRE.",
      },
      { property: "og:title", content: "Categorias financeiras — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Categorias e subcategorias de despesas e receitas com grupo de DRE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoriasFinanceirasPage,
});

const grupos = [
  { value: "receita_bruta", label: "Receita bruta" },
  { value: "deducao", label: "Deduções" },
  { value: "cpv", label: "Custo dos produtos vendidos" },
  { value: "despesa_administrativa", label: "Despesas administrativas" },
  { value: "despesa_comercial", label: "Despesas comerciais" },
  { value: "despesa_vendas", label: "Despesas com vendas" },
  { value: "despesa_logistica", label: "Despesas de logística" },
  { value: "despesa_operacional", label: "Outras despesas operacionais" },
  { value: "despesa_financeira", label: "Despesas financeiras" },
  { value: "receita_financeira", label: "Receitas financeiras" },
  { value: "outras", label: "Outras" },
];

function CategoriasFinanceirasPage() {
  const { client } = useSupabase();

  const pais = useQuery({
    queryKey: ["categorias_financeiras", "pais"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("categorias_financeiras")
        .select("id, nome")
        .is("parent_id", null)
        .order("ordem");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const fields: CrudField[] = [
    { name: "codigo", label: "Código", auto: true, inTable: true },
    { name: "nome", label: "Nome", span: 2, required: true, inTable: true },
    {
      name: "parent_id",
      label: "Categoria pai (deixe vazio para categoria principal)",
      type: "select",
      span: 2,
      inTable: true,
      options: (pais.data ?? []).map((p) => ({ value: p.id, label: p.nome })),
    },
    {
      name: "tipo",
      label: "Tipo",
      type: "select",
      inTable: true,
      options: [
        { value: "despesa", label: "Despesa" },
        { value: "receita", label: "Receita" },
      ],
    },
    { name: "grupo_dre", label: "Grupo na DRE", type: "select", options: grupos, inTable: true },
    {
      name: "padrao_para",
      label: "Padrão para (opcional)",
      type: "select",
      options: [
        { value: "venda", label: "Vendas / recebimentos" },
        { value: "compra", label: "Compras" },
        { value: "rota", label: "Despesas de rota" },
        { value: "comissao", label: "Comissões" },
        { value: "tarifa", label: "Tarifas bancárias" },
      ],
    },
    { name: "ordem", label: "Ordem", type: "number", inTable: true },
    { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
  ];

  const nomePai = (id: unknown) =>
    pais.data?.find((p) => p.id === id)?.nome ?? (id ? String(id) : "—");

  return (
    <ErpLayout
      title="Categorias financeiras"
      description="Estrutura CATEGORIA → SUBCATEGORIA usada em contas a pagar, movimentações e DRE. Categorias com movimento devem ser inativadas, não excluídas."
    >
      <CrudPage
        table="categorias_financeiras"
        fields={fields}
        orderBy="ordem"
        emptyLabel="Nenhuma categoria cadastrada."
        searchColumns={["codigo", "nome"]}
        decorate={(row) => ({
          ...row,
          parent_id: nomePai(row["parent_id"]),
          grupo_dre: grupos.find((g) => g.value === row["grupo_dre"])?.label ?? row["grupo_dre"],
        })}
      />
    </ErpLayout>
  );
}
