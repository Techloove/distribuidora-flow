import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
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
import { filtrarCentro, useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/expedicao")({
  head: () => ({
    meta: [
      { title: "Expedição e entregas — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Romaneios de expedição por pedido: separação, saída em rota, entrega confirmada e dados de transporte.",
      },
      { property: "og:title", content: "Expedição e entregas — ERP Distribuidora" },
      { property: "og:description", content: "Controle logístico das entregas de pedidos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpedicaoPage,
});

type Row = Record<string, unknown>;

const statuses = ["todos", "pendente", "separacao", "em_rota", "entregue", "cancelada"] as const;

const next: Record<string, { status: string; label: string }[]> = {
  pendente: [
    { status: "separacao", label: "Iniciar separação" },
    { status: "cancelada", label: "Cancelar" },
  ],
  separacao: [
    { status: "em_rota", label: "Despachar" },
    { status: "cancelada", label: "Cancelar" },
  ],
  em_rota: [{ status: "entregue", label: "Confirmar entrega" }],
};

const statusTone = (s: string) => {
  const v = s.toLowerCase();
  if (v.startsWith("cancel")) return "bg-destructive/10 text-destructive";
  if (v === "entregue") return "bg-primary/15 text-primary";
  if (v === "em_rota") return "bg-emerald-500/15 text-emerald-600";
  if (v === "separacao") return "bg-amber-500/15 text-amber-600";
  return "bg-secondary text-secondary-foreground";
};

function ExpedicaoPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>("todos");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const canShip =
    roles.includes("admin") ||
    roles.includes("gestor") ||
    roles.includes("expedicao") ||
    roles.includes("estoque");

  const expedicoes = useQuery({
    queryKey: ["expedicoes", centro],
    enabled: !!client && !!centro,
    queryFn: async () => {
      const { data, error } = await client!
        .from("expedicoes")
        .select("*")
        .eq("centro_id", centro!)
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const pedidos = useQuery({
    queryKey: ["pedidos", "expedicao", centro],
    enabled: !!client && !!centro,
    queryFn: async () => {
      const { data, error } = await client!.from("pedidos").select("id, numero, cliente_id, status").eq("centro_id", centro!);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes", "options", centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("clientes").select("id, razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const transportadoras = useQuery({
    queryKey: ["transportadoras", "options", centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("transportadoras")
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rotas = useQuery({
    queryKey: ["rotas", "options", centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("rotas")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const pedidoLabel = (id: unknown) => {
    const p = pedidos.data?.find((x) => x["id"] === id);
    if (!p) return "—";
    const cli = clientes.data?.find((c) => c["id"] === p["cliente_id"]);
    return `#${String(p["numero"])} · ${String(cli?.["razao_social"] ?? "—")}`;
  };

  const rows = useMemo(() => {
    let list = filtrarCentro(expedicoes.data ?? [], centro);
    if (status !== "todos") list = list.filter((r) => r["status"] === status);
    const f = filtros;
    if (f["rota"]) list = list.filter((r) => String(r["rota_id"] ?? "") === f["rota"]);
    if (f["de"])
      list = list.filter((r) => String(r["previsao_entrega"] ?? "") >= f["de"]!);
    if (f["ate"])
      list = list.filter((r) => String(r["previsao_entrega"] ?? "") <= f["ate"]!);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((r) => pedidoLabel(r["pedido_id"]).toLowerCase().includes(termo));
    }
    return list;
  }, [expedicoes.data, status, centro, filtros, pedidos.data, clientes.data]);

  const totals = useMemo(() => {
    const list = expedicoes.data ?? [];
    return {
      pendentes: list.filter((r) => r["status"] === "pendente").length,
      rota: list.filter((r) => r["status"] === "em_rota").length,
      entregues: list.filter((r) => r["status"] === "entregue").length,
    };
  }, [expedicoes.data]);

  const avancar = useMutation({
    mutationFn: async ({ id, novo }: { id: unknown; novo: string }) => {
      const { error } = await client!.rpc("avancar_expedicao", {
        _id: id,
        _status: novo,
        _data: new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Expedição atualizada");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("atualizar_dados_expedicao", {
        _id: editing!["id"] as string,
        _transportadora_id: form["transportadora_id"] || null,
        _motorista: form["motorista"] || null,
        _placa: form["placa"] || null,
        _previsao_entrega: form["previsao_entrega"] || null,
        _volumes: Number(form["volumes"] || 1),
        _peso_kg: Number(form["peso_kg"] || 0),
        _rota_id: form["rota_id"] || null,
        _romaneio: form["romaneio"] || null,
        _observacoes: form["observacoes"] || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dados de transporte salvos");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["expedicoes", centro] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transportadoraLabel = (id: unknown) =>
    String(transportadoras.data?.find((t) => t["id"] === id)?.["razao_social"] ?? "—");

  function openEdit(r: Row) {
    setEditing(r);
    setForm({
      transportadora_id: String(r["transportadora_id"] ?? ""),
      motorista: String(r["motorista"] ?? ""),
      placa: String(r["placa"] ?? ""),
      previsao_entrega: String(r["previsao_entrega"] ?? ""),
      volumes: String(r["volumes"] ?? 1),
      peso_kg: String(r["peso_kg"] ?? 0),
      rota_id: String(r["rota_id"] ?? ""),
      observacoes: String(r["observacoes"] ?? ""),
    });
  }

  return (
    <ErpLayout
      title="Expedição / entregas"
      description="Cada pedido confirmado gera um romaneio: separação, despacho e confirmação de entrega."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-4">
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Busca (nº pedido/cliente)"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Rota"
            value={filtros["rota"] ?? ""}
            onChange={(v) => setF("rota", v)}
            options={(rotas.data ?? []).map((r) => ({
              value: String(r["id"]),
              label: String(r["nome"]),
            }))}
          />
          <FilterText
            label="Previsão de"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Previsão até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
        </FilterBar>

        <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
          {[
            { label: "Aguardando separação", value: String(totals.pendentes) },
            { label: "Em rota", value: String(totals.rota) },
            { label: "Entregues", value: String(totals.entregues) },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="truncate text-sm font-semibold">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="no-print flex flex-wrap gap-1.5">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-2.5 py-1 text-[11px] capitalize transition-colors ${
                status === s
                  ? "bg-primary text-primary-foreground"
                  : s === "todos"
                    ? "bg-muted text-muted-foreground hover:bg-accent"
                    : `${statusTone(s)} hover:opacity-80`
              }`}
            >
              {s.replace(/_/g, " ")} (
              {s === "todos"
                ? (expedicoes.data ?? []).length
                : (expedicoes.data ?? []).filter((r) => r["status"] === s).length}
              )
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{rows.length} romaneio(s) no filtro</p>

        <div className="print-area overflow-x-auto rounded-lg border border-border bg-card">
          {expedicoes.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : expedicoes.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(expedicoes.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase4_logistica_relatorios.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma expedição neste filtro. Confirme um pedido para gerar o romaneio.
            </p>
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Romaneio</th>
                  <th className="px-4 py-2 text-left font-medium">Pedido</th>
                  <th className="px-4 py-2 text-left font-medium">Transportadora</th>
                  <th className="px-4 py-2 text-left font-medium">Previsão</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="no-print px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const ativo = selected === String(r["id"]);
                  return (
                    <tr
                      key={String(r["id"])}
                      onClick={() => setSelected(String(r["id"]))}
                      className={`cursor-pointer border-l-2 transition-colors ${
                        ativo
                          ? "border-l-primary bg-accent"
                          : "border-l-transparent hover:border-l-primary/40 hover:bg-accent/50"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-semibold">#{String(r["numero"])}</td>
                      <td className="max-w-[320px] truncate px-4 py-2.5">
                        {pedidoLabel(r["pedido_id"])}
                      </td>
                      <td className="px-4 py-2.5">{transportadoraLabel(r["transportadora_id"])}</td>
                      <td className="px-4 py-2.5">
                        {r["previsao_entrega"]
                          ? new Date(
                              `${String(r["previsao_entrega"]).slice(0, 10)}T00:00:00`,
                            ).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone(String(r["status"]))}`}
                        >
                          {String(r["status"]).replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="no-print space-x-2 px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canShip}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(r);
                          }}
                        >
                          Transporte
                        </Button>
                        {(next[String(r["status"])] ?? []).map((a) => (
                          <Button
                            key={a.status}
                            size="sm"
                            variant={a.status === "cancelada" ? "outline" : "default"}
                            disabled={!canShip || avancar.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              avancar.mutate({ id: r["id"], novo: a.status });
                            }}
                          >
                            {a.label}
                          </Button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>


        {!canShip ? (
          <p className="text-xs text-muted-foreground">
            Somente perfis <strong>expedição</strong>, <strong>estoque</strong>,{" "}
            <strong>gestor</strong> ou <strong>admin</strong> podem movimentar expedições.
          </p>
        ) : null}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dados de transporte</DialogTitle>
            <DialogDescription>
              Romaneio #{String(editing?.["numero"] ?? "")} — transportadora, motorista e volumes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Transportadora</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form["transportadora_id"] ?? ""}
                onChange={(e) => setForm({ ...form, transportadora_id: e.target.value })}
              >
                <option value="">—</option>
                {(transportadoras.data ?? []).map((t) => (
                  <option key={String(t["id"])} value={String(t["id"])}>
                    {String(t["razao_social"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Rota</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form["rota_id"] ?? ""}
                onChange={(e) => setForm({ ...form, rota_id: e.target.value })}
              >
                <option value="">—</option>
                {(rotas.data ?? []).map((r) => (
                  <option key={String(r["id"])} value={String(r["id"])}>
                    {String(r["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Nº do romaneio</Label>
              <Input
                value={form["romaneio"] ?? ""}
                onChange={(e) => setForm({ ...form, romaneio: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Motorista</Label>
              <Input
                value={form["motorista"] ?? ""}
                onChange={(e) => setForm({ ...form, motorista: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Placa</Label>
              <Input
                value={form["placa"] ?? ""}
                onChange={(e) => setForm({ ...form, placa: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Previsão de entrega</Label>
              <Input
                type="date"
                value={form["previsao_entrega"] ?? ""}
                onChange={(e) => setForm({ ...form, previsao_entrega: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Volumes</Label>
              <Input
                type="number"
                value={form["volumes"] ?? ""}
                onChange={(e) => setForm({ ...form, volumes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Peso (kg)</Label>
              <Input
                type="number"
                step="0.001"
                value={form["peso_kg"] ?? ""}
                onChange={(e) => setForm({ ...form, peso_kg: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={form["observacoes"] ?? ""}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

