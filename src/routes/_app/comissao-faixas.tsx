import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/comissao-faixas")({
  head: () => ({
    meta: [
      { title: "Comissão escalonada — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Faixas de comissão por volume de vendas, com período (mensal, semanal, por pedido, faturamento ou recebimento) e base de cálculo.",
      },
      { property: "og:title", content: "Comissão escalonada — ERP Distribuidora" },
      { property: "og:description", content: "Percentual de comissão por faixa de vendas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaixasPage,
});

function FaixasPage() {
  const { client } = useSupabase();

  const representantes = useQuery({
    queryKey: ["pessoas", "representantes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pessoas")
        .select("representante_id, razao_social")
        .eq("is_representante", true)
        .not("representante_id", "is", null)
        .order("razao_social");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const fields: CrudField[] = [
    { name: "nome", label: "Nome da faixa", span: 2, inTable: true, required: true },
    {
      name: "representante_id",
      label: "Representante do cadastro unificado (vazio = todos)",
      type: "select",
      options: (representantes.data ?? []).map((r) => ({
        value: String(r["representante_id"]),
        label: String(r["razao_social"]),
      })),
    },
    {
      name: "periodo",
      label: "Apuração",
      type: "select",
      inTable: true,
      options: [
        { value: "mensal", label: "Mensal" },
        { value: "semanal", label: "Semanal" },
        { value: "pedido", label: "Por pedido" },
        { value: "faturamento", label: "Por faturamento" },
        { value: "recebimento", label: "Por recebimento" },
      ],
    },
    {
      name: "base_calculo",
      label: "Base de cálculo",
      type: "select",
      inTable: true,
      options: [
        { value: "bruto", label: "Valor bruto" },
        { value: "liquido", label: "Valor líquido" },
        { value: "apos_desconto", label: "Após descontos" },
      ],
    },
    { name: "valor_min", label: "De (R$)", type: "number", step: "0.01", inTable: true },
    { name: "valor_max", label: "Até (R$) — vazio = sem limite", type: "number", step: "0.01", inTable: true },
    { name: "percentual", label: "Comissão (%)", type: "number", step: "0.01", inTable: true },
    { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
  ];

  return (
    <ErpLayout
      title="Comissão escalonada"
      description="A comissão do pedido segue a ordem: percentual do produto → regra específica → faixa escalonada. Cada pedido é vinculado ao representante logado e apurado automaticamente."
    >
      <CrudPage
        table="comissao_faixas"
        fields={fields}
        orderBy="valor_min"
        emptyLabel="Nenhuma faixa cadastrada ainda."
        searchColumns={["nome", "periodo", "base_calculo"]}
      />
    </ErpLayout>
  );
}
