import { ReferenciaRegistro } from "@/components/referencia-registro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/conciliacao-creditos")({
  head: () => ({
    meta: [
      { title: "Conciliação de créditos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Conferência e migração segura dos antigos créditos DEV para créditos de clientes.",
      },
      { property: "og:title", content: "Conciliação de créditos — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Conferência dos créditos de clientes no Caparaó System.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConciliacaoCreditosPage,
});

type Row = Record<string, unknown>;

const situacoes: Record<string, string> = {
  apto_para_migracao: "Apto para migração",
  ja_migrado: "Já migrado",
  valor_nao_negativo: "Valor não negativo",
  possui_movimentacao: "Possui movimentação",
  devolucao_nao_localizada: "Devolução não localizada",
  devolucao_nao_confirmada: "Devolução não confirmada",
  cliente_divergente: "Cliente divergente",
  centro_divergente: "Centro divergente",
  valor_divergente: "Valor divergente",
};

function ConciliacaoCreditosPage() {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");

  const dados = useQuery({
    queryKey: ["conciliacao_creditos_dev"],
    enabled: !!client && canManage,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_conciliacao_creditos_dev")
        .select("*")
        .order("documento", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const migrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("migrar_credito_dev", { _conta_receber_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Crédito legado migrado para crédito do cliente");
      queryClient.invalidateQueries({ queryKey: ["conciliacao_creditos_dev"] });
      queryClient.invalidateQueries({ queryKey: ["creditos_clientes"] });
      queryClient.invalidateQueries({ queryKey: ["contas_receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return dados.data ?? [];
    return (dados.data ?? []).filter((r) =>
      [r["documento"], r["cliente_id"], r["devolucao_numero"], r["situacao"]]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [dados.data, busca]);

  const aptos = (dados.data ?? []).filter((r) => r["situacao"] === "apto_para_migracao").length;
  const migrados = (dados.data ?? []).filter((r) => r["situacao"] === "ja_migrado").length;

  if (!canManage) {
    return (
      <ErpLayout title="Conciliação de créditos" description="Acesso restrito.">
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Apenas usuários autorizados pela gestão podem migrar créditos financeiros legados.
        </p>
      </ErpLayout>
    );
  }

  return (
    <ErpLayout
      title="Conciliação de créditos"
      description="Revise os antigos lançamentos DEV antes de convertê-los em créditos de clientes."
      actions={
        <Button variant="outline" onClick={() => dados.refetch()} disabled={dados.isFetching}>
          {dados.isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Atualizar
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Resumo titulo="Registros DEV" valor={dados.data?.length ?? 0} />
          <Resumo titulo="Aptos para migração" valor={aptos} />
          <Resumo titulo="Já migrados" valor={migrados} />
        </div>

        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="text-sm font-semibold">Créditos legados</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                A migração só é liberada quando cliente, centro, devolução e valor estiverem
                consistentes.
              </p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar documento, devolução ou situação..."
                className="pl-9"
              />
            </div>
          </div>

          {dados.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando conciliação...
            </div>
          ) : dados.isError ? (
            <p className="p-6 text-sm text-destructive">{(dados.error as Error).message}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3">Documento</th>
                    <th className="p-3">Devolução</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Situação</th>
                    <th className="p-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        Nenhum crédito legado encontrado.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const situacao = String(r["situacao"] ?? "");
                      const apto = situacao === "apto_para_migracao";
                      return (
                        <tr
                          key={String(r["conta_receber_id"])}
                          className="border-b border-border/60"
                        >
                          <td className="p-3 font-medium">{String(r["documento"] ?? "—")}</td>
                          <td className="p-3">
                            {r["devolucao_numero"] ? "#" + String(r["devolucao_numero"]) : "—"}
                          </td>
                          <td className="p-3">{brl(Math.abs(Number(r["valor"] ?? 0)))}</td>
                          <td className="max-w-[260px] truncate p-3 text-xs text-muted-foreground">
                            <ReferenciaRegistro tipo="cliente" id={r["cliente_id"]}>
                              {String(r["cliente_id"] ?? "—")}
                            </ReferenciaRegistro>
                          </td>
                          <td className="p-3">
                            <span
                              className={
                                apto
                                  ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700"
                                  : "inline-flex rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                              }
                            >
                              {apto ? <CheckCircle2 className="size-3" /> : null}
                              {situacoes[situacao] ?? situacao}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {apto ? (
                              <Button
                                size="sm"
                                disabled={migrar.isPending}
                                onClick={() => migrar.mutate(String(r["conta_receber_id"]))}
                              >
                                Migrar para crédito
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpLayout>
  );
}

function Resumo({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-xl font-semibold">{valor}</p>
    </article>
  );
}
