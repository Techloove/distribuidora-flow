import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSupabase } from "@/lib/supabase-provider";
import { useAcesso } from "@/lib/permissoes";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl } from "@/lib/formatacao";
import { useState } from "react";
import { useCentroValido } from "@/lib/centros-acesso";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { FILTROS_AGENDA } from "@/lib/agenda-comercial";
import { Label } from "@/components/ui/label";

type Vendas = {
  ano: number;
  total: number;
  carteira: number;
  credito_pendente: number;
  meses: { mes: number; valor: number; pedidos: number }[];
};
export function PainelRepresentante() {
  const { client, user } = useSupabase();
  const acesso = useAcesso();
  const perm = usePermissoesRotinas();
  const cv = useCentroValido();
  const hoje = hojeSaoPaulo();
  const anoAtual = Number(hoje.slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const q = useQuery({
    queryKey: ["painel-representante", "vendas", user?.id, ano, cv.centro],
    enabled: !!client && !cv.isLoading && !cv.error,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await client!.rpc("painel_vendas_representante_284", {
        _ano: ano,
        _centro: cv.centro || null,
      });
      if (r.error) throw new Error("Não foi possível carregar as vendas da sua carteira.");
      return r.data as Vendas;
    },
  });
  const reativacao = perm.pode("clientes_reativar");
  const cobranca = perm.pode("cobranca_acompanhar");
  const agenda = useQuery({
    queryKey: ["painel-representante", "agenda", user?.id, cv.centro, reativacao, cobranca],
    enabled: !!client && !cv.isLoading && !cv.error && (reativacao || cobranca),
    refetchInterval: 60_000,
    queryFn: async () => {
      const consultar = async (aba: string) => {
        const r = await client!.rpc("agenda_clientes_228", {
          _aba: aba,
          _centro: cv.centro || null,
          _dias: FILTROS_AGENDA.dias,
        });
        if (r.error) throw new Error("Não foi possível carregar o resumo da Agenda Comercial.");
        return r.data as { count: number; resumo: { vencido: number } };
      };
      const [semCompras, atrasos] = await Promise.all([
        reativacao ? consultar("reativacao") : null,
        cobranca ? consultar("cobranca") : null,
      ]);
      return { semCompras, atrasos };
    },
  });
  const mes = Number(hoje.slice(5, 7));
  return (
    <div className="mb-6 space-y-5">
      <section
        className="space-y-4 rounded-2xl border bg-card p-5"
        aria-label="Minhas vendas por mês"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Minhas vendas por mês</h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="ano-vendas-representante">Ano</Label>
            <select
              id="ano-vendas-representante"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            >
              {Array.from({ length: 6 }, (_, i) => anoAtual - i).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Somente seus pedidos e clientes da sua carteira, na loja selecionada. Clientes de outros
          representantes não entram, mesmo na mesma rota.
        </p>
        {q.error && (
          <p role="alert" className="text-sm text-destructive">
            {q.error.message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Resumo
            label={`Vendas em ${String(mes).padStart(2, "0")}/${ano}`}
            value={q.data ? brl(q.data.meses.find((m) => m.mes === mes)?.valor ?? 0) : "—"}
          />
          <Resumo label={`Vendas no ano · ${ano}`} value={q.data ? brl(q.data.total) : "—"} />
          <Resumo
            label="Clientes da minha carteira"
            value={q.data ? String(q.data.carteira) : "—"}
          />
          <Resumo
            label="Clientes com limite pendente"
            value={q.data ? String(q.data.credito_pendente) : "—"}
          />
        </div>
        {q.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Mês</th>
                  <th className="p-2 text-right">Pedidos</th>
                  <th className="p-2 text-right">Valor das vendas</th>
                </tr>
              </thead>
              <tbody>
                {q.data.meses.map((m) => (
                  <tr key={m.mes} className="border-t">
                    <td className="p-2">
                      {new Date(ano, m.mes - 1, 1).toLocaleDateString("pt-BR", { month: "long" })}
                    </td>
                    <td className="p-2 text-right">{m.pedidos}</td>
                    <td className="relative p-2 text-right">
                      <span
                        aria-hidden
                        className="absolute bottom-0 right-0 top-0 bg-primary/10"
                        style={{
                          width: `${Math.max(0, Math.min(100, (m.valor / Math.max(1, ...q.data!.meses.map((v) => v.valor))) * 100))}%`,
                        }}
                      />
                      <span className="relative">{brl(m.valor)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Pedidos confirmados e etapas seguintes, pela data do pedido. Rascunhos, orçamentos e
          cancelamentos não entram; devoluções não são abatidas destes valores.
        </p>
      </section>
      {(reativacao || cobranca) && (
        <section className="grid gap-4 sm:grid-cols-2" aria-label="Prioridades da minha carteira">
          {reativacao && (
            <Link
              to="/agenda-comercial"
              search={{ aba: "reativacao" }}
              className="rounded-2xl border bg-card p-5"
            >
              <h2 className="text-sm text-muted-foreground">
                Clientes sem comprar há {FILTROS_AGENDA.dias} dias ou mais
              </h2>
              <p className="mt-2 text-3xl font-semibold">
                {agenda.isError ? "Indisponível" : (agenda.data?.semCompras?.count ?? "—")}
              </p>
              <p className="mt-2 text-xs text-primary">
                Inclui quem nunca comprou. Ver detalhes e filtrar por rota na Agenda Comercial.
              </p>
            </Link>
          )}
          {cobranca && (
            <Link
              to="/agenda-comercial"
              search={{ aba: "cobranca" }}
              className="rounded-2xl border bg-card p-5"
            >
              <h2 className="text-sm text-muted-foreground">Saldo em atraso dos meus clientes</h2>
              <p className="mt-2 text-3xl font-semibold">
                {agenda.isError
                  ? "Indisponível"
                  : agenda.data?.atrasos
                    ? brl(agenda.data.atrasos.resumo.vencido)
                    : "—"}
              </p>
              <p className="mt-2 text-xs text-primary">
                Ver clientes, títulos e acompanhamentos na Agenda Comercial.
              </p>
            </Link>
          )}
          {agenda.error && (
            <p role="alert" className="text-sm text-destructive">
              {agenda.error.message}
            </p>
          )}
        </section>
      )}
      {acesso.pode("/pessoas") && (
        <Link className="inline-block text-sm text-primary underline" to="/pessoas">
          Consultar minha carteira ou cadastrar novo cliente
        </Link>
      )}
      <MetasRepresentante />
    </div>
  );
}
function Resumo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <h3 className="text-sm text-muted-foreground">{label}</h3>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function MetasRepresentante() {
  const { client, user } = useSupabase();
  const acesso = useAcesso();
  const month = hojeSaoPaulo().slice(0, 7);
  const meta = useQuery({
    queryKey: ["painel-meta", user?.id, month],
    enabled: !!client && acesso.pode("/metas"),
    queryFn: async () => {
      const r = await client!
        .from("vw_metas_acompanhamento")
        .select("*")
        .eq("ano", Number(month.slice(0, 4)))
        .eq("mes", Number(month.slice(5)))
        .limit(10);
      if (r.error) throw new Error("Metas indisponíveis.");
      return r.data ?? [];
    },
  });
  return (
    <section className="mb-5 grid gap-4 sm:grid-cols-2" aria-label="Minha carteira e metas">
      {acesso.pode("/metas") && (
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex justify-between gap-2">
            <h2 className="text-sm font-medium">
              Minha meta · {month.split("-").reverse().join("/")}
            </h2>
            <Link to="/metas" className="text-xs text-primary">
              Ver metas
            </Link>
          </div>
          {meta.isError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Não foi possível carregar sua meta.
            </p>
          ) : meta.isPending ? (
            <p className="mt-3 text-sm">Carregando…</p>
          ) : meta.data?.length ? (
            meta.data.map((m) => (
              <div key={String(m.id)} className="mt-3">
                <p className="text-xl font-semibold">
                  {Number(m.atingimento_percentual ?? 0).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                  %
                </p>
                <progress
                  className="mt-2 h-2 w-full accent-primary"
                  aria-label="Atingimento da meta"
                  max={100}
                  value={Math.max(0, Math.min(100, Number(m.atingimento_percentual ?? 0)))}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {brl(m.realizado)} de {brl(m.valor_meta)}
                </p>
              </div>
            ))
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma meta cadastrada para este mês.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Acompanhamento mensal da carteira, considerando todos os centros permitidos.
          </p>
        </div>
      )}
    </section>
  );
}
