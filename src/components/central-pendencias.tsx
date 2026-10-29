import { PENDENCIAS_COMERCIAIS_CLIENTE } from "@/lib/pendencias-cadastro";
import { setCentro } from "@/lib/centro-store";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { usePendencias } from "@/lib/use-pendencias";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
export function CentralPendencias({ compact = false }: { compact?: boolean }) {
  const q = usePendencias();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [prioridade, setPrioridade] = useState("");
  const cadastroFiltro = PENDENCIAS_COMERCIAIS_CLIENTE.find((p) => p.label === categoria)?.filtro;
  const rows = (q.data?.itens ?? []).filter(
    (r) =>
      (!categoria || r.categoria === categoria) &&
      (!prioridade || r.prioridade === prioridade) &&
      `${r.titulo} ${r.detalhe}`
        .toLocaleLowerCase("pt-BR")
        .includes(busca.toLocaleLowerCase("pt-BR")),
  );
  return (
    <section
      className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
      aria-label="Central de pendências"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-amber-600" />
            Próximas ações
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pendências dos módulos e centros que você pode acessar.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className="size-4" />
          Atualizar pendências
        </Button>
      </div>
      {q.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando pendências…
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as pendências. Tente novamente.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {q.data?.categorias.map((c) => (
              <button
                key={c.id}
                aria-pressed={categoria === c.label}
                onClick={() => setCategoria(categoria === c.label ? "" : c.label)}
                className={`rounded-xl border p-3 text-left transition-colors hover:border-primary ${categoria === c.label ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="text-xl font-semibold">{c.total ?? "—"}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{c.label}</span>
              </button>
            ))}
          </div>
          {q.data?.categorias
            .filter((c) => c.erro)
            .map((c) => (
              <p key={c.id} role="alert" className="text-sm text-destructive">
                {c.erro} Atualize para tentar novamente.
              </p>
            ))}
          {cadastroFiltro && (
            <Link
              to="/pessoas"
              search={{ pendencia: cadastroFiltro }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-primary"
            >
              Ver clientes no Cadastro unificado <ArrowRight className="size-4" />
            </Link>
          )}
          {!compact && (
            <FilterBar
              onClear={() => {
                setBusca("");
                setCategoria("");
                setPrioridade("");
              }}
            >
              <FilterText label="Buscar pendência" value={busca} onChange={setBusca} />
              <FilterSelect
                label="Tipo de pendência"
                value={categoria}
                onChange={setCategoria}
                options={(q.data?.categorias ?? []).map((c) => ({
                  value: c.label,
                  label: c.label,
                }))}
              />
              <FilterSelect
                label="Prioridade"
                value={prioridade}
                onChange={setPrioridade}
                options={[
                  { value: "alta", label: "Alta" },
                  { value: "normal", label: "Normal" },
                ]}
              />
            </FilterBar>
          )}
          <ul className="divide-y">
            {rows.slice(0, compact ? 5 : rows.length).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {r.titulo}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${r.prioridade === "alta" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
                    >
                      {r.prioridade === "alta" ? "Prioridade alta" : "A revisar"}
                    </span>
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{r.detalhe}</p>
                </div>
                <Link
                  to={r.to}
                  onClick={() => {
                    if (r.centro) setCentro(r.centro);
                  }}
                  search={
                    r.loja
                      ? { loja: r.loja, cidade: r.cidade ?? "", uf: r.uf ?? "" }
                      : r.pedido
                        ? { pedido: r.pedido }
                        : r.pessoa
                          ? { pessoa: r.pessoa }
                          : r.cliente
                            ? { cliente: r.cliente }
                            : {}
                  }
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-xs font-medium text-primary"
                >
                  Revisar
                  <ArrowRight className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
          {!rows.length && !q.data?.categorias.some((c) => c.erro) && (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Nenhuma pendência encontrada nos filtros atuais.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Exibimos até 40 registros por tipo. Os contadores incluem todos os registros
            disponíveis; use Revisar para continuar no módulo responsável.
          </p>
          {compact && (
            <Link
              to="/pendencias"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
            >
              Abrir central de pendências
              <ArrowRight className="size-4" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}
