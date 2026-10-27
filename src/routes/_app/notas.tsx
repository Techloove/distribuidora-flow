import { ReferenciaRegistro } from "@/components/referencia-registro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { ForecastPrevia } from "@/components/forecast-previa";

export const Route = createFileRoute("/_app/notas")({
  head: () => ({
    meta: [
      { title: "Faturamento e notas fiscais — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Faturamento dos pedidos com separação conferida, emissão e autorização da nota fiscal de saída, com registro de chave, protocolo e retorno fiscal.",
      },
      { property: "og:title", content: "Faturamento e notas fiscais — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Faturar somente pedidos conferidos e controlar a autorização da nota fiscal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotasPage,
});

type Row = Record<string, unknown>;

const moeda = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const tomNota = (s: string) => {
  if (s === "autorizada") return "bg-emerald-500/15 text-emerald-600";
  if (s === "rejeitada") return "bg-destructive/10 text-destructive";
  if (s === "cancelada") return "bg-muted text-muted-foreground";
  return "bg-amber-500/15 text-amber-600";
};

function NotasPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const podeFaturar = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  const permissoes = usePermissoesRotinas();
  const [previa, setPrevia] = useState<string | null>(null);

  const [autorizar, setAutorizar] = useState<Row | null>(null);
  const [rejeitar, setRejeitar] = useState<Row | null>(null);
  const [form, setForm] = useState({ nf: "", serie: "", chave: "", protocolo: "", mensagem: "" });
  const [motivo, setMotivo] = useState("");

  const pedidos = useQuery({
    queryKey: ["pedidos_conferidos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select(
          "id, numero, cliente_id, data_pedido, total_liquido, centro_id, clientes(razao_social)",
        )
        .eq("status", "conferido")
        .order("numero");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const notas = useQuery({
    queryKey: ["notas_saida"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("notas_saida")
        .select(
          "id, numero, pedido_id, cliente_id, nf_numero, serie, status, data_emissao, valor_total, chave_acesso, protocolo, mensagem_retorno, centro_id, pedidos(numero), clientes(razao_social)",
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rpc = useMutation({
    mutationFn: async (args: { fn: string; params: Record<string, unknown> }) => {
      const { error } = await client!.rpc(args.fn, args.params);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setAutorizar(null);
      setRejeitar(null);
      setForm({ nf: "", serie: "", chave: "", protocolo: "", mensagem: "" });
      setMotivo("");
      toast.success("Operação concluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listaPedidos = (pedidos.data ?? []).filter((p) => !centro || p["centro_id"] === centro);
  const listaNotas = (notas.data ?? []).filter(
    (n) => !centro || !n["centro_id"] || n["centro_id"] === centro,
  );

  return (
    <ErpLayout
      title="Faturamento e nota fiscal"
      description="Só aparecem aqui os pedidos com separação concluída e conferida. A exigência de nota autorizada para boletos depende das regras da loja."
    >
      <div className="space-y-6">
        <p className="rounded-lg border bg-muted p-4 text-sm" role="status">
          Forecast Fiscal é a API fiscal do sistema. A conexão está disponível nas configurações da
          loja. Use a prévia de homologação para conferir os dados antes da transmissão. O registro
          de notas autorizadas externamente continua disponível.
        </p>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Pedidos liberados para faturar</h2>
          {pedidos.error && (
            <p role="alert" className="text-destructive">
              {pedidos.error.message}
            </p>
          )}
          {pedidos.isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : listaPedidos.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
              Nenhum pedido conferido aguardando faturamento.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Pedido</th>
                    <th className="px-4 py-2 text-left font-medium">Cliente</th>
                    <th className="px-4 py-2 text-left font-medium">Data</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listaPedidos.map((p) => (
                    <tr key={String(p["id"])} className="hover:bg-accent/50">
                      <td className="px-4 py-2.5 font-semibold">
                        <ReferenciaRegistro tipo="pedido" id={p["id"]}>
                          #{String(p["numero"])}
                        </ReferenciaRegistro>
                      </td>
                      <td className="max-w-[320px] truncate px-4 py-2.5">
                        <ReferenciaRegistro tipo="cliente" id={p["cliente_id"]}>
                          {String((p["clientes"] as Row | null)?.["razao_social"] ?? "—")}
                        </ReferenciaRegistro>
                      </td>
                      <td className="px-4 py-2.5">
                        {p["data_pedido"]
                          ? new Date(`${String(p["data_pedido"])}T00:00:00`).toLocaleDateString(
                              "pt-BR",
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">{moeda(p["total_liquido"])}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          disabled={!podeFaturar || rpc.isPending}
                          onClick={() =>
                            rpc.mutate({
                              fn: "faturar_pedido",
                              params: { _pedido_id: p["id"] },
                            })
                          }
                        >
                          Faturar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Notas fiscais de saída</h2>
          {notas.error && (
            <p role="alert" className="text-destructive">
              {notas.error.message}. Confira a fase259 no Supabase.
            </p>
          )}
          {notas.isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : listaNotas.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
              Nenhuma nota registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nº interno</th>
                    <th className="px-4 py-2 text-left font-medium">Pedido</th>
                    <th className="px-4 py-2 text-left font-medium">Cliente</th>
                    <th className="px-4 py-2 text-left font-medium">NF / série</th>
                    <th className="px-4 py-2 text-left font-medium">Situação</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listaNotas.map((n) => {
                    const status = String(n["status"]);
                    return (
                      <tr key={String(n["id"])} className="hover:bg-accent/50">
                        <td className="px-4 py-2.5 font-semibold">#{String(n["numero"])}</td>
                        <td className="px-4 py-2.5">
                          <ReferenciaRegistro tipo="pedido" id={n["pedido_id"]}>
                            {(n["pedidos"] as Row | null)?.["numero"]
                              ? `#${String((n["pedidos"] as Row)["numero"])}`
                              : "—"}
                          </ReferenciaRegistro>
                        </td>
                        <td className="max-w-[260px] truncate px-4 py-2.5">
                          <ReferenciaRegistro tipo="cliente" id={n["cliente_id"]}>
                            {String((n["clientes"] as Row | null)?.["razao_social"] ?? "—")}
                          </ReferenciaRegistro>
                        </td>
                        <td className="px-4 py-2.5">
                          {n["nf_numero"]
                            ? `${String(n["nf_numero"])} / ${String(n["serie"])}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${tomNota(status)}`}
                          >
                            {status}
                          </span>
                          {n["mensagem_retorno"] ? (
                            <span className="ml-2 text-[11px] text-muted-foreground">
                              {String(n["mensagem_retorno"])}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-right">{moeda(n["valor_total"])}</td>
                        <td className="space-x-2 px-4 py-2.5 text-right">
                          {
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !podeFaturar ||
                                !permissoes.pode("faturamento_emitir_nfe") ||
                                rpc.isPending
                              }
                              onClick={() => setPrevia(String(n["id"]))}
                            >
                              Forecast · Homologação
                            </Button>
                          }
                          {status === "pendente" || status === "rejeitada" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={!podeFaturar}
                                onClick={() => {
                                  setForm({
                                    nf: String(n["nf_numero"] ?? ""),
                                    serie: String(n["serie"] ?? "1"),
                                    chave: "",
                                    protocolo: "",
                                    mensagem: "",
                                  });
                                  setAutorizar(n);
                                }}
                              >
                                Registrar autorização
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!podeFaturar}
                                onClick={() => setRejeitar(n)}
                              >
                                Rejeição
                              </Button>
                            </>
                          ) : null}
                          {status !== "cancelada" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!podeFaturar}
                              onClick={() =>
                                rpc.mutate({ fn: "cancelar_nota_saida", params: { _id: n["id"] } })
                              }
                            >
                              Cancelar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {previa &&
        podeFaturar &&
        permissoes.pode("faturamento_emitir_nfe") &&
        listaNotas.some((n) => String(n["id"]) === previa) && (
          <ForecastPrevia key={previa} nota={previa} onClose={() => setPrevia(null)} />
        )}
      <Dialog open={!!autorizar} onOpenChange={(o) => !o && setAutorizar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota autorizada</DialogTitle>
            <DialogDescription>
              Informe os dados do retorno fiscal. A nota só é considerada emitida com número
              autorizado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Número da NF</Label>
              <Input value={form.nf} onChange={(e) => setForm({ ...form, nf: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Série</Label>
              <Input
                value={form.serie}
                onChange={(e) => setForm({ ...form, serie: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Chave de acesso</Label>
              <Input
                value={form.chave}
                onChange={(e) => setForm({ ...form, chave: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Protocolo</Label>
              <Input
                value={form.protocolo}
                onChange={(e) => setForm({ ...form, protocolo: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Mensagem do retorno</Label>
              <Input
                value={form.mensagem}
                onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutorizar(null)}>
              Voltar
            </Button>
            <Button
              disabled={!form.nf.trim() || rpc.isPending}
              onClick={() =>
                rpc.mutate({
                  fn: "autorizar_nota",
                  params: {
                    _id: autorizar?.["id"],
                    _nf_numero: form.nf.trim(),
                    _chave: form.chave.trim() || null,
                    _protocolo: form.protocolo.trim() || null,
                    _mensagem: form.mensagem.trim() || null,
                    _serie: form.serie.trim() || null,
                  },
                })
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejeitar} onOpenChange={(o) => !o && setRejeitar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota rejeitada</DialogTitle>
            <DialogDescription>
              O pedido volta para faturamento e a nota pode ser corrigida e reenviada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Motivo / retorno da SEFAZ</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejeitar(null)}>
              Voltar
            </Button>
            <Button
              disabled={!motivo.trim() || rpc.isPending}
              onClick={() =>
                rpc.mutate({
                  fn: "rejeitar_nota",
                  params: { _id: rejeitar?.["id"], _motivo: motivo.trim() },
                })
              }
            >
              Registrar rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
