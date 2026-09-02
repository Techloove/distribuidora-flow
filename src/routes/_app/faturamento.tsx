import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { filtrarCentro, useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/faturamento")({
  head: () => ({
    meta: [
      { title: "Faturamento — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Emissão de notas fiscais de saída a partir dos pedidos confirmados, com cancelamento e histórico auditado.",
      },
      { property: "og:title", content: "Faturamento — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Fature pedidos confirmados e acompanhe as notas de saída emitidas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaturamentoPage,
});

type Row = Record<string, unknown>;

function FaturamentoPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const canBill =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [nfNumero, setNfNumero] = useState<Record<string, string>>({});
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const pedidos = useQuery({
    queryKey: ["pedidos", "confirmados"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select("id, numero, cliente_id, data_pedido, total_liquido, centro_id")
        .eq("status", "confirmado")
        .order("numero", { ascending: false });
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
        .select("*")
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("clientes")
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const cliName = (id: unknown) =>
    String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—");

  const pedidosFiltrados = useMemo(() => {
    let list = filtrarCentro(pedidos.data ?? [], centro);
    const f = filtros;
    if (f["de"]) list = list.filter((p) => String(p["data_pedido"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((p) => String(p["data_pedido"] ?? "") <= f["ate"]!);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (p) =>
          String(p["numero"] ?? "").toLowerCase().includes(termo) ||
          cliName(p["cliente_id"]).toLowerCase().includes(termo),
      );
    }
    return list;
  }, [pedidos.data, centro, filtros, clientes.data]);

  const notasFiltradas = useMemo(() => {
    let list = filtrarCentro(notas.data ?? [], centro);
    const f = filtros;
    if (f["status"]) list = list.filter((n) => String(n["status"]) === f["status"]);
    if (f["de"]) list = list.filter((n) => String(n["data_emissao"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((n) => String(n["data_emissao"] ?? "") <= f["ate"]!);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (n) =>
          String(n["numero"] ?? "").toLowerCase().includes(termo) ||
          String(n["nf_numero"] ?? "").toLowerCase().includes(termo) ||
          cliName(n["cliente_id"]).toLowerCase().includes(termo),
      );
    }
    return list;
  }, [notas.data, centro, filtros, clientes.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pedidos"] });
    queryClient.invalidateQueries({ queryKey: ["notas_saida"] });
  };

  const faturar = useMutation({
    mutationFn: async (pedidoId: string) => {
      const { error } = await client!.rpc("faturar_pedido", {
        _pedido_id: pedidoId,
        _nf_numero: nfNumero[pedidoId] ?? null,
        _serie: "1",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Nota fiscal emitida");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("cancelar_nota_saida", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Nota cancelada e pedido reaberto");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalFaturado = (notas.data ?? [])
    .filter((n) => n["status"] === "emitida")
    .reduce((s, n) => s + Number(n["valor_total"] ?? 0), 0);

  return (
    <ErpLayout
      title="Faturamento"
      description="Pedidos confirmados geram nota de saída; o cancelamento devolve o pedido para confirmado."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-6">
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Busca (nº/cliente)"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Status"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={[
              { value: "emitida", label: "Emitida" },
              { value: "cancelada", label: "Cancelada" },
            ]}
          />
          <FilterText
            label="Data de"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Data até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
        </FilterBar>

        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total faturado (notas ativas)</p>
          <p className="mt-2 text-2xl font-semibold">{brl(totalFaturado)}</p>
        </article>

        <section className="print-area space-y-2">
          <h2 className="text-sm font-semibold">Pedidos aguardando faturamento</h2>
          <div className="rounded-lg border border-border bg-card">
            {pedidos.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : pedidos.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(pedidos.error as Error).message}
              </div>
            ) : pedidosFiltrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum pedido confirmado pendente de faturamento.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="no-print w-64">Nº da NF (opcional)</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidosFiltrados.map((p) => {
                    const id = String(p["id"]);
                    return (
                      <TableRow key={id}>
                        <TableCell>#{String(p["numero"])}</TableCell>
                        <TableCell>{cliName(p["cliente_id"])}</TableCell>
                        <TableCell>{String(p["data_pedido"] ?? "—")}</TableCell>
                        <TableCell className="text-right">{brl(p["total_liquido"])}</TableCell>
                        <TableCell className="no-print">
                          <Input
                            value={nfNumero[id] ?? ""}
                            onChange={(e) =>
                              setNfNumero((f) => ({ ...f, [id]: e.target.value }))
                            }
                            placeholder="000123"
                            disabled={!canBill}
                          />
                        </TableCell>
                        <TableCell className="no-print text-right">
                          <Button
                            size="sm"
                            disabled={!canBill || faturar.isPending}
                            onClick={() => faturar.mutate(id)}
                          >
                            Faturar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        <section className="print-area space-y-2">
          <h2 className="text-sm font-semibold">Notas fiscais de saída</h2>
          <div className="rounded-lg border border-border bg-card">
            {notas.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : notas.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(notas.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase6_faturamento_fluxo_caixa.sql</code> no SQL Editor do Supabase.
                </p>
              </div>
            ) : notasFiltradas.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma nota emitida ainda.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notasFiltradas.map((n) => (
                    <TableRow key={String(n["id"])}>
                      <TableCell>#{String(n["numero"])}</TableCell>
                      <TableCell>{String(n["nf_numero"] ?? "—")}</TableCell>
                      <TableCell>{cliName(n["cliente_id"])}</TableCell>
                      <TableCell>{String(n["data_emissao"] ?? "—")}</TableCell>
                      <TableCell className="text-right">{brl(n["valor_total"])}</TableCell>
                      <TableCell>{String(n["status"])}</TableCell>
                      <TableCell className="no-print text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canBill || n["status"] !== "emitida"}
                          onClick={() => cancelar.mutate(String(n["id"]))}
                        >
                          Cancelar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
    </ErpLayout>
  );
}
