import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, Loader2, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { brl } from "@/components/documento-page";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportarCsv } from "@/lib/exportar";
import { usePermissoesFin } from "@/lib/permissoes-financeiras";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/contas")({
  head: () => ({
    meta: [
      { title: "Caixa e bancos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Contas bancárias e caixas com saldo calculado pelas movimentações, extrato por conta e transferência entre contas.",
      },
      { property: "og:title", content: "Caixa e bancos — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Saldos auditáveis, extrato e transferências entre contas financeiras.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContasPage,
});

type Row = Record<string, unknown>;

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "nome", label: "Nome", span: 2, required: true, inTable: true },
  {
    name: "tipo",
    label: "Tipo",
    type: "select",
    inTable: true,
    options: [
      { value: "banco", label: "Banco" },
      { value: "caixa", label: "Caixa" },
      { value: "conta_corrente", label: "Conta corrente" },
      { value: "poupanca", label: "Conta poupança" },
      { value: "conta_pagamento", label: "Conta de pagamento" },
      { value: "outros", label: "Outros" },
    ],
  },
  { name: "banco", label: "Banco", inTable: true },
  { name: "agencia", label: "Agência" },
  { name: "conta", label: "Conta" },
  { name: "saldo_inicial", label: "Saldo inicial", type: "number", step: "0.01" },
  { name: "data_saldo_inicial", label: "Data do saldo inicial", type: "date" },
  {
    name: "centro_id",
    label: "Centro de custo",
    type: "ref",
    ref: { table: "centros", labelField: "nome" },
  },
  { name: "chave_pix", label: "Chave Pix Sicredi" },
  { name: "pix_beneficiario", label: "Beneficiário do Pix" },
  { name: "pix_cidade", label: "Cidade do beneficiário Pix" },
  { name: "observacoes", label: "Observações", span: 2 },
  { name: "ativo", label: "Ativa", type: "checkbox", inTable: true },
];

function ContasPage() {
  const { client } = useSupabase();
  const perm = usePermissoesFin();
  const queryClient = useQueryClient();
  const [transferir, setTransferir] = useState(false);
  const [extrato, setExtrato] = useState<Row | null>(null);
  const [form, setForm] = useState({
    origem: "",
    destino: "",
    valor: "",
    data: new Date().toISOString().slice(0, 10),
    historico: "",
  });

  const saldos = useQuery({
    queryKey: ["vw_conta_saldo"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_conta_saldo").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const lancamentos = useQuery({
    queryKey: ["vw_extrato_conta", extrato?.["conta_id"]],
    enabled: !!client && !!extrato,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_extrato_conta")
        .select("*")
        .eq("conta_id", String(extrato!["conta_id"]))
        .order("data", { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const transferencia = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("transferir_entre_contas", {
        _origem: form.origem,
        _destino: form.destino,
        _valor: Number(form.valor),
        _data: form.data,
        _historico: form.historico || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Transferência registrada");
      setTransferir(false);
      setForm((f) => ({ ...f, valor: "", historico: "" }));
      queryClient.invalidateQueries({ queryKey: ["vw_conta_saldo"] });
      queryClient.invalidateQueries({ queryKey: ["vw_extrato_conta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = (saldos.data ?? []).reduce((s, r) => s + Number(r["saldo_atual"] ?? 0), 0);
  const opcoes = (saldos.data ?? []).map((r) => ({
    value: String(r["conta_id"]),
    label: String(r["nome"]),
  }));

  return (
    <ErpLayout
      title="Caixa e bancos"
      description="Saldo de cada conta calculado a partir do saldo inicial e das movimentações financeiras, permitindo auditoria completa."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Saldo total</p>
            <p className="mt-2 text-2xl font-semibold">{brl(total)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Contas ativas</p>
            <p className="mt-2 text-2xl font-semibold">
              {(saldos.data ?? []).filter((r) => r["ativo"] !== false).length}
            </p>
          </article>
          <article className="flex flex-col justify-center gap-2 rounded-lg border border-border bg-card p-5">
            <Button
              size="sm"
              disabled={!perm.pode("transferir")}
              onClick={() => setTransferir(true)}
            >
              <ArrowLeftRight className="size-3.5" /> Transferir valor
            </Button>
            <p className="text-xs text-muted-foreground">
              Transferências movimentam saldos, mas não entram na DRE.
            </p>
          </article>
        </div>

        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Saldos por conta</h2>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                exportarCsv(
                  "saldos-contas",
                  [
                    { key: "nome", label: "Conta" },
                    { key: "tipo", label: "Tipo" },
                    { key: "saldo_inicial", label: "Saldo inicial" },
                    { key: "entradas", label: "Entradas" },
                    { key: "saidas", label: "Saídas" },
                    { key: "transferencias", label: "Transferências" },
                    { key: "saldo_atual", label: "Saldo atual" },
                  ],
                  saldos.data ?? [],
                )
              }
            >
              Exportar CSV
            </Button>
          </header>
          {saldos.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : saldos.isError ? (
            <p className="p-6 text-sm text-destructive">{(saldos.error as Error).message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Transferências</TableHead>
                  <TableHead className="text-right">Saldo atual</TableHead>
                  <TableHead className="text-right">Extrato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(saldos.data ?? []).map((r) => (
                  <TableRow key={String(r["conta_id"])}>
                    <TableCell>{String(r["nome"])}</TableCell>
                    <TableCell>{String(r["tipo"])}</TableCell>
                    <TableCell className="text-right">{brl(r["saldo_inicial"])}</TableCell>
                    <TableCell className="text-right">{brl(r["entradas"])}</TableCell>
                    <TableCell className="text-right">{brl(r["saidas"])}</TableCell>
                    <TableCell className="text-right">{brl(r["transferencias"])}</TableCell>
                    <TableCell className="text-right font-medium">
                      {brl(r["saldo_atual"])}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setExtrato(r)}>
                        <ScrollText className="size-3.5" /> Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Cadastro de contas financeiras</h2>
          <CrudPage
            table="contas_financeiras"
            fields={fields}
            orderBy="nome"
            emptyLabel="Nenhuma conta cadastrada."
            searchColumns={["codigo", "nome", "banco", "conta"]}
          />
        </section>
      </div>

      <Dialog open={transferir} onOpenChange={setTransferir}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir valor entre contas</DialogTitle>
            <DialogDescription>
              Não é considerada receita nem despesa: apenas movimenta o saldo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Conta de origem</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.origem}
                onChange={(e) => setForm((f) => ({ ...f, origem: e.target.value }))}
              >
                <option value="">Selecione</option>
                {opcoes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Conta de destino</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.destino}
                onChange={(e) => setForm((f) => ({ ...f, destino: e.target.value }))}
              >
                <option value="">Selecione</option>
                {opcoes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.data}
                onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Histórico</Label>
              <Input
                value={form.historico}
                onChange={(e) => setForm((f) => ({ ...f, historico: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferir(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => transferencia.mutate()}
              disabled={
                transferencia.isPending || !form.origem || !form.destino || Number(form.valor) <= 0
              }
            >
              {transferencia.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extrato} onOpenChange={(o) => !o && setExtrato(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Extrato — {String(extrato?.["nome"] ?? "")}</DialogTitle>
            <DialogDescription>
              Saldo inicial {brl(extrato?.["saldo_inicial"])} · saldo atual{" "}
              {brl(extrato?.["saldo_atual"])}
            </DialogDescription>
          </DialogHeader>
          {lancamentos.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : (lancamentos.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma movimentação nesta conta.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lancamentos.data ?? []).map((m) => (
                  <TableRow key={String(m["id"])}>
                    <TableCell>{String(m["data"])}</TableCell>
                    <TableCell>{String(m["descricao"] ?? "—")}</TableCell>
                    <TableCell>{String(m["origem"])}</TableCell>
                    <TableCell
                      className={`text-right ${
                        Number(m["valor_assinado"]) < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {brl(m["valor_assinado"])}
                    </TableCell>
                    <TableCell className="text-right">{brl(m["saldo_acumulado"])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
