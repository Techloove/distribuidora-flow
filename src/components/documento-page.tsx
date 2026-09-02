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

const emptyItem = {
  produto_id: "",
  quantidade: "1",
  preco: "0",
  desconto: "0",
  lote: "",
  validade: "",
};

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
    queryKey: [config.partnerTable, "options", config.table],
    enabled: !!client,
    queryFn: async () => {
      const columns =
        config.partnerTable === "clientes"
          ? "id, razao_social, rota_id, limite_credito"
          : "id, razao_social";
      const { data, error } = await client!
        .from(config.partnerTable)
        .select(columns)
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
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

  const centros = useQuery({
    queryKey: ["centros", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("centros")
        .select("id, codigo, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rotas = useQuery({
    queryKey: ["rotas", "options"],
    enabled: !!client && config.table === "pedidos",
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

  const formas = useQuery({
    queryKey: ["formas_pagamento", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("formas_pagamento")
        .select("id, nome, parcelas_padrao, dias_primeira_parcela, intervalo_dias")
        .eq("ativo", true)
        .order("nome");
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

  /** Cliente em foco: o do diálogo de novo pedido ou o do documento aberto. */
  const clienteFoco =
    config.partnerTable === "clientes"
      ? String((openNew ? header["partner"] : doc?.["cliente_id"]) ?? "")
      : "";

  const credito = useQuery({
    queryKey: ["vw_cliente_credito", clienteFoco],
    enabled: !!client && !!clienteFoco,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_cliente_credito")
        .select("*")
        .eq("cliente_id", clienteFoco)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Row | null;
    },
  });

  const titulosAbertos = useQuery({
    queryKey: ["contas_receber", "abertos", clienteFoco],
    enabled: !!client && !!clienteFoco,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_receber")
        .select("id, documento, parcela, valor, valor_pago, vencimento, status")
        .eq("cliente_id", clienteFoco)
        .neq("status", "pago")
        .neq("status", "cancelado")
        .order("vencimento")
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });


  const createDoc = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        [config.partnerKey]: header["partner"] || null,
        [config.dateField]: header["data"] || new Date().toISOString().slice(0, 10),
        centro_id: header["centro"] || null,
        observacoes: header["observacoes"] || null,
      };
      if (config.table === "compras") {
        payload["nf_numero"] = header["nf"] || null;
        payload["chave_acesso"] = header["chave"] || null;
        payload["valor_impostos"] = Number(header["impostos"] || 0);
      } else {
        payload["rota_id"] = header["rota"] || null;
        payload["previsao_entrega"] = header["previsao"] || null;
      }
      if (!payload[config.partnerKey]) throw new Error(`Selecione o ${config.partnerLabel}`);
      const { data, error } = await client!.from(config.table).insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
    onSuccess: (data) => {
      toast.success("Documento criado — lance os itens e depois a forma de pagamento");
      setOpenNew(false);
      setHeader({});
      setSelected(String(data["id"]));
      queryClient.invalidateQueries({ queryKey: [config.table] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [pagamento, setPagamento] = useState<Record<string, string>>({});

  const savePagamento = useMutation({
    mutationFn: async () => {
      if (!doc) throw new Error("Selecione um documento");
      const patch: Record<string, unknown> = {
        forma_pagamento_id: pagamento["forma"] ?? doc["forma_pagamento_id"] ?? null,
        frete_valor: Number(pagamento["frete"] ?? doc["frete_valor"] ?? 0),
        desconto_valor: Number(pagamento["desconto"] ?? doc["desconto_valor"] ?? 0),
      };
      if (config.table === "pedidos") {
        patch["comissao_percentual"] = Number(
          pagamento["comissao"] ?? doc["comissao_percentual"] ?? 0,
        );
      }
      const { error } = await client!.from(config.table).update(patch).eq("id", doc["id"]);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Forma de pagamento salva");
      setPagamento({});
      queryClient.invalidateQueries({ queryKey: [config.table] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickForma(id: string) {
    setPagamento((s) => ({ ...s, forma: id }));
  }

  const formaSelecionada =
    formas.data?.find(
      (f) => f["id"] === (pagamento["forma"] ?? doc?.["forma_pagamento_id"] ?? ""),
    ) ?? null;

  /** Prévia das parcelas conforme a forma de pagamento escolhida. */
  const previaParcelas = (() => {
    if (!doc || !formaSelecionada) return [];
    const total = Number(doc["total_liquido"] ?? 0);
    const qtd = Math.max(1, Number(formaSelecionada["parcelas_padrao"] ?? 1));
    const dias1 = Number(formaSelecionada["dias_primeira_parcela"] ?? 0);
    const intervalo = Number(formaSelecionada["intervalo_dias"] ?? 0);
    const base = new Date(String(doc[config.dateField] ?? new Date().toISOString().slice(0, 10)));
    const valor = Math.round((total / qtd) * 100) / 100;
    let saldo = total;
    const list: { parcela: number; valor: number; vencimento: string }[] = [];
    for (let n = 1; n <= qtd; n++) {
      const v = n === qtd ? Math.round(saldo * 100) / 100 : valor;
      saldo = Math.round((saldo - v) * 100) / 100;
      const d = new Date(base);
      d.setDate(d.getDate() + dias1 + (n - 1) * intervalo);
      list.push({ parcela: n, valor: v, vencimento: d.toLocaleDateString("pt-BR") });
    }
    return list;
  })();



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
      } else {
        payload["lote"] = item.lote || null;
        payload["validade"] = item.validade || null;
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

  const updateItem = useMutation({
    mutationFn: async (patch: { id: string; values: Record<string, number> }) => {
      const { error } = await client!
        .from(config.itemsTable)
        .update(patch.values)
        .eq("id", patch.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
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

  /** Fluxo de status do pedido: próximos passos permitidos. */
  const proximosStatus: Record<string, { status: string; label: string }[]> = {
    rascunho: [{ status: "aguardando_aprovacao", label: "Enviar para aprovação" }],
    digitacao: [{ status: "aguardando_aprovacao", label: "Enviar para aprovação" }],
    aguardando_aprovacao: [
      { status: "aprovado", label: "Aprovar" },
      { status: "recusado", label: "Recusar" },
    ],
    aprovado: [{ status: "separacao", label: "Enviar para separação" }],
    confirmado: [{ status: "separacao", label: "Enviar para separação" }],
    separacao: [{ status: "separado", label: "Marcar como separado" }],
    separado: [{ status: "em_rota", label: "Em rota de entrega" }],
    faturado: [{ status: "em_rota", label: "Em rota de entrega" }],
    em_rota: [
      { status: "entregue", label: "Entregue" },
      { status: "parcial", label: "Entrega parcial" },
      { status: "nao_entregue", label: "Não entregue" },
      { status: "devolvido", label: "Devolvido" },
    ],
  };

  const avancar = useMutation({
    mutationFn: async (novo: string) => {
      const { error } = await client!.rpc("avancar_pedido", {
        _pedido_id: selected,
        _novo_status: novo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Status do pedido atualizado");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Aprovação comercial automática (crédito, títulos, estoque, margem, desconto). */
  const validacao = useQuery({
    queryKey: ["validar_pedido", selected],
    enabled: !!client && !!selected && config.table === "pedidos",
    queryFn: async () => {
      const { data, error } = await client!.rpc("validar_pedido", { _pedido_id: selected });
      if (error) throw new Error(error.message);
      return (data ?? []) as { nivel: string; mensagem: string }[];
    },
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
          <Plus className="size-4" /> Novo Pedido
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
                    {String(doc["parcelas"])}x ·{" "}
                    {String(
                      formas.data?.find((f) => f["id"] === doc["forma_pagamento_id"])?.["nome"] ??
                        "sem forma de pagamento",
                    )}{" "}
                    ·{" "}
                    {String(
                      centros.data?.find((c) => c["id"] === doc["centro_id"])?.["nome"] ??
                        "sem centro",
                    )}

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
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => efetivar.mutate()}
                  disabled={
                    !["rascunho", "digitacao", "aprovado"].includes(String(doc["status"])) ||
                    efetivar.isPending ||
                    !canWrite
                  }
                >
                  {efetivar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {config.rpcLabel}
                </Button>
                {config.table === "pedidos"
                  ? (proximosStatus[String(doc["status"])] ?? []).map((s) => (
                      <Button
                        key={s.status}
                        variant="secondary"
                        onClick={() => avancar.mutate(s.status)}
                        disabled={avancar.isPending}
                      >
                        {s.label}
                      </Button>
                    ))
                  : null}
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

              {config.table === "pedidos" && (validacao.data ?? []).length > 0 ? (
                <div className="mt-4 space-y-1.5 rounded-md border border-border bg-background p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Aprovação comercial
                  </p>
                  {(validacao.data ?? []).map((v, i) => (
                    <p
                      key={i}
                      className={`text-sm ${
                        v.nivel === "bloqueio" ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {v.nivel === "bloqueio" ? "🔴 BLOQUEIO" : "🟡 Atenção"} — {v.mensagem}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>


            {["rascunho", "digitacao"].includes(String(doc["status"])) ? (
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
                {config.itemsTable === "pedido_itens" ? (
                  <div className="space-y-1.5">
                    <Label>Desc. %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.desconto}
                      onChange={(e) => setItem((s) => ({ ...s, desconto: e.target.value }))}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Lote</Label>
                      <Input
                        value={item.lote}
                        onChange={(e) => setItem((s) => ({ ...s, lote: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Validade</Label>
                      <Input
                        type="date"
                        value={item.validade}
                        onChange={(e) => setItem((s) => ({ ...s, validade: e.target.value }))}
                      />
                    </div>
                  </>
                )}
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
                        <TableCell className="text-right">
                          {["rascunho", "digitacao"].includes(String(doc["status"])) ? (
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              className="ml-auto h-8 w-24 text-right"
                              defaultValue={String(it["quantidade"] ?? 0)}
                              onBlur={(e) => {
                                const qtd = Number(e.target.value || 0);
                                if (qtd > 0 && qtd !== Number(it["quantidade"])) {
                                  updateItem.mutate({
                                    id: String(it["id"]),
                                    values: { quantidade: qtd },
                                  });
                                }
                              }}
                            />
                          ) : (
                            String(it["quantidade"])
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {["rascunho", "digitacao"].includes(String(doc["status"])) ? (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="ml-auto h-8 w-28 text-right"
                              defaultValue={String(it[config.itemPriceField] ?? 0)}
                              onBlur={(e) => {
                                const preco = Number(e.target.value || 0);
                                if (preco !== Number(it[config.itemPriceField])) {
                                  updateItem.mutate({
                                    id: String(it["id"]),
                                    values: { [config.itemPriceField]: preco },
                                  });
                                }
                              }}
                            />
                          ) : (
                            brl(it[config.itemPriceField])
                          )}
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

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">Forma de pagamento</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Define as parcelas e os vencimentos gerados no financeiro ao efetivar.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Forma</Label>
                  <select
                    value={pagamento["forma"] ?? String(doc["forma_pagamento_id"] ?? "")}
                    onChange={(e) => pickForma(e.target.value)}
                    disabled={doc["status"] !== "rascunho"}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {formas.data?.map((f) => (
                      <option key={String(f["id"])} value={String(f["id"])}>
                        {String(f["nome"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Frete (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={doc["status"] !== "rascunho"}
                    value={pagamento["frete"] ?? String(doc["frete_valor"] ?? 0)}
                    onChange={(e) => setPagamento((s) => ({ ...s, frete: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Desconto (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={doc["status"] !== "rascunho"}
                    value={pagamento["desconto"] ?? String(doc["desconto_valor"] ?? 0)}
                    onChange={(e) => setPagamento((s) => ({ ...s, desconto: e.target.value }))}
                  />
                </div>
                {config.table === "pedidos" ? (
                  <div className="space-y-1.5">
                    <Label>Comissão (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      disabled={doc["status"] !== "rascunho"}
                      value={pagamento["comissao"] ?? String(doc["comissao_percentual"] ?? 0)}
                      onChange={(e) => setPagamento((s) => ({ ...s, comissao: e.target.value }))}
                    />
                  </div>
                ) : null}
              </div>
              <Button
                className="mt-3"
                onClick={() => savePagamento.mutate()}
                disabled={doc["status"] !== "rascunho" || savePagamento.isPending || !canWrite}
              >
                {savePagamento.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Salvar pagamento
              </Button>

              {previaParcelas.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Parcela</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previaParcelas.map((p) => (
                        <TableRow key={p.parcela}>
                          <TableCell>
                            {String(doc?.["numero"] ?? "")}/{p.parcela}
                          </TableCell>

                          <TableCell>{p.vencimento}</TableCell>
                          <TableCell className="text-right">{brl(p.valor)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  Escolha a forma de pagamento para ver as parcelas e vencimentos.
                </p>
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
              1) {config.partnerLabel} e centro · 2) itens · 3) forma de pagamento.
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
              <Label>Centro</Label>
              <select
                value={header["centro"] ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, centro: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {centros.data?.map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
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
            {config.table === "compras" ? (
              <>
                <div className="space-y-1.5">
                  <Label>NF número</Label>
                  <Input
                    value={header["nf"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, nf: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Chave de acesso da NF-e</Label>
                  <Input
                    value={header["chave"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, chave: e.target.value }))}
                    placeholder="44 dígitos"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor de impostos (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={header["impostos"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, impostos: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Rota de entrega</Label>
                  <select
                    value={header["rota"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, rota: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {rotas.data?.map((r) => (
                      <option key={String(r["id"])} value={String(r["id"])}>
                        {String(r["nome"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Previsão de entrega</Label>
                  <Input
                    type="date"
                    value={header["previsao"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, previsao: e.target.value }))}
                  />
                </div>
              </>
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
