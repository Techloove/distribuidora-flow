import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
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
  const queryClient = useQueryClient();
  const canBill =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [nfNumero, setNfNumero] = useState<Record<string, string>>({});

  const pedidos = useQuery({
    queryKey: ["pedidos", "confirmados"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select("id, numero, cliente_id, data_pedido, total_liquido")
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
    >
      <div className="space-y-6">
        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total faturado (notas ativas)</p>
          <p className="mt-2 text-2xl font-semibold">{brl(totalFaturado)}</p>
        </article>

        <section className="space-y-2">
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
            ) : (pedidos.data ?? []).length === 0 ? (
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
                    <TableHead className="w-64">Nº da NF (opcional)</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.data!.map((p) => {
                    const id = String(p["id"]);
                    return (
                      <TableRow key={id}>
                        <TableCell>#{String(p["numero"])}</TableCell>
                        <TableCell>{cliName(p["cliente_id"])}</TableCell>
                        <TableCell>{String(p["data_pedido"] ?? "—")}</TableCell>
                        <TableCell className="text-right">{brl(p["total_liquido"])}</TableCell>
                        <TableCell>
                          <Input
                            value={nfNumero[id] ?? ""}
                            onChange={(e) =>
                              setNfNumero((f) => ({ ...f, [id]: e.target.value }))
                            }
                            placeholder="000123"
                            disabled={!canBill}
                          />
                        </TableCell>
                        <TableCell className="text-right">
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

        <section className="space-y-2">
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
            ) : (notas.data ?? []).length === 0 ? (
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
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notas.data!.map((n) => (
                    <TableRow key={String(n["id"])}>
                      <TableCell>#{String(n["numero"])}</TableCell>
                      <TableCell>{String(n["nf_numero"] ?? "—")}</TableCell>
                      <TableCell>{cliName(n["cliente_id"])}</TableCell>
                      <TableCell>{String(n["data_emissao"] ?? "—")}</TableCell>
                      <TableCell className="text-right">{brl(n["valor_total"])}</TableCell>
                      <TableCell>{String(n["status"])}</TableCell>
                      <TableCell className="text-right">
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
