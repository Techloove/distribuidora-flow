import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, Coins, Package, Users, Wallet } from "lucide-react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Indicadores da distribuidora: vendas confirmadas, contas a receber e pagar, comissões e alertas de estoque.",
      },
      { property: "og:title", content: "Dashboard — ERP Distribuidora" },
      { property: "og:description", content: "Indicadores de vendas, estoque e financeiro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type Row = Record<string, unknown>;

function Dashboard() {
  const { client } = useSupabase();

  const data = useQuery({
    queryKey: ["dashboard"],
    enabled: !!client,
    queryFn: async () => {
      const sb = client!;
      const [clientes, produtos, pedidos, receber, pagar, comissoes] = await Promise.all([
        sb.from("clientes").select("id", { count: "exact", head: true }),
        sb.from("produtos").select("id, descricao, estoque_atual, estoque_minimo"),
        sb.from("pedidos").select("id, status, total_liquido, data_pedido"),
        sb.from("contas_receber").select("valor, valor_pago, status, vencimento"),
        sb.from("contas_pagar").select("valor, valor_pago, status, vencimento"),
        sb.from("comissoes").select("valor, status"),
      ]);

      const hoje = new Date().toISOString().slice(0, 10);
      const saldo = (rows: Row[] | null) =>
        (rows ?? [])
          .filter((r) => r["status"] !== "pago" && r["status"] !== "cancelado")
          .reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0);
      const vencido = (rows: Row[] | null) =>
        (rows ?? [])
          .filter(
            (r) =>
              r["status"] !== "pago" &&
              r["status"] !== "cancelado" &&
              String(r["vencimento"]) < hoje,
          )
          .reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0);

      const peds = (pedidos.data ?? []) as Row[];
      const prods = (produtos.data ?? []) as Row[];

      return {
        clientes: clientes.count ?? 0,
        produtos: prods.length,
        pedidosAbertos: peds.filter((p) => p["status"] === "rascunho").length,
        vendasConfirmadas: peds
          .filter((p) => p["status"] === "confirmado" || p["status"] === "faturado")
          .reduce((s, p) => s + Number(p["total_liquido"] ?? 0), 0),
        receber: saldo(receber.data as Row[] | null),
        receberVencido: vencido(receber.data as Row[] | null),
        pagar: saldo(pagar.data as Row[] | null),
        pagarVencido: vencido(pagar.data as Row[] | null),
        comissoes: ((comissoes.data ?? []) as Row[])
          .filter((c) => c["status"] !== "cancelada" && c["status"] !== "paga")
          .reduce((s, c) => s + Number(c["valor"] ?? 0), 0),
        alertas: prods.filter(
          (p) => Number(p["estoque_atual"] ?? 0) <= Number(p["estoque_minimo"] ?? 0),
        ),
      };
    },
  });

  const d = data.data;

  return (
    <ErpLayout
      title="Dashboard"
      description="Visão consolidada de vendas, estoque e financeiro da distribuidora."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Vendas confirmadas"
          value={d ? brl(d.vendasConfirmadas) : "—"}
          icon={ClipboardList}
          to="/pedidos"
          hint={d ? `${d.pedidosAbertos} pedidos em rascunho` : undefined}
        />
        <Kpi
          label="A receber em aberto"
          value={d ? brl(d.receber) : "—"}
          icon={Wallet}
          to="/receber"
          hint={d ? `${brl(d.receberVencido)} vencido` : undefined}
        />
        <Kpi
          label="A pagar em aberto"
          value={d ? brl(d.pagar) : "—"}
          icon={Coins}
          to="/pagar"
          hint={d ? `${brl(d.pagarVencido)} vencido` : undefined}
        />
        <Kpi
          label="Comissões a liberar"
          value={d ? brl(d.comissoes) : "—"}
          icon={Users}
          to="/comissoes"
        />
        <Kpi label="Clientes" value={d ? String(d.clientes) : "—"} icon={Users} to="/clientes" />
        <Kpi label="Produtos" value={d ? String(d.produtos) : "—"} icon={Package} to="/produtos" />
      </div>

      <FluxoOperacional />

      <section className="mt-6 rounded-lg border border-border bg-card p-5">

        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="size-4 text-destructive" />
          Alertas de estoque mínimo
        </h2>
        {!d ? (
          <p className="mt-2 text-sm text-muted-foreground">Carregando...</p>
        ) : d.alertas.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhum produto abaixo do estoque mínimo.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {d.alertas.slice(0, 8).map((p) => (
              <li key={String(p["id"])} className="flex justify-between gap-4">
                <span className="truncate">{String(p["descricao"])}</span>
                <span className="text-destructive">
                  {String(p["estoque_atual"])} / mín. {String(p["estoque_minimo"])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.isError ? (
        <p className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Alguns dados não carregaram. Rode <code>db/fase1_cadastros.sql</code> e{" "}
          <code>db/fase2_vendas_estoque_financeiro.sql</code> no SQL Editor do Supabase.
        </p>
      ) : null}
    </ErpLayout>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  to,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  to: string;
  hint?: string | undefined;
}) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint ?? "\u00a0"}</p>
    </Link>
  );
}
