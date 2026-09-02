import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Package, UserRound, Users } from "lucide-react";

import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ERP Distribuidora" },
      {
        name: "description",
        content: "Visão geral dos cadastros base da distribuidora: clientes, produtos e equipe.",
      },
      { property: "og:title", content: "Dashboard — ERP Distribuidora" },
      { property: "og:description", content: "Indicadores dos cadastros da operação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const cards = [
  { table: "clientes", label: "Clientes", icon: Users },
  { table: "produtos", label: "Produtos", icon: Package },
  { table: "representantes", label: "Representantes", icon: UserRound },
] as const;

function Dashboard() {
  const { client } = useSupabase();

  const counts = useQuery({
    queryKey: ["dashboard-counts"],
    enabled: !!client,
    queryFn: async () => {
      const result: Record<string, number | null> = {};
      for (const card of cards) {
        const { count, error } = await client!
          .from(card.table)
          .select("id", { count: "exact", head: true });
        result[card.table] = error ? null : (count ?? 0);
      }
      return result;
    },
  });

  return (
    <ErpLayout
      title="Dashboard"
      description="Situação atual dos cadastros base. Os módulos de pedidos, estoque e financeiro entram nas próximas fases."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.table} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <card.icon className="size-4 text-primary" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {counts.isLoading ? "—" : (counts.data?.[card.table] ?? "—")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">registros cadastrados</p>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Próximo passo</p>
        <p className="mt-1">
          Se os números aparecem como “—”, rode o script <code>db/fase1_cadastros.sql</code> no SQL
          Editor do seu projeto Supabase para criar as tabelas, políticas e papéis.
        </p>
      </div>
    </ErpLayout>
  );
}
