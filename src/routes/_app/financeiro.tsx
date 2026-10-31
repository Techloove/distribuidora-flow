import { getModalidade } from "@/lib/modalidade-store";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { useCentro } from "@/lib/centro-store";
import { usePermissoesFin } from "@/lib/permissoes-financeiras";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/financeiro")({
  head: () => ({
    meta: [
      { title: "Dashboard financeiro — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Painel financeiro com saldos, contas a receber e a pagar, faturamento, lucro bruto e margem por período.",
      },
      { property: "og:title", content: "Dashboard financeiro — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Indicadores de caixa, títulos, receitas e despesas da distribuidora.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinanceiroPage,
});

type Row = Record<string, unknown>;

function FinanceiroPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const perm = usePermissoesFin();

  const indicadores = useQuery({
    queryKey: [...["dashboard_financeiro", centro], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("dashboard_financeiro", {
        _centro: centro || null,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as Row;
    },
  });

  const realizado = useQuery({
    queryKey: [...["vw_fluxo_realizado", centro], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_fluxo_realizado").select("*");
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const dre = useQuery({
    queryKey: [...["vw_dre_mensal", centro], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_dre_mensal").select("*");
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const despesas = useQuery({
    queryKey: [...["vw_despesas_categoria", centro], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_despesas_categoria").select("*");
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const i = indicadores.data ?? {};
  const faturamento = Number(i["faturamento_mes"] ?? 0);
  const custo = Number(i["custo_mes"] ?? 0);
  const lucro = faturamento - custo;
  const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

  const porMes = (() => {
    const map = new Map<string, { periodo: string; entradas: number; saidas: number }>();
    for (const r of realizado.data ?? []) {
      const p = String(r["data"] ?? "").slice(0, 7);
      if (!p) continue;
      const item = map.get(p) ?? { periodo: p, entradas: 0, saidas: 0 };
      item.entradas += Number(r["entradas"] ?? 0);
      item.saidas += Number(r["saidas"] ?? 0);
      map.set(p, item);
    }
    return [...map.values()]
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .slice(-12)
      .map((m) => ({ ...m, saldo: m.entradas - m.saidas }));
  })();

  const resultadoMes = (() => {
    const map = new Map<string, { periodo: string; receita: number; despesa: number }>();
    for (const r of dre.data ?? []) {
      const p = String(r["periodo"] ?? "");
      if (!p) continue;
      const item = map.get(p) ?? { periodo: p, receita: 0, despesa: 0 };
      item.receita += Number(r["receita_bruta"] ?? 0) + Number(r["receita_financeira"] ?? 0);
      item.despesa +=
        Number(r["cpv"] ?? 0) +
        Number(r["desp_administrativa"] ?? 0) +
        Number(r["desp_comercial"] ?? 0) +
        Number(r["desp_vendas"] ?? 0) +
        Number(r["desp_logistica"] ?? 0) +
        Number(r["desp_operacional"] ?? 0) +
        Number(r["desp_financeira"] ?? 0);
      map.set(p, item);
    }
    return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).slice(-12);
  })();

  const porCategoria = (() => {
    const map = new Map<string, number>();
    for (const r of despesas.data ?? []) {
      const k = String(r["categoria"] ?? "Sem categoria");
      map.set(k, (map.get(k) ?? 0) + Number(r["valor"] ?? 0));
    }
    return [...map.entries()]
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
  })();

  if (!perm.carregando && !perm.pode("financeiro_ver")) {
    return (
      <ErpLayout title="Financeiro" description="Acesso restrito.">
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para visualizar informações financeiras.
        </p>
      </ErpLayout>
    );
  }

  return (
    <ErpLayout
      title="Dashboard financeiro"
      description="Visão consolidada de caixa, títulos, faturamento e resultado, respeitando o centro de custo selecionado."
    >
      <div className="space-y-6">
        {indicadores.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando indicadores...
          </div>
        ) : indicadores.isError ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-destructive">
            {(indicadores.error as Error).message}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi
              label={
                getModalidade() === "todos"
                  ? "Saldo em bancos/caixa"
                  : "Movimentação líquida vinculada"
              }
              value={brl(i["saldo_contas"])}
            />
            <Kpi label="Contas a receber" value={brl(i["a_receber"])} />
            <Kpi label="Contas a pagar" value={brl(i["a_pagar"])} tone />
            <Kpi label="Recebido no mês" value={brl(i["recebido_mes"])} />
            <Kpi label="Pago no mês" value={brl(i["pago_mes"])} tone />
            <Kpi label="Faturamento do mês" value={brl(faturamento)} />
            {perm.pode("custos_ver") ? <Kpi label="Custo das vendas" value={brl(custo)} /> : null}
            {perm.pode("margens_ver") ? (
              <>
                <Kpi label="Lucro bruto" value={brl(lucro)} />
                <Kpi label="Margem média" value={`${margem.toFixed(1)}%`} />
              </>
            ) : null}
            <Kpi label="Vencido a receber" value={brl(i["a_receber_vencido"])} tone />
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <Grafico titulo="Fluxo de caixa realizado (12 meses)">
            <LineChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="periodo" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => brl(v as number)} />
              <Legend />
              <Line type="monotone" dataKey="entradas" name="Entradas" stroke="#16a34a" />
              <Line type="monotone" dataKey="saidas" name="Saídas" stroke="#dc2626" />
              <Line type="monotone" dataKey="saldo" name="Saldo" stroke="#2563eb" />
            </LineChart>
          </Grafico>

          <Grafico titulo="Receitas x despesas por mês">
            <BarChart data={resultadoMes}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="periodo" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => brl(v as number)} />
              <Legend />
              <Bar dataKey="receita" name="Receitas" fill="#16a34a" />
              <Bar dataKey="despesa" name="Despesas" fill="#dc2626" />
            </BarChart>
          </Grafico>

          <Grafico titulo="Despesas por categoria">
            <BarChart data={porCategoria} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="categoria" width={140} fontSize={11} />
              <Tooltip formatter={(v) => brl(v as number)} />
              <Bar dataKey="valor" name="Despesas" fill="#f59e0b" />
            </BarChart>
          </Grafico>

          <Grafico titulo="Entradas e saídas por mês">
            <BarChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="periodo" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => brl(v as number)} />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill="#2563eb" />
              <Bar dataKey="saidas" name="Saídas" fill="#94a3b8" />
            </BarChart>
          </Grafico>
        </section>
      </div>
    </ErpLayout>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-lg font-semibold tracking-tight ${
          tone ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </article>
  );
}

function Grafico({ titulo, children }: { titulo: string; children: React.ReactElement }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{titulo}</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </article>
  );
}
