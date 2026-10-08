import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/regras-comissao")({
  head: () => ({
    meta: [
      { title: "Regras de comissão — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Regras flexíveis de comissão por representante, cliente, UF e vigência, aplicadas automaticamente aos pedidos.",
      },
      { property: "og:title", content: "Regras de comissão — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Configure percentuais de comissão por representante, cliente, estado e período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegrasComissaoPage,
});

function RegrasComissaoPage() {
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

  const clientes = useQuery({
    queryKey: ["clientes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("clientes")
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const fields: CrudField[] = [
    { name: "nome", label: "Nome da regra", span: 2, required: true, inTable: true },
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
      name: "cliente_id",
      label: "Cliente (opcional)",
      type: "select",
      options: (clientes.data ?? []).map((c) => ({
        value: String(c["id"]),
        label: String(c["razao_social"]),
      })),
    },
    { name: "uf", label: "UF (opcional)", inTable: true },
    {
      name: "percentual",
      label: "Percentual (%)",
      type: "number",
      step: "0.01",
      required: true,
      inTable: true,
    },
    { name: "prioridade", label: "Prioridade", type: "number", inTable: true },
    { name: "vigencia_inicio", label: "Vigência início (AAAA-MM-DD)" },
    { name: "vigencia_fim", label: "Vigência fim (AAAA-MM-DD)" },
    { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
  ];

  return (
    <ErpLayout
      title="Regras de comissão"
      description="A regra mais específica e de maior prioridade vence. Sem regra aplicável, vale o percentual do representante."
    >
      <CrudPage
        table="regras_comissao"
        fields={fields}
        orderBy="prioridade"
        emptyLabel="Nenhuma regra cadastrada — os pedidos usam o percentual do representante."
        searchColumns={["nome", "uf"]}
      />
    </ErpLayout>
  );
}
