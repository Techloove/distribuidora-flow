import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores — ERP Distribuidora" },
      {
        name: "description",
        content: "Cadastro de fornecedores com dados fiscais, contato e condição de pagamento.",
      },
      { property: "og:title", content: "Fornecedores — ERP Distribuidora" },
      { property: "og:description", content: "Base de fornecedores para compras e contas a pagar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FornecedoresPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "razao_social", label: "Razão social", span: 2, inTable: true, required: true },
  { name: "nome_fantasia", label: "Nome fantasia", inTable: true },
  { name: "cnpj_cpf", label: "CNPJ/CPF", inTable: true },
  { name: "email", label: "E-mail", type: "email" },
  { name: "telefone", label: "Telefone" },
  { name: "cidade", label: "Cidade", inTable: true },
  { name: "uf", label: "UF" },
  { name: "condicao_pagamento", label: "Condição de pagamento" },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function FornecedoresPage() {
  return (
    <ErpLayout title="Fornecedores" description="Parceiros de compra usados nas NFs de entrada.">
      <CrudPage
        table="fornecedores"
        fields={fields}
        orderBy="razao_social"
        emptyLabel="Nenhum fornecedor cadastrado ainda."
        searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade"]}
      />
    </ErpLayout>
  );
}
