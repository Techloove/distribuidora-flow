import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de clientes da distribuidora com limite de crédito, condição de pagamento e representante responsável.",
      },
      { property: "og:title", content: "Clientes — ERP Distribuidora" },
      { property: "og:description", content: "Gestão da carteira de clientes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientesPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "razao_social", label: "Razão social", span: 2, inTable: true, required: true },
  { name: "nome_fantasia", label: "Nome fantasia" },
  {
    name: "tipo_pessoa",
    label: "Tipo de pessoa",
    type: "select",
    options: [
      { value: "PJ", label: "Pessoa jurídica" },
      { value: "PF", label: "Pessoa física" },
    ],
  },
  { name: "cnpj_cpf", label: "CNPJ / CPF", inTable: true },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "situacao_cadastral", label: "Situação cadastral" },
  { name: "data_abertura", label: "Data de abertura", type: "date" },
  { name: "data_nascimento", label: "Data de nascimento", type: "date" },
  { name: "natureza_juridica", label: "Natureza jurídica" },
  { name: "porte", label: "Porte" },
  { name: "cnae_principal", label: "CNAE principal", span: 2 },
  { name: "cnae_secundarios", label: "CNAEs secundários", span: 2 },
  { name: "email", label: "E-mail", type: "email" },
  { name: "telefone", label: "Telefone" },
  { name: "logradouro", label: "Logradouro", span: 2 },
  { name: "numero", label: "Número" },
  { name: "complemento", label: "Complemento" },
  { name: "bairro", label: "Bairro" },
  { name: "cidade", label: "Cidade", inTable: true },
  { name: "uf", label: "UF" },
  { name: "cep", label: "CEP" },
  { name: "limite_credito", label: "Limite de crédito", type: "number", step: "0.01" },
  { name: "condicao_pagamento", label: "Condição de pagamento" },
  { name: "tabela_preco", label: "Tabela de preço" },
  {
    name: "status",
    label: "Status",
    type: "select",
    inTable: true,
    options: [
      { value: "ativo", label: "Ativo" },
      { value: "inativo", label: "Inativo" },
      { value: "bloqueado", label: "Bloqueado" },
    ],
  },
  { name: "observacoes", label: "Observações", span: 2 },
];

function ClientesPage() {
  return (
    <ErpLayout
      title="Clientes"
      description="Carteira de clientes usada em pedidos, faturamento e contas a receber."
    >
      <CrudPage
        table="clientes"
        fields={fields}
        orderBy="razao_social"
        emptyLabel="Nenhum cliente cadastrado ainda."
        searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade"]}
      />
    </ErpLayout>
  );
}
