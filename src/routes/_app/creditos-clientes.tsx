import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CreditCard, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/creditos-clientes")({
  head: () => ({
    meta: [{ title: "Créditos de clientes — ERP Distribuidora" }],
  }),
  component: CreditosClientesPage,
});

type Row = Record<string, unknown>;

function CreditosClientesPage() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Row | null>(null);
  const [pedidoId, setPedidoId] = useState("");
  const [valor, setValor] = useState("");

  const canOperate = roles.some((r) => ["admin", "gestor", "financeiro", "comercial"].includes(r));

  const creditos = useQuery({
    queryKey: ["creditos_clientes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("creditos_clientes")
        .select("id, cliente_id, centro_id, devolucao_id, valor_original, valor_utilizado, saldo, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes", "creditos"],
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

  const centros = useQuery({
    queryKey: ["centros", "creditos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const pedidos = useQuery({
    queryKey: ["pedidos", "credito", selected?.["cliente_id"]],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select("id, numero, total_liquido, centro_id, status")
        .eq("cliente_id", selected!["cliente_id"] as string)
        .eq("status", "rascunho")
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const aplicacoes = useQuery({
    queryKey: ["credito_aplicacoes", selected?.["id"]],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from("creditos_clientes_aplicacoes")
        .select("id, pedido_id, valor, status, created_at, aplicado_em, revertido_em")
        .eq("credito_id", selected!["id"] as string)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clienteName = (id: unknown) =>
    String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—");
  const centroName = (id: unknown) =>
    String(centros.data?.find((c) => c["id"] === id)?.["nome"] ?? "—");

  const disponiveis = useMemo(
    () => (creditos.data ?? []).filter((c) => Number(c["saldo"] ?? 0) > 0 && c["status"] !== "cancelado"),
    [creditos.data],
  );

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione um crédito");
      if (!pedidoId) throw new Error("Selecione o pedido");
      const v = Number(valor || 0);
      if (v <= 0) throw new Error("Informe o valor do crédito");
      const { error } = await client!.rpc("aplicar_credito_cliente", {
        _credito_id: selected["id"],
        _pedido_id: pedidoId,
        _valor: v,
        _chave_idempotencia: crypto.randomUUID(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Crédito reservado no pedido");
      setValor("");
      setPedidoId("");
      queryClient.invalidateQueries({ queryKey: ["creditos_clientes"] });
      queryClient.invalidateQueries({ queryKey: ["credito_aplicacoes"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ErpLayout
      title="Créditos de clientes"
      description="Créditos gerados por devoluções e aplicados em novos pedidos sem gerar movimentação bancária."
      actions={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CreditCard className="size-4" />
          {disponiveis.length} crédito(s) com saldo
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-border bg-card">
          {creditos.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Centro</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Utilizado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(creditos.data ?? []).map((c) => (
                  <TableRow
                    key={String(c["id"])}
                    onClick={() => {
                      setSelected(c);
                      setPedidoId("");
                      setValor("");
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell>{clienteName(c["cliente_id"])}</TableCell>
                    <TableCell>{centroName(c["centro_id"])}</TableCell>
                    <TableCell>{c["devolucao_id"] ? "Devolução" : "Manual"}</TableCell>
                    <TableCell className="text-right">{brl(c["valor_original"])}</TableCell>
                    <TableCell className="text-right">{brl(c["valor_utilizado"])}</TableCell>
                    <TableCell className="text-right font-medium">{brl(c["saldo"])}</TableCell>
                    <TableCell>{String(c["status"])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Selecione um crédito para ver o histórico e aplicá-lo em um pedido.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-5">
                <p className="text-sm font-semibold">{clienteName(selected["cliente_id"])}</p>
                <p className="mt-1 text-xs text-muted-foreground">{centroName(selected["centro_id"])}</p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Original</p><p className="font-semibold">{brl(selected["valor_original"])}</p></div>
                  <div><p className="text-muted-foreground">Utilizado</p><p className="font-semibold">{brl(selected["valor_utilizado"])}</p></div>
                  <div><p className="text-muted-foreground">Saldo</p><p className="font-semibold">{brl(selected["saldo"])}</p></div>
                </div>
              </div>

              {canOperate && Number(selected["saldo"] ?? 0) > 0 && selected["status"] !== "cancelado" ? (
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <h2 className="text-sm font-semibold">Aplicar em pedido</h2>
                  <div>
                    <Label>Pedido em rascunho</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={pedidoId}
                      onChange={(e) => setPedidoId(e.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {(pedidos.data ?? []).map((p) => (
                        <option key={String(p["id"])} value={String(p["id"])}>
                          #{String(p["numero"])} — {brl(p["total_liquido"])}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Valor a aplicar</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={String(selected["saldo"] ?? 0)}
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                    />
                  </div>
                  <Button className="w-full" disabled={aplicar.isPending} onClick={() => aplicar.mutate()}>
                    {aplicar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Reservar crédito
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A reserva só vira desconto definitivo quando o pedido for confirmado.
                  </p>
                </div>
              ) : null}

              <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-3 text-sm font-semibold">Histórico de aplicações</h2>
                {(aplicacoes.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma aplicação.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(aplicacoes.data ?? []).map((a) => (
                        <TableRow key={String(a["id"])}>
                          <TableCell>{String(a["pedido_id"])}</TableCell>
                          <TableCell>{brl(a["valor"])}</TableCell>
                          <TableCell>{String(a["status"])}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </ErpLayout>
  );
}
