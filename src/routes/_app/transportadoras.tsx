import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/transportadoras")({
  head: () => ({
    meta: [
      { title: "Transportadoras — ERP Distribuidora" },
      {
        name: "description",
        content: "Cadastro de transportadoras usadas nas expedições e entregas da distribuidora.",
      },
      { property: "og:title", content: "Transportadoras — ERP Distribuidora" },
      { property: "og:description", content: "Parceiros logísticos das entregas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TransportadorasPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "razao_social", label: "Razão social", span: 2, inTable: true, required: true },
  { name: "cnpj", label: "CNPJ", inTable: true },
  { name: "email", label: "E-mail", type: "email" },
  { name: "telefone", label: "Telefone", inTable: true },
  { name: "cidade", label: "Cidade", inTable: true, lookup: "cad_cidades" },
  { name: "uf", label: "UF" },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function TransportadorasPage() {
  return (
    <ErpLayout
      title="Transportadoras"
      description="Parceiros logísticos vinculados aos romaneios de expedição."
    >
      <CrudPage
        table="transportadoras"
        fields={fields}
        orderBy="razao_social"
        emptyLabel="Nenhuma transportadora cadastrada ainda."
        searchColumns={["codigo", "razao_social", "cnpj", "cidade"]}
      />
    </ErpLayout>
  );
}
