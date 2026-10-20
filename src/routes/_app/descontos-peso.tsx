import { createFileRoute } from "@tanstack/react-router";

import { useCentroValido } from "@/lib/centros-acesso";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/descontos-peso")({
  head: () => ({
    meta: [
      { title: "Descontos por peso (kg) — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro das faixas escalonadas de desconto por peso total do pedido, aplicadas automaticamente na emissão.",
      },
      { property: "og:title", content: "Descontos por peso (kg) — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Faixas de desconto por quilo para vendas de ferragem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DescontosPesoPage,
});

const fields: CrudField[] = [
  {
    name: "centro_id",
    label: "Loja",
    type: "ref",
    ref: { table: "centros", labelField: "nome" },
    required: true,
    inTable: true,
  },
  { name: "nome", label: "Nome da faixa", span: 2, inTable: true, required: true },
  {
    name: "categoria",
    label: "Categoria do produto (vazio = todas)",
    span: 2,
    inTable: true,
  },
  { name: "peso_min", label: "De (kg)", type: "number", step: "0.001", inTable: true },
  {
    name: "peso_max",
    label: "Até (kg) — vazio = sem limite",
    type: "number",
    step: "0.001",
    inTable: true,
  },
  { name: "percentual", label: "Desconto (%)", type: "number", step: "0.01", inTable: true },
  { name: "ordem", label: "Ordem", type: "number", inTable: true },
  { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
];

function DescontosPesoPage() {
  const cv = useCentroValido();
  const permissoes = usePermissoesRotinas();
  return (
    <ErpLayout
      title="Descontos por peso (kg)"
      description="Cadastre as faixas escalonadas: ex. 0 a 3.000 kg = 2%, 3.001 a 5.000 kg = 3%. No pedido, o sistema soma o peso dos itens e sugere o desconto da faixa correspondente."
    >
      <CrudPage
        table="desconto_faixas_peso"
        readOnly={cv.isLoading || !!cv.error || !permissoes.pode("lojas_ofertas_configurar")}
        defaultValues={{ centro_id: cv.centro }}
        fields={fields}
        orderBy="ordem"
        emptyLabel="Nenhuma faixa cadastrada ainda."
        searchColumns={["nome", "categoria"]}
      />
    </ErpLayout>
  );
}
