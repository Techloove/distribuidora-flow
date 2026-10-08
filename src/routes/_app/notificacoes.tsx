import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Bell, CheckCircle2, Info, Loader2, Printer, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Central de notificações do ERP: pedidos confirmados, expedições em rota e alertas de estoque mínimo.",
      },
      { property: "og:title", content: "Notificações — ERP Distribuidora" },
      { property: "og:description", content: "Alertas operacionais da distribuidora." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificacoesPage,
});

type Row = Record<string, unknown>;

const icons = {
  info: Info,
  alerta: AlertTriangle,
  erro: XCircle,
  sucesso: CheckCircle2,
} as const;

function NotificacoesPage() {
  const { client } = useSupabase();
  const queryClient = useQueryClient();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const notificacoes = useQuery({
    queryKey: ["notificacoes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("notificacoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const marcar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await client!.from("notificacoes").update({ lida: true }).in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const all = useMemo(() => notificacoes.data ?? [], [notificacoes.data]);
  const unread = all.filter((r) => !r["lida"]);

  const rows = useMemo(() => {
    let list = onlyUnread ? all.filter((r) => !r["lida"]) : all;
    const f = filtros;
    if (f["tipo"]) list = list.filter((r) => String(r["tipo"]) === f["tipo"]);
    if (f["lida"]) list = list.filter((r) => String(!!r["lida"]) === f["lida"]);
    if (f["de"]) list = list.filter((r) => String(r["created_at"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((r) => String(r["created_at"] ?? "") <= `${f["ate"]}T23:59:59`);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (r) =>
          String(r["titulo"] ?? "").toLowerCase().includes(termo) ||
          String(r["mensagem"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [all, onlyUnread, filtros]);

  return (
    <ErpLayout
      title="Notificações"
      description="Eventos gerados automaticamente pelo ERP: vendas, expedição e estoque mínimo."
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
          <Button
            size="sm"
            disabled={unread.length === 0 || marcar.isPending}
            onClick={() => marcar.mutate(unread.map((r) => String(r["id"])))}
          >
            Marcar todas como lidas
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="no-print flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={onlyUnread ? "outline" : "default"}
            onClick={() => setOnlyUnread(false)}
          >
            Todas ({all.length})
          </Button>
          <Button
            size="sm"
            variant={onlyUnread ? "default" : "outline"}
            onClick={() => setOnlyUnread(true)}
          >
            Não lidas ({unread.length})
          </Button>
        </div>

        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Tipo"
            value={filtros["tipo"] ?? ""}
            onChange={(v) => setF("tipo", v)}
            options={[
              { value: "info", label: "Info" },
              { value: "alerta", label: "Alerta" },
              { value: "erro", label: "Erro" },
              { value: "sucesso", label: "Sucesso" },
            ]}
          />
          <FilterSelect
            label="Lida"
            value={filtros["lida"] ?? ""}
            onChange={(v) => setF("lida", v)}
            options={[
              { value: "true", label: "Lidas" },
              { value: "false", label: "Não lidas" },
            ]}
          />
          <FilterText
            label="De"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
        </FilterBar>

        <div className="print-area rounded-lg border border-border bg-card">
          {notificacoes.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : notificacoes.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(notificacoes.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase4_logistica_relatorios.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Bell className="size-4" /> Nenhuma notificação neste filtro.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const Icon = icons[(String(r["tipo"]) as keyof typeof icons) ?? "info"] ?? Info;
                return (
                  <li key={String(r["id"])} className="flex items-start gap-3 px-5 py-4">
                    <Icon
                      className={`mt-0.5 size-4 shrink-0 ${
                        r["tipo"] === "alerta" || r["tipo"] === "erro"
                          ? "text-destructive"
                          : "text-primary"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm ${
                          r["lida"] ? "text-muted-foreground" : "font-medium text-foreground"
                        }`}
                      >
                        {String(r["titulo"])}
                      </p>
                      {r["mensagem"] ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {String(r["mensagem"])}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {new Date(String(r["created_at"])).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    {!r["lida"] ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="no-print"
                        onClick={() => marcar.mutate([String(r["id"])])}
                      >
                        Marcar lida
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
