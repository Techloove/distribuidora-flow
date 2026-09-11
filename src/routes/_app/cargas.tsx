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

export const Route = createFileRoute("/_app/cargas")({
  head: () => ({
    meta: [
      { title: "Cargas de entrega — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Geração de cargas por rota com pedidos faturados e nota fiscal autorizada, controle de motorista, veículo, volumes, peso e status da entrega.",
      },
      { property: "og:title", content: "Cargas de entrega — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Montagem da carga por rota apenas com pedidos liberados para entrega.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CargasPage,
});

type Row = Record<string, unknown>;

const moeda = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PROXIMOS: Record<string, string[]> = {
  aberta: ["em_preparacao", "fechada", "cancelada"],
  em_preparacao: ["fechada", "cancelada"],
  fechada: ["em_rota", "aberta", "cancelada"],
  em_rota: ["entregando", "concluida"],
  entregando: ["concluida"],
};

const tom = (s: string) => {
  if (s === "concluida") return "bg-primary/15 text-primary";
  if (s === "cancelada") return "bg-destructive/10 text-destructive";
  if (s === "em_rota" || s === "entregando") return "bg-emerald-500/15 text-emerald-600";
  if (s === "fechada") return "bg-amber-500/15 text-amber-600";
  return "bg-secondary text-secondary-foreground";
};

function CargasPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const podeExpedir = roles.some((r) => ["admin", "gestor", "expedicao", "estoque"].includes(r));

  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [form, setForm] = useState({
    rota_id: "",
    data: new Date().toISOString().slice(0, 10),
    responsavel: "",
    motorista: "",
    placa: "",
    observacoes: "",
  });

  const rotas = useQuery({
    queryKey: ["rotas_ativas"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("rotas").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const cargas = useQuery({
    queryKey: ["vw_cargas"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_cargas")
        .select("*")
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const itensCarga = useQuery({
    queryKey: ["vw_carga_pedidos", aberta],
    enabled: !!client && !!aberta,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_carga_pedidos")
        .select("*")
        .eq("carga_id", aberta!);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const disponiveis = useQuery({
    queryKey: ["vw_pedidos_para_carga"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_pedidos_para_carga").select("*").order("numero");
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
      setNova(false);
      toast.success("Operação concluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = (cargas.data ?? []).filter((c) => !centro || !c["centro_id"] || c["centro_id"] === centro);
  const cargaAtual = lista.find((c) => c["id"] === aberta) ?? null;
  const candidatos = (disponiveis.data ?? []).filter(
    (p) =>
      (!centro || p["centro_id"] === centro) &&
      (!cargaAtual?.["rota_id"] || p["rota_id"] === cargaAtual["rota_id"]),
  );

  return (
    <ErpLayout
      title="Cargas de entrega"
      description="Monte a carga por rota. Só entram pedidos faturados com nota fiscal autorizada."
      actions={
        <Button disabled={!podeExpedir} onClick={() => setNova(true)}>
          Gerar carga
        </Button>
      }
    >
      <div className="space-y-6">
        {cargas.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : lista.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            Nenhuma carga gerada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Carga</th>
                  <th className="px-4 py-2 text-left font-medium">Data</th>
                  <th className="px-4 py-2 text-left font-medium">Rota</th>
                  <th className="px-4 py-2 text-left font-medium">Motorista / veículo</th>
                  <th className="px-4 py-2 text-right font-medium">Pedidos</th>
                  <th className="px-4 py-2 text-right font-medium">Clientes</th>
                  <th className="px-4 py-2 text-right font-medium">Peso (kg)</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-left font-medium">Situação</th>
                  <th className="px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((c) => {
                  const status = String(c["status"]);
                  const id = String(c["id"]);
                  return (
                    <tr
                      key={id}
                      onClick={() => setAberta(aberta === id ? null : id)}
                      className={`cursor-pointer border-l-2 transition-colors ${
                        aberta === id
                          ? "border-l-primary bg-accent"
                          : "border-l-transparent hover:bg-accent/50"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-semibold">#{String(c["numero"])}</td>
                      <td className="px-4 py-2.5">
                        {c["data"]
                          ? new Date(`${String(c["data"])}T00:00:00`).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">{String(c["rota"] ?? "—")}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {[c["motorista"], c["placa"]].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">{String(c["pedidos"] ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">{String(c["clientes"] ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {Number(c["peso_kg"] ?? 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2.5 text-right">{moeda(c["valor_total"])}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${tom(status)}`}
                        >
                          {status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="space-x-2 px-4 py-2.5 text-right">
                        {(PROXIMOS[status] ?? []).map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={s === "cancelada" ? "ghost" : "secondary"}
                            disabled={!podeExpedir || rpc.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              rpc.mutate({
                                fn: "avancar_carga",
                                params: { _carga_id: id, _status: s },
                              });
                            }}
                          >
                            {s.replace(/_/g, " ")}
                          </Button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {cargaAtual ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-2 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">
                Pedidos da carga #{String(cargaAtual["numero"])} · {String(cargaAtual["rota"] ?? "—")}
              </h2>
              {(itensCarga.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido nesta carga.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {(itensCarga.data ?? []).map((p) => (
                    <li
                      key={String(p["pedido_id"])}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold">#{String(p["numero"])}</span>{" "}
                        <span className="text-muted-foreground">
                          {String(p["cliente"] ?? "—")}
                          {p["nf_numero"] ? ` · NF ${String(p["nf_numero"])}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 whitespace-nowrap">
                        <span>{moeda(p["total_liquido"])}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!podeExpedir}
                          onClick={() =>
                            rpc.mutate({
                              fn: "remover_pedido_carga",
                              params: { _carga_id: cargaAtual["id"], _pedido_id: p["pedido_id"] },
                            })
                          }
                        >
                          Retirar
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Pedidos liberados para esta rota</h2>
              {candidatos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum pedido faturado e liberado aguardando carga nesta rota.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {candidatos.map((p) => (
                    <li
                      key={String(p["pedido_id"])}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold">#{String(p["numero"])}</span>{" "}
                        <span className="text-muted-foreground">
                          {String(p["cliente"] ?? "—")}
                          {p["nf_numero"] ? ` · NF ${String(p["nf_numero"])}` : " · sem NF"}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 whitespace-nowrap">
                        <span>{moeda(p["total_liquido"])}</span>
                        <Button
                          size="sm"
                          disabled={!podeExpedir}
                          onClick={() =>
                            rpc.mutate({
                              fn: "adicionar_pedido_carga",
                              params: { _carga_id: cargaAtual["id"], _pedido_id: p["pedido_id"] },
                            })
                          }
                        >
                          Incluir
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>

      <Dialog open={nova} onOpenChange={setNova}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar carga</DialogTitle>
            <DialogDescription>
              A carga é sempre vinculada a uma rota. Depois inclua os pedidos liberados.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Rota</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.rota_id}
                onChange={(e) => setForm({ ...form, rota_id: e.target.value })}
              >
                <option value="">Selecione a rota</option>
                {(rotas.data ?? []).map((r) => (
                  <option key={String(r["id"])} value={String(r["id"])}>
                    {String(r["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Responsável</Label>
              <Input
                value={form.responsavel}
                onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Motorista</Label>
              <Input
                value={form.motorista}
                onChange={(e) => setForm({ ...form, motorista: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Placa do veículo</Label>
              <Input
                value={form.placa}
                onChange={(e) => setForm({ ...form, placa: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNova(false)}>
              Voltar
            </Button>
            <Button
              disabled={!form.rota_id || rpc.isPending}
              onClick={() =>
                rpc.mutate({
                  fn: "criar_carga",
                  params: {
                    _rota_id: form.rota_id,
                    _data: form.data,
                    _centro_id: centro ? centro : null,
                    _responsavel: form.responsavel || null,
                    _motorista: form.motorista || null,
                    _placa: form.placa || null,
                    _observacoes: form.observacoes || null,
                  },
                })
              }
            >
              Criar carga
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
