import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

export const Route = createFileRoute("/_app/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque e movimentações — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Saldos por produto, alertas de estoque mínimo e lançamento de entradas, saídas e ajustes de inventário.",
      },
      { property: "og:title", content: "Estoque e movimentações — ERP Distribuidora" },
      { property: "og:description", content: "Saldos, alertas e histórico de movimentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstoquePage,
});

type Row = Record<string, unknown>;

function EstoquePage() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    produto_id: "",
    tipo: "entrada",
    quantidade: "1",
    custo: "",
    observacao: "",
  });

  const canStock =
    roles.includes("admin") ||
    roles.includes("gestor") ||
    roles.includes("estoque") ||
    roles.includes("expedicao");

  const produtos = useQuery({
    queryKey: ["produtos", "estoque"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("produtos")
        .select("id, codigo, descricao, unidade, estoque_atual, estoque_minimo, custo_medio")
        .order("descricao");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const movimentos = useQuery({
    queryKey: ["estoque_movimentos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("estoque_movimentos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const lancar = useMutation({
    mutationFn: async () => {
      if (!form.produto_id) throw new Error("Selecione o produto");
      const qtd = Number(form.quantidade || 0);
      if (!qtd) throw new Error("Informe a quantidade");
      const { error } = await client!.from("estoque_movimentos").insert({
        produto_id: form.produto_id,
        tipo: form.tipo,
        quantidade: qtd,
        custo_unitario: form.custo === "" ? null : Number(form.custo),
        origem: "manual",
        observacao: form.observacao || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Movimento lançado");
      setForm({ produto_id: "", tipo: "entrada", quantidade: "1", custo: "", observacao: "" });
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const produtoName = (id: unknown) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? "—");

  return (
    <ErpLayout
      title="Estoque"
      description="Saldos por produto e histórico de movimentos gerados por pedidos, compras e ajustes manuais."
    >
      <div className="space-y-6">
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label>Produto</Label>
            <select
              value={form.produto_id}
              onChange={(e) => setForm((f) => ({ ...f, produto_id: e.target.value }))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {produtos.data?.map((p) => (
                <option key={String(p["id"])} value={String(p["id"])}>
                  {String(p["descricao"])}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
              <option value="ajuste">Ajuste (+/-)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantidade</Label>
            <Input
              type="number"
              step="0.001"
              value={form.quantidade}
              onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Custo unitário</Label>
            <Input
              type="number"
              step="0.01"
              value={form.custo}
              onChange={(e) => setForm((f) => ({ ...f, custo: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => lancar.mutate()} disabled={!canStock || lancar.isPending}>
              {lancar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Lançar
            </Button>
          </div>
        </div>
        {!canStock ? (
          <p className="text-xs text-muted-foreground">
            Somente perfis <strong>estoque</strong>, <strong>expedição</strong>,{" "}
            <strong>gestor</strong> ou <strong>admin</strong> podem lançar movimentos.
          </p>
        ) : null}

        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Saldos por produto</h2>
          <div className="rounded-lg border border-border bg-card">
            {produtos.isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : produtos.isError ? (
              <p className="p-6 text-sm text-destructive">{(produtos.error as Error).message}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Un.</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Mínimo</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produtos.data!.map((p) => {
                    const baixo = Number(p["estoque_atual"] ?? 0) <= Number(p["estoque_minimo"] ?? 0);
                    return (
                      <TableRow key={String(p["id"])}>
                        <TableCell>{String(p["descricao"])}</TableCell>
                        <TableCell>{String(p["unidade"] ?? "UN")}</TableCell>
                        <TableCell className="text-right">{String(p["estoque_atual"])}</TableCell>
                        <TableCell className="text-right">{String(p["estoque_minimo"])}</TableCell>
                        <TableCell className={baixo ? "text-destructive" : "text-muted-foreground"}>
                          {baixo ? "repor" : "ok"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Últimos movimentos</h2>
          <div className="rounded-lg border border-border bg-card">
            {movimentos.isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : movimentos.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(movimentos.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase2_vendas_estoque_financeiro.sql</code> no SQL Editor do
                  Supabase.
                </p>
              </div>
            ) : (movimentos.data ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum movimento registrado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimentos.data!.map((m) => (
                    <TableRow key={String(m["id"])}>
                      <TableCell>
                        {new Date(String(m["created_at"])).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>{produtoName(m["produto_id"])}</TableCell>
                      <TableCell>{String(m["tipo"])}</TableCell>
                      <TableCell className="text-right">{String(m["quantidade"])}</TableCell>
                      <TableCell>{String(m["origem"])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </ErpLayout>
  );
}
