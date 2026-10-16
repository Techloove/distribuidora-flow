import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { CobrancaCentros } from "@/components/cobranca-centros";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/centros")({
  head: () => ({
    meta: [
      { title: "Centros de custo — ERP Distribuidora" },
      {
        name: "description",
        content: "Cadastro dos centros de distribuição usados nas movimentações multi-centro.",
      },
      { property: "og:title", content: "Centros de custo — ERP Distribuidora" },
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
  { name: "cidade", label: "Cidade", inTable: true, lookup: "cad_cidades" },
  { name: "uf", label: "UF", inTable: true },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function CentrosPage() {
  return (
    <ErpLayout
      title="Centros de custo"
      description="Centros para vendas, relatórios e cobrança bancária. O estoque físico permanece compartilhado."
    >
      <CrudPage
        table="centros"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhum centro cadastrado ainda."
        searchColumns={["codigo", "nome", "cidade", "uf"]}
      />
      <CobrancaCentros />
    </ErpLayout>
  );
}
