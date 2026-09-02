import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/pessoas")({
  head: () => ({
    meta: [
      { title: "Cadastro unificado — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro único de pessoas com marcação de papéis: cliente, fornecedor, representante e usuário do ERP.",
      },
      { property: "og:title", content: "Cadastro unificado — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Um registro por pessoa ou empresa, com as funções marcadas em caixas de seleção.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PessoasPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "razao_social", label: "Razão social / Nome", span: 2, inTable: true, required: true },
  {
    name: "papeis",
    label: "Funções deste cadastro",
    type: "multicheck",
    span: 2,
    inTable: true,
    checks: [
      { name: "is_cliente", label: "Cliente" },
      { name: "is_fornecedor", label: "Fornecedor" },
      { name: "is_representante", label: "Representante" },
      { name: "is_transportadora", label: "Transportadora" },
      { name: "is_usuario", label: "Usuário do sistema" },
    ],
  },
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
  { name: "email", label: "E-mail", type: "email", inTable: true },
  { name: "telefone", label: "Telefone" },
  { name: "whatsapp", label: "WhatsApp" },
  { name: "logradouro", label: "Logradouro", span: 2 },
  { name: "numero", label: "Número" },
  { name: "complemento", label: "Complemento" },
  { name: "bairro", label: "Bairro" },
  { name: "cidade", label: "Cidade", inTable: true },
  { name: "uf", label: "UF" },
  { name: "cep", label: "CEP" },
  { name: "cob_logradouro", label: "Cobrança · logradouro", span: 2 },
  { name: "cob_numero", label: "Cobrança · número" },
  { name: "cob_bairro", label: "Cobrança · bairro" },
  { name: "cob_cidade", label: "Cobrança · cidade" },
  { name: "cob_uf", label: "Cobrança · UF" },
  { name: "cob_cep", label: "Cobrança · CEP" },
  { name: "ent_logradouro", label: "Entrega · logradouro", span: 2 },
  { name: "ent_numero", label: "Entrega · número" },
  { name: "ent_bairro", label: "Entrega · bairro" },
  { name: "ent_cidade", label: "Entrega · cidade" },
  { name: "ent_uf", label: "Entrega · UF" },
  { name: "ent_cep", label: "Entrega · CEP" },
  { name: "rota_id", label: "Rota de entrega", type: "ref", ref: { table: "rotas", labelField: "nome" } },
  { name: "sequencia_entrega", label: "Sequência na rota", type: "number" },
  { name: "limite_credito", label: "Limite de crédito (cliente)", type: "number", step: "0.01" },
  { name: "condicao_pagamento", label: "Condição de pagamento" },
  { name: "tabela_preco", label: "Tabela de preço (cliente)" },
  { name: "regiao", label: "Região (representante)" },
  {
    name: "tipo_representante",
    label: "Tipo de representante",
    type: "select",
    options: [
      { value: "interno", label: "Interno" },
      { value: "externo", label: "Externo" },
      { value: "autonomo", label: "Autônomo" },
    ],
  },
  {
    name: "comissao_percentual",
    label: "Comissão % (representante)",
    type: "number",
    step: "0.01",
  },
  { name: "meta_mensal", label: "Meta mensal (R$)", type: "number", step: "0.01" },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
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
  { name: "ativo", label: "Ativo", type: "checkbox" },
  { name: "observacoes", label: "Observações", span: 2 },
];

function PessoasPage() {
  return (
    <ErpLayout
      title="Cadastro unificado"
      description="Um único cadastro por pessoa ou empresa. Marque as funções (cliente, fornecedor, representante, usuário) e o sistema replica automaticamente nos módulos correspondentes."
    >
      <CrudPage
        table="pessoas"
        fields={fields}
        orderBy="razao_social"
        emptyLabel="Nenhuma pessoa cadastrada ainda."
        searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade", "email"]}
      />
    </ErpLayout>
  );
}
