import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { useSupabase } from "@/lib/supabase-provider";

export const brl = (value: unknown) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value ?? 0),
  );

type Row = Record<string, unknown>;

export type DocumentoConfig = {
  /** pedidos | compras */
  table: "pedidos" | "compras";
  itemsTable: "pedido_itens" | "compra_itens";
  parentKey: "pedido_id" | "compra_id";
  /** coluna de preço do item */
  itemPriceField: "preco_unitario" | "custo_unitario";
  itemPriceLabel: string;
  /** parceiro (cliente ou fornecedor) */
  partnerTable: "clientes" | "fornecedores";
  partnerKey: "cliente_id" | "fornecedor_id";
  partnerLabel: string;
  dateField: "data_pedido" | "data_entrada";
  dateLabel: string;
  /** ação de efetivação */
  rpc: "confirmar_pedido" | "receber_compra";
  rpcLabel: string;
  doneStatus: string;
};

const emptyItem = { produto_id: "", quantidade: "1", preco: "0", desconto: "0" };

export function DocumentoPage({ config }: { config: DocumentoConfig }) {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [header, setHeader] = useState<Record<string, string>>({});
  const [item, setItem] = useState({ ...emptyItem });

  const canWrite = roles.length > 0;

  const docs = useQuery({
    queryKey: [config.table],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from(config.table)
        .select("*")
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const partners = useQuery({
    queryKey: [config.partnerTable, "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from(config.partnerTable)
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const produtos = useQuery({
    queryKey: ["produtos", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("produtos")
        .select("id, codigo, descricao, preco_venda, custo_medio, estoque_atual")
        .order("descricao");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const itens = useQuery({
    queryKey: [config.itemsTable, selected],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from(config.itemsTable)
        .select("*")
        .eq(config.parentKey, selected!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const doc = docs.data?.find((d) => d["id"] === selected) ?? null;

  const createDoc = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        [config.partnerKey]: header["partner"] || null,
        [config.dateField]: header["data"] || new Date().toISOString().slice(0, 10),
        parcelas: Number(header["parcelas"] || 1),
        frete_valor: Number(header["frete"] || 0),
        desconto_valor: Number(header["desconto"] || 0),
        observacoes: header["observacoes"] || null,
      };
      if (config.table === "pedidos") {
        payload["comissao_percentual"] = Number(header["comissao"] || 0);
      } else {
        payload["nf_numero"] = header["nf"] || null;
      }
      if (!payload[config.partnerKey]) throw new Error(`Selecione o ${config.partnerLabel}`);
      const { data, error } = await client!.from(config.table).insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
    onSuccess: (data) => {
      toast.success("Documento criado");
      setOpenNew(false);
      setHeader({});
      setSelected(String(data["id"]));
      queryClient.invalidateQueries({ queryKey: [config.table] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione um documento");
      if (!item.produto_id) throw new Error("Selecione o produto");
      const payload: Record<string, unknown> = {
        [config.parentKey]: selected,
        produto_id: item.produto_id,
        quantidade: Number(item.quantidade || 0),
        [config.itemPriceField]: Number(item.preco || 0),
      };
      if (config.itemsTable === "pedido_itens") {
        payload["desconto_percentual"] = Number(item.desconto || 0);
      }
      const { error } = await client!.from(config.itemsTable).insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setItem({ ...emptyItem });
      queryClient.invalidateQueries({ queryKey: [config.itemsTable, selected] });
      queryClient.invalidateQueries({ queryKey: [config.table] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from(config.itemsTable).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.itemsTable, selected] });
      queryClient.invalidateQueries({ queryKey: [config.table] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const efetivar = useMutation({
    mutationFn: async () => {
      const args =
        config.rpc === "confirmar_pedido" ? { _pedido_id: selected } : { _compra_id: selected };
      const { error } = await client!.rpc(config.rpc, args);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`${config.rpcLabel} concluído — estoque e financeiro atualizados`);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("cancelar_pedido", { _pedido_id: selected });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!
          .from("compras")
          .update({ status: "cancelada" })
          .eq("id", selected);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Documento cancelado");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickProduto(id: string) {
    const p = produtos.data?.find((x) => x["id"] === id);
    const price = config.table === "pedidos" ? p?.["preco_venda"] : p?.["custo_medio"];
    setItem((s) => ({ ...s, produto_id: id, preco: String(Number(price ?? 0)) }));
  }

  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");
  const produtoName = (id: unknown) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? "—");

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <section className="space-y-3">
        <Button onClick={() => setOpenNew(true)} disabled={!canWrite} className="w-full">
          <Plus className="size-4" /> Novo documento
        </Button>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {docs.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : docs.isError ? (
            <p className="p-4 text-sm text-destructive">{(docs.error as Error).message}</p>
          ) : (docs.data ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum documento ainda.
            </p>
          ) : (
            docs.data!.map((d) => (
              <button
                key={String(d["id"])}
                onClick={() => setSelected(String(d["id"]))}
                className={`block w-full px-4 py-3 text-left text-sm transition-colors ${
                  selected === d["id"] ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">#{String(d["numero"])}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                    {String(d["status"])}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {partnerName(d[config.partnerKey])}
                </p>
                <p className="text-xs text-muted-foreground">{brl(d["total_liquido"])}</p>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        {!doc ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Selecione um documento à esquerda ou crie um novo.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {config.partnerLabel}: {partnerName(doc[config.partnerKey])}
                  </p>
                  <h2 className="text-lg font-semibold">
                    #{String(doc["numero"])} · {String(doc["status"])}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {config.dateLabel}: {String(doc[config.dateField] ?? "—")} ·{" "}
                    {String(doc["parcelas"])}x
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Itens {brl(doc["total_itens"])}</p>
                  <p className="text-xl font-semibold">{brl(doc["total_liquido"])}</p>
                  {config.table === "pedidos" ? (
                    <p className="text-xs text-muted-foreground">
                      Comissão {brl(doc["comissao_valor"])}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => efetivar.mutate()}
                  disabled={doc["status"] !== "rascunho" || efetivar.isPending || !canWrite}
                >
                  {efetivar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {config.rpcLabel}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => cancelar.mutate()}
                  disabled={
                    String(doc["status"]).startsWith("cancel") || cancelar.isPending || !canWrite
                  }
                >
                  Cancelar documento
                </Button>
              </div>
            </div>

            {doc["status"] === "rascunho" ? (
              <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  <select
                    value={item.produto_id}
                    onChange={(e) => pickProduto(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {produtos.data?.map((p) => (
                      <option key={String(p["id"])} value={String(p["id"])}>
                        {String(p["descricao"])} (est. {String(p["estoque_atual"])})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Qtd</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={item.quantidade}
                    onChange={(e) => setItem((s) => ({ ...s, quantidade: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{config.itemPriceLabel}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.preco}
                    onChange={(e) => setItem((s) => ({ ...s, preco: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Desc. %</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={config.itemsTable !== "pedido_itens"}
                    value={item.desconto}
                    onChange={(e) => setItem((s) => ({ ...s, desconto: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={() => addItem.mutate()} disabled={addItem.isPending}>
                    <Plus className="size-4" /> Item
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-card">
              {itens.isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
              ) : (itens.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum item lançado.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">{config.itemPriceLabel}</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.data!.map((it) => (
                      <TableRow key={String(it["id"])}>
                        <TableCell>{produtoName(it["produto_id"])}</TableCell>
                        <TableCell className="text-right">{String(it["quantidade"])}</TableCell>
                        <TableCell className="text-right">
                          {brl(it[config.itemPriceField])}
                        </TableCell>
                        <TableCell className="text-right">{brl(it["total"])}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={doc["status"] !== "rascunho"}
                            onClick={() => removeItem.mutate(String(it["id"]))}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </section>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo documento</DialogTitle>
            <DialogDescription>
              Informe os dados do cabeçalho; os itens são lançados em seguida.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{config.partnerLabel}</Label>
              <select
                value={header["partner"] ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, partner: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {partners.data?.map((p) => (
                  <option key={String(p["id"])} value={String(p["id"])}>
                    {String(p["razao_social"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{config.dateLabel}</Label>
              <Input
                type="date"
                value={header["data"] ?? new Date().toISOString().slice(0, 10)}
                onChange={(e) => setHeader((h) => ({ ...h, data: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Parcelas</Label>
              <Input
                type="number"
                min="1"
                value={header["parcelas"] ?? "1"}
                onChange={(e) => setHeader((h) => ({ ...h, parcelas: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Frete (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={header["frete"] ?? "0"}
                onChange={(e) => setHeader((h) => ({ ...h, frete: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Desconto (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={header["desconto"] ?? "0"}
                onChange={(e) => setHeader((h) => ({ ...h, desconto: e.target.value }))}
              />
            </div>
            {config.table === "pedidos" ? (
              <div className="space-y-1.5">
                <Label>Comissão (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={header["comissao"] ?? "0"}
                  onChange={(e) => setHeader((h) => ({ ...h, comissao: e.target.value }))}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>NF número</Label>
                <Input
                  value={header["nf"] ?? ""}
                  onChange={(e) => setHeader((h) => ({ ...h, nf: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={header["observacoes"] ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, observacoes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNew(false)}>
              Cancelar
            </Button>
            <Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending}>
              {createDoc.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
