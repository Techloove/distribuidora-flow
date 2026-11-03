import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { mesDashboardAtual, moverMesDashboard, rotuloMesDashboard } from "@/lib/periodo-dashboard";
import { Button } from "@/components/ui/button";
import { getModalidade } from "@/lib/modalidade-store";
import { CentralPendencias } from "@/components/central-pendencias";
import { PainelRepresentante } from "@/components/painel-representante";
import { perfilPainel } from "@/lib/painel-trabalho";
import { useAcesso } from "@/lib/permissoes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, Coins, Package, Users, Wallet } from "lucide-react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { useCentroValido } from "@/lib/centros-acesso";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";

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
  const qc = useQueryClient();
  const [mesAtual, setMesAtual] = useState(mesDashboardAtual);
  const [mes, setMes] = useState(mesDashboardAtual);
  useEffect(() => {
    const atualizar = () => {
      const atual = mesDashboardAtual();
      if (atual !== mesAtual) {
        setMes((selecionado) => (selecionado === mesAtual ? atual : selecionado));
        setMesAtual(atual);
      }
    };
    const timer = window.setInterval(atualizar, 60_000);
    window.addEventListener("focus", atualizar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", atualizar);
    };
  }, [mesAtual]);
  const { client, user, roles } = useSupabase();
  const acesso = useAcesso();
  const perfil = perfilPainel(roles);
  const rotulo = {
    representante: "Meu painel comercial",
    financeiro: "Painel financeiro",
    gestao: "Visão da gestão",
    operacao: "Painel da operação",
  }[perfil];
  const { centro, isLoading: centrosLoading, error: centroError } = useCentroValido();

  const data = useQuery({
    queryKey: [...["dashboard", user?.id, centro, mes], getModalidade()],
    enabled: !!client && !centrosLoading && !centroError,
    queryFn: async () => {
      const result = await client!.rpc("dashboard_resumo_mes_307", {
        _centro_id: centro || null,
        _mes: `${mes}-01`,
      });
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
      title={rotulo}
      description="Acompanhe os indicadores e as próximas etapas da operação."
    >
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest opacity-75">{rotulo}</p>
          <h2 className="mt-2 text-xl font-semibold">
            {perfil === "representante"
              ? "Sua carteira, suas metas e seus próximos pedidos."
              : perfil === "financeiro"
                ? "Vencimentos e cobranças que precisam de atenção."
                : "Resultados e prioridades da operação."}
          </h2>
          <p className="mt-2 text-sm opacity-80">
            {perfil === "representante"
              ? "Os dados respeitam a sua carteira de clientes."
              : "Indicadores dos centros permitidos. Use o filtro para acompanhar cada operação."}
          </p>
        </div>
        <button
          onClick={() => {
            void data.refetch();
            void qc.invalidateQueries({ queryKey: ["painel-representante"] });
            void qc.invalidateQueries({ queryKey: ["dashboard_rankings_mes_307"] });
            void qc.invalidateQueries({ queryKey: ["vw_fluxo_operacional"] });
          }}
          disabled={data.isFetching}
          className="rounded-xl border border-white/30 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {data.isFetching ? "Atualizando…" : "Atualizar painel"}
        </button>
      </section>
      <section aria-label="Período do dashboard" className="mb-6 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold capitalize">{rotuloMesDashboard(mes)}</h2>
            <p className="text-xs text-muted-foreground">
              {mes === mesAtual ? "Mês atual" : "Consulta de mês anterior"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Mês anterior"
              disabled={mes <= "2000-01"}
              onClick={() => setMes(moverMesDashboard(mes, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <label className="sr-only" htmlFor="mes-dashboard">
              Mês do dashboard
            </label>
            <input
              id="mes-dashboard"
              type="month"
              min="2000-01"
              max={mesAtual}
              value={mes}
              className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm"
              onChange={(e) => {
                const valor = e.target.value;
                if (
                  /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) &&
                  valor >= "2000-01" &&
                  valor <= mesAtual
                )
                  setMes(valor);
              }}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Mês seguinte"
              disabled={mes >= mesAtual}
              onClick={() => setMes(moverMesDashboard(mes, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" disabled={mes === mesAtual} onClick={() => setMes(mesAtual)}>
              Mês atual
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Vendas pela data comercial do pedido; financeiro pelos vencimentos do mês, com saldo
          pendente atual; comissões pela data de aprovação. Cadastros, estoque e pendências mostram
          a situação atual.
        </p>
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
      {perfil === "representante" && <PainelRepresentante mesSelecionado={mes} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {acesso.pode("/pedidos") && perfil !== "representante" && (
          <Kpi
            label="Vendas aprovadas no mês"
            value={d ? brl(d.vendasConfirmadas) : "—"}
            icon={ClipboardList}
            to="/pedidos"
            hint={d ? `${d.pedidosAbertos} pedidos em digitação/análise no mês` : undefined}
          />
        )}
        {acesso.pode("/receber") && perfil !== "representante" && (
          <Kpi
            label="A receber · vencimentos do mês"
            value={d ? brl(d.receber) : "—"}
            icon={Wallet}
            to="/receber"
            hint={d ? `${brl(d.receberVencido)} vencido` : undefined}
          />
        )}
        {acesso.pode("/pagar") && perfil !== "representante" && (
          <Kpi
            label="A pagar · vencimentos do mês"
            value={d ? brl(d.pagar) : "—"}
            icon={Coins}
            to="/pagar"
            hint={d ? `${brl(d.pagarVencido)} vencido` : undefined}
          />
        )}
        {acesso.pode("/comissoes") && (
          <Kpi
            label="Comissões pendentes do mês"
            value={d ? brl(d.comissoes) : "—"}
            icon={Users}
            to="/comissoes"
            hint="Previstas e liberadas · aprovação no mês"
          />
        )}
      </div>
      {perfil !== "representante" && (acesso.pode("/pessoas") || acesso.pode("/produtos")) && (
        <section className="mt-6 space-y-3" aria-label="Cadastros atuais">
          <h2 className="font-semibold">Cadastros atuais</h2>
          <p className="text-xs text-muted-foreground">
            Totais atuais, sem recorte pelo mês selecionado.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {acesso.pode("/pessoas") && (
              <Kpi
                label="Clientes"
                value={d ? String(d.clientes) : "—"}
                icon={Users}
                to="/pessoas"
              />
            )}
            {acesso.pode("/produtos") && (
              <Kpi
                label="Produtos"
                value={d ? String(d.produtos) : "—"}
                icon={Package}
                to="/produtos"
              />
            )}
          </div>
        </section>
      )}

      <div className="mt-6">
        <CentralPendencias compact />
      </div>
      {(perfil === "gestao" || perfil === "operacao") && <FluxoOperacional />}
      {perfil === "gestao" && <RankingRotas mes={mes} />}

      {acesso.pode("/estoque") && (
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
      )}
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

/** Ranking do mês calculado no PostgreSQL para evitar limite REST e somas no cliente. */
function RankingRotas({ mes }: { mes: string }) {
  const { client } = useSupabase();
  const { centro } = useCentroValido();

  const ranking = useQuery({
    queryKey: [...["dashboard_rankings_mes_307", centro, mes], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("dashboard_rankings_mes_307", {
        _centro_id: centro || null,
        _mes: `${mes}-01`,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as {
        rotas?: Array<{ nome: string; valor: number }>;
        representantes?: Array<{ nome: string; valor: number }>;
        produtos?: Array<{ nome: string; valor: number }>;
      };
    },
  });

  if (ranking.isError) return null;

  const lista = (
    titulo: string,
    dados: Array<{ nome: string; valor: number }> | undefined,
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
          {dados.map(({ nome, valor }) => (
            <li key={nome} className="flex justify-between gap-3">
              <span className="truncate">{nome}</span>
              <span className="text-muted-foreground">{formato(Number(valor ?? 0))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">
        Desempenho de {rotuloMesDashboard(mes)}
      </h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {lista("Vendas por rota", ranking.data?.rotas, brl, "/relatorios")}
        {lista("Vendas por representante", ranking.data?.representantes, brl, "/relatorios")}
        {lista("Produtos mais vendidos", ranking.data?.produtos, (n) => `${n} un.`, "/relatorios")}
      </div>
    </section>
  );
}

/** Painel do fluxo operacional: pedido → separação → faturamento → carga → entrega. */
function FluxoOperacional() {
  const acesso = useAcesso();
  const { client } = useSupabase();
  const fluxo = useQuery({
    queryKey: [...["vw_fluxo_operacional"], getModalidade()],
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
      <h2 className="text-sm font-semibold text-foreground">Fluxo operacional</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Situação atual, sem recorte mensal: pedido → aprovação → separação → conferência →
        faturamento → nota fiscal → carga → entrega.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {ETAPAS.filter((e) => acesso.pode(e.to)).map((e) => (
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
