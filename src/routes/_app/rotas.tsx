import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/rotas")({
  head: () => ({
    meta: [
      { title: "Rotas de entrega — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de rotas com região, cidades, bairros, dia da semana, motorista e veículo para a expedição.",
      },
      { property: "og:title", content: "Rotas de entrega — ERP Distribuidora" },
      { property: "og:description", content: "Roteirização da entrega por região e dia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RotasPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "nome", label: "Nome da rota", span: 2, inTable: true, required: true },
  { name: "regiao", label: "Região", inTable: true },
  { name: "cidades", label: "Cidades atendidas", span: 2 },
  { name: "bairros", label: "Bairros atendidos", span: 2 },
  {
    name: "dia_semana",
    label: "Dia da semana",
    type: "select",
    inTable: true,
    options: [
      { value: "segunda", label: "Segunda-feira" },
      { value: "terca", label: "Terça-feira" },
      { value: "quarta", label: "Quarta-feira" },
      { value: "quinta", label: "Quinta-feira" },
      { value: "sexta", label: "Sexta-feira" },
      { value: "sabado", label: "Sábado" },
    ],
  },
  { name: "motorista", label: "Motorista", inTable: true },
  { name: "veiculo", label: "Veículo", inTable: true },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
  { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
];

function RotasPage() {
  return (
    <ErpLayout
      title="Rotas de entrega"
      description="Vincule os clientes às rotas para montar a sequência de entrega por dia da semana."
    >
      <CrudPage
        table="rotas"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhuma rota cadastrada ainda."
        searchColumns={["codigo", "nome", "regiao", "cidades", "motorista"]}
      />
    </ErpLayout>
  );
}
