import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSupabase } from "@/lib/supabase-provider";
import { useAcesso } from "@/lib/permissoes";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl } from "@/lib/formatacao";
export function PainelRepresentante() {
  const { client, user } = useSupabase();
  const acesso = useAcesso();
  const month = hojeSaoPaulo().slice(0, 7);
  const carteira = useQuery({
    queryKey: ["painel-carteira", user?.id],
    enabled: !!client && acesso.pode("/pessoas"),
    queryFn: async () => {
      const r = await client!.from("clientes").select("id", { count: "exact", head: true });
      if (r.error) throw new Error("Carteira indisponível.");
      return r.count ?? 0;
    },
  });
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
      {acesso.pode("/pessoas") && (
        <Link to="/pessoas" className="rounded-2xl border bg-card p-5">
          <h2 className="text-sm text-muted-foreground">Clientes da minha carteira</h2>
          <p className="mt-2 text-3xl font-semibold">
            {carteira.isError ? "Indisponível" : (carteira.data ?? "—")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Carteira completa, independente do filtro de centro.
          </p>
        </Link>
      )}
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
