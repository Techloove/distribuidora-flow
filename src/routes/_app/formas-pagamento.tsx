import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/formas-pagamento")({
  head: () => ({
    meta: [
      { title: "Formas de pagamento — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro das formas de pagamento com parcelas, prazo da primeira parcela e intervalo, usadas nos pedidos de venda.",
      },
      { property: "og:title", content: "Formas de pagamento — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Condições de pagamento vinculadas aos pedidos e ao financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FormasPagamentoPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "nome", label: "Nome", span: 2, inTable: true, required: true },
  {
    name: "tipo",
    label: "Tipo",
    type: "select",
    inTable: true,
    options: [
      { value: "dinheiro", label: "Dinheiro" },
      { value: "pix", label: "PIX" },
      { value: "boleto", label: "Boleto" },
      { value: "cartao_credito", label: "Cartão de crédito" },
      { value: "cartao_debito", label: "Cartão de débito" },
      { value: "transferencia", label: "Transferência" },
      { value: "cheque", label: "Cheque" },
      { value: "prazo", label: "A prazo" },
    ],
  },
  { name: "parcelas_padrao", label: "Parcelas", type: "number", inTable: true },
  {
    name: "dias_primeira_parcela",
    label: "Dias 1ª parcela",
    type: "number",
    inTable: true,
  },
  { name: "intervalo_dias", label: "Intervalo (dias)", type: "number", inTable: true },
  { name: "taxa_percentual", label: "Taxa (%)", type: "number", step: "0.01" },
  { name: "observacoes", label: "Observações", span: 2 },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function FormasPagamentoPage() {
  return (
    <ErpLayout
      title="Formas de pagamento"
      description="Condições usadas nos pedidos de venda: número de parcelas, prazo da primeira e intervalo entre elas."
    >
      <CrudPage
        table="formas_pagamento"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhuma forma de pagamento cadastrada ainda."
        searchColumns={["codigo", "nome", "tipo"]}
      />
    </ErpLayout>
  );
}
