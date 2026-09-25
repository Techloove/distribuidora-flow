import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, Coins, Package, Users, Wallet } from "lucide-react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { useCentroValido } from "@/lib/centros-acesso";
import { useAcesso } from "@/lib/permissoes";
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
  const { client, user } = useSupabase();
  const { centro, isLoading: centrosLoading, error: centroError } = useCentroValido();

  const data = useQuery({
    queryKey: ["dashboard", user?.id, centro],
    enabled: !!client && !centrosLoading && !centroError,
    queryFn: async () => {
      const result = await client!.rpc("dashboard_resumo", { _centro_id: centro || null });
      if (result.error) throw new Error("Não foi possível atualizar os indicadores.");
      return result.data as {
        clientes: number;
        produtos: number;
        pedidosAbertos: number;
        vendasConfirmadas: number;
        receber: number;
        receberVencido: number;
        pagar: number;
        pagarVencido: number;
        comissoes: number;
        alertas: Row[];
      };
    },
  });

  const d = data.data;

  return (
    <ErpLayout
      title="Visão geral"
      description="Acompanhe os indicadores e as próximas etapas da operação."
    >
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest opacity-75">
            Painel da operação
          </p>
          <h2 className="mt-2 text-xl font-semibold">Uma visão clara para decidir melhor.</h2>
          <p className="mt-2 text-sm opacity-80">
            Vendas e financeiro por centro. Cadastros e estoque consolidado.
          </p>
        </div>
        <button
          onClick={() => {
            void data.refetch();
          }}
          disabled={data.isFetching}
          className="rounded-xl border border-white/30 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {data.isFetching ? "Atualizando…" : "Atualizar painel"}
        </button>
      </section>
      {(data.isError || centroError) && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          Não foi possível carregar os indicadores. Tente atualizar o painel ou contate o
          administrador.
        </div>
      )}
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

      <RankingRotas />

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="size-4 text-destructive" />
          Alertas de estoque mínimo
        </h2>
        {!d ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {data.isError ? "Dados indisponíveis." : "Carregando…"}
          </p>
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
      className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-9 rounded-xl bg-primary/10 p-2 text-primary" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint ?? "\u00a0"}</p>
    </Link>
  );
}

const ETAPAS: { campo: string; label: string; to: string }[] = [
  { campo: "aguardando_aprovacao", label: "Aguardando aprovação", to: "/pedidos" },
  { campo: "aprovados", label: "Aprovados", to: "/separacao" },
  { campo: "em_separacao", label: "Em separação", to: "/separacao" },
  { campo: "com_divergencia", label: "Com divergência", to: "/separacao" },
  { campo: "separados", label: "Separados", to: "/separacao" },
  { campo: "prontos_faturamento", label: "Prontos p/ faturar", to: "/notas" },
  { campo: "faturados", label: "Faturados (NF pendente)", to: "/notas" },
  { campo: "nf_emitidas", label: "NF autorizada", to: "/notas" },
  { campo: "em_carga", label: "Em carga", to: "/cargas" },
  { campo: "em_rota", label: "Em rota", to: "/cargas" },
  { campo: "entregues", label: "Entregues", to: "/cargas" },
];

/** Ranking do mês: vendas por rota, por representante e produtos mais vendidos por rota. */
function RankingRotas() {
  const { client } = useSupabase();
  const { centro } = useCentroValido();
  const de = `${new Date().toISOString().slice(0, 7)}-01`;

  const useSoma = (view: string, chave: string, valor: "total" | "quantidade") =>
    useQuery({
      queryKey: ["ranking", view, de, centro],
      enabled: !!client,
      queryFn: async () => {
        let query = client!.from(view).select("*").gte("data_pedido", de);
        if (centro) query = query.eq("centro_id", centro);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const mapa = new Map<string, number>();
        for (const r of (data ?? []) as Row[]) {
          const k = String(r[chave] ?? "—");
          mapa.set(k, (mapa.get(k) ?? 0) + Number(r[valor] ?? 0));
        }
        return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      },
    });

  const rotas = useSoma("vw_vendas_rota", "rota", "total");
  const reps = useSoma("vw_vendas_representante_rota", "representante", "total");
  const produtos = useSoma("vw_produtos_rota", "produto", "quantidade");

  if (rotas.isError && reps.isError && produtos.isError) return null;

  const lista = (
    titulo: string,
    dados: [string, number][] | undefined,
    formato: (n: number) => string,
    to: string,
  ) => (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
        <Link to={to} className="text-xs text-primary hover:underline">
          ver
        </Link>
      </div>
      {!dados ? (
        <p className="mt-2 text-sm text-muted-foreground">Carregando...</p>
      ) : dados.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Sem dados no mês.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {dados.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="truncate">{k}</span>
              <span className="text-muted-foreground">{formato(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">Desempenho do mês por rota</h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {lista("Vendas por rota", rotas.data, brl, "/relatorios")}
        {lista("Vendas por representante", reps.data, brl, "/relatorios")}
        {lista("Produtos mais vendidos", produtos.data, (n) => `${n} un.`, "/relatorios")}
      </div>
    </section>
  );
}

/** Painel do fluxo operacional: pedido → separação → faturamento → carga → entrega. */
function FluxoOperacional() {
  const { client } = useSupabase();
  const fluxo = useQuery({
    queryKey: ["vw_fluxo_operacional"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_fluxo_operacional").select("*").maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? {}) as Row;
    },
  });

  if (fluxo.isError) return null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">
        Fluxo operacional · centros permitidos
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Pedido → aprovação → separação → conferência → faturamento → nota fiscal → carga → entrega.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {ETAPAS.map((e) => (
          <Link
            key={e.campo}
            to={e.to}
            className="rounded-lg border border-border px-3 py-2 transition-colors hover:border-primary/50"
          >
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{e.label}</p>
            <p className="text-lg font-semibold">
              {fluxo.data ? String(fluxo.data[e.campo] ?? 0) : "—"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
