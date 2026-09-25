import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ConsultaCadastral } from "@/components/consulta-cadastral";
import { ConsultaIe } from "@/components/consulta-ie";
import { CodigoIbge } from "@/components/codigo-ibge";
import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { HistoricoCliente } from "@/components/historico-cliente";

import { useSupabase } from "@/lib/supabase-provider";

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
    hiddenInForm: true,
    options: [
      { value: "PJ", label: "Pessoa jurídica" },
      { value: "PF", label: "Pessoa física" },
    ],
  },
  { name: "cnpj_cpf", label: "CNPJ / CPF", inTable: true, hiddenInForm: true },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "uf_inscricao_estadual", label: "UF da inscrição estadual" },
  { name: "situacao_inscricao_estadual", label: "Situação da inscrição estadual" },
  { name: "indicador_contribuinte_icms", label: "Contribuinte de ICMS" },
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
  { name: "codigo_ibge", label: "Código IBGE", hiddenInForm: true },
  { name: "limite_credito", label: "Limite de crédito", type: "number", step: "0.01" },
  { name: "condicao_pagamento", label: "Condição de pagamento" },
  { name: "representante_id", label: "Representante / vendedor", type: "select", options: [] },
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
  const { client } = useSupabase();

  const formas = useQuery({
    queryKey: ["formas_pagamento", "clientes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("formas_pagamento")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []).filter((f) => f["ativo"] !== false);
    },
  });

  const representantes = useQuery({
    queryKey: ["representantes", "clientes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []).filter((r) => r["ativo"] !== false);
    },
  });

  const camposComFormas: CrudField[] = fields.map((f) => {
    if (f.name === "condicao_pagamento")
      return {
        ...f,
        label: "Condição de pagamento (formas cadastradas)",
        type: "select" as const,
        options: (formas.data ?? []).map((forma) => ({
          value: String(forma["nome"]),
          label: String(forma["nome"]),
        })),
      };
    if (f.name === "representante_id")
      return {
        ...f,
        options: (representantes.data ?? []).map((r) => ({
          value: String(r["id"]),
          label: String(r["nome"]),
        })),
      };
    return f;
  });


  return (
    <ErpLayout
      title="Clientes"
      description="Carteira de clientes usada em pedidos, faturamento e contas a receber."
    >
      <CrudPage
        table="clientes"
        fields={camposComFormas}
        orderBy="razao_social"
        emptyLabel="Nenhum cliente cadastrado ainda."
        searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade"]}
        extraFormTop
        extraForm={(ctx) => (
          <div className="space-y-4">
            <ConsultaCadastral
              form={ctx.form}
              editing={ctx.editing}
              patch={ctx.patch}
              openRow={ctx.openRow}
            />
            <ConsultaIe form={ctx.form} editing={ctx.editing} patch={ctx.patch} />
            <CodigoIbge form={ctx.form} patch={ctx.patch} />
            <HistoricoCliente clienteId={ctx.editing ? String(ctx.editing["id"]) : null} />
          </div>

        )}
      />
    </ErpLayout>
  );
}
