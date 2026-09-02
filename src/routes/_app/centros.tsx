import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/centros")({
  head: () => ({
    meta: [
      { title: "Centros de distribuição — ERP Distribuidora" },
      {
        name: "description",
        content: "Cadastro dos centros de distribuição usados nas movimentações multi-centro.",
      },
      { property: "og:title", content: "Centros de distribuição — ERP Distribuidora" },
      { property: "og:description", content: "Operação multi-centro da distribuidora." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CentrosPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "nome", label: "Nome", span: 2, inTable: true, required: true },
  { name: "cidade", label: "Cidade", inTable: true },
  { name: "uf", label: "UF", inTable: true },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function CentrosPage() {
  return (
    <ErpLayout
      title="Centros de distribuição"
      description="Locais de armazenagem vinculados aos pedidos, compras e movimentos de estoque."
    >
      <CrudPage
        table="centros"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhum centro cadastrado ainda."
        searchColumns={["codigo", "nome", "cidade", "uf"]}
      />
    </ErpLayout>
  );
}
