import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/representantes")({
  head: () => ({
    meta: [
      { title: "Representantes — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de representantes comerciais com região de atuação e percentual de comissão.",
      },
      { property: "og:title", content: "Representantes — ERP Distribuidora" },
      { property: "og:description", content: "Equipe comercial e regras de comissão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RepresentantesPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "nome", label: "Nome", span: 2, inTable: true, required: true },
  { name: "email", label: "E-mail", type: "email", inTable: true },
  { name: "telefone", label: "Telefone" },
  { name: "regiao", label: "Região", inTable: true },
  {
    name: "comissao_percentual",
    label: "Comissão (%)",
    type: "number",
    step: "0.01",
    inTable: true,
  },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function RepresentantesPage() {
  return (
    <ErpLayout
      title="Representantes"
      description="Equipe comercial vinculada aos clientes e base para o cálculo de comissões."
    >
      <CrudPage
        table="representantes"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhum representante cadastrado ainda."
        searchColumns={["codigo", "nome", "email", "regiao"]}
      />
    </ErpLayout>
  );
}
