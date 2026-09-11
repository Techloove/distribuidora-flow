import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ComissaoRepresentante } from "@/components/comissao-representante";
import { ConsultaCadastral } from "@/components/consulta-cadastral";
import { ConsultaIe } from "@/components/consulta-ie";
import { CrudPage, type CrudField } from "@/components/crud-page";
import { HistoricoCliente } from "@/components/historico-cliente";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

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
  { name: "rota_id", label: "Rota de entrega", type: "ref", ref: { table: "rotas", labelField: "nome" } },
  { name: "limite_credito", label: "Limite de crédito (cliente)", type: "number", step: "0.01" },
  { name: "regiao", label: "Região de atuação (vendedor)" },
  {
    name: "comissao_percentual",
    label: "Comissão (%) do vendedor",
    type: "number",
    step: "0.01",
  },
  {
    name: "tipo_representante",
    label: "Tipo de vendedor",
    type: "select",
    options: [
      { value: "interno", label: "Interno" },
      { value: "externo", label: "Externo / representante" },
    ],
  },
  { name: "meta_mensal", label: "Meta mensal (R$)", type: "number", step: "0.01" },
  { name: "condicao_pagamento", label: "Condição de pagamento" },
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
  const { client } = useSupabase();

  const formas = useQuery({
    queryKey: ["formas_pagamento", "pessoas"],
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

  const camposComFormas: CrudField[] = fields.map((f) =>
    f.name === "condicao_pagamento"
      ? {
          ...f,
          label: "Condição de pagamento (formas cadastradas)",
          type: "select",
          options: (formas.data ?? []).map((forma) => ({
            value: String(forma["nome"]),
            label: String(forma["nome"]),
          })),
        }
      : f,
  );

  return (
    <ErpLayout
      title="Cadastro unificado"
      description="Um único cadastro por pessoa ou empresa. Marque as funções (cliente, fornecedor, representante, usuário) e o sistema replica automaticamente nos módulos correspondentes."
    >
      <CrudPage
        table="pessoas"
        fields={camposComFormas}
        orderBy="razao_social"
        emptyLabel="Nenhuma pessoa cadastrada ainda."
        searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade", "email"]}
        extraFormTop
        extraForm={({ form, editing, patch, openRow }) => (
          <div className="space-y-4">
            <ConsultaCadastral
              form={form}
              editing={editing}
              patch={patch}
              openRow={openRow}
              escopo="pessoas"
            />
            <ConsultaIe form={form} editing={editing} patch={patch} escopo="pessoas" />
            {form["is_cliente"] ? (
              <HistoricoCliente pessoaId={editing ? String(editing["id"]) : null} />
            ) : null}
            {form["is_representante"] ? (
              <ComissaoRepresentante
                representanteId={
                  editing && editing["representante_id"]
                    ? String(editing["representante_id"])
                    : null
                }
              />
            ) : null}
          </div>
        )}
      />
    </ErpLayout>
  );
}
