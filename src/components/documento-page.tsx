import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { useCentro } from "@/lib/centro-store";
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

export function DocumentoPage({
  config,
  initialDocId = null,
}: {
  config: DocumentoConfig;
  initialDocId?: string | null;
}) {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(initialDocId);
  const [openNew, setOpenNew] = useState(false);
  const [header, setHeader] = useState<Record<string, string>>({});
  const [item, setItem] = useState({ ...emptyItem });
  const [promo, setPromo] = useState<{
    preco: number;
    nome: string;
    fim: string | null;
  } | null>(null);



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

  /** Filtros da listagem de documentos. */
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const docsFiltrados = useMemo(() => {
    let list = docs.data ?? [];
    const f = filtros;
    if (centro) list = list.filter((d) => !d["centro_id"] || d["centro_id"] === centro);
    if (f["status"]) list = list.filter((d) => String(d["status"]) === f["status"]);
    if (f["centro"]) list = list.filter((d) => String(d["centro_id"] ?? "") === f["centro"]);
    if (f["rota"]) list = list.filter((d) => String(d["rota_id"] ?? "") === f["rota"]);
    if (f["forma"])
      list = list.filter((d) => String(d["forma_pagamento_id"] ?? "") === f["forma"]);
    if (f["parceiro"])
      list = list.filter((d) => String(d[config.partnerKey] ?? "") === f["parceiro"]);
    if (f["de"]) list = list.filter((d) => String(d[config.dateField] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((d) => String(d[config.dateField] ?? "") <= f["ate"]!);
    if (f["min"]) list = list.filter((d) => Number(d["total_liquido"] ?? 0) >= Number(f["min"]));
    if (f["max"]) list = list.filter((d) => Number(d["total_liquido"] ?? 0) <= Number(f["max"]));
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((d) => {
        const parceiro = String(
          partners.data?.find((p) => p["id"] === d[config.partnerKey])?.["razao_social"] ?? "",
        ).toLowerCase();
        return (
          String(d["numero"] ?? "").includes(termo) ||
          parceiro.includes(termo) ||
          String(d["observacoes"] ?? "").toLowerCase().includes(termo)
        );
      });
    }
    return list;
  }, [docs.data, filtros, centro, partners.data, config.partnerKey, config.dateField]);

  const statusOptions = useMemo(() => {
    const set = new Set((docs.data ?? []).map((d) => String(d["status"])));
    return [...set].sort().map((s) => ({ value: s, label: s }));
  }, [docs.data]);

  const totalFiltrado = docsFiltrados.reduce(
    (s, d) => s + Number(d["total_liquido"] ?? 0),
    0,
  );

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

  /**
   * Preço do item: em pedidos vale o preço vigente da promoção (tabela de preço
   * dentro do período de vigência para o cliente/UF). Sem promoção vigente,
   * cai no preço de venda do produto.
   */
  async function pickProduto(id: string) {
    const p = produtos.data?.find((x) => x["id"] === id);
    const base = Number(
      (config.table === "pedidos" ? p?.["preco_venda"] : p?.["custo_medio"]) ?? 0,
    );
    setItem((s) => ({ ...s, produto_id: id, preco: String(base) }));
    setPromo(null);
    if (config.table !== "pedidos" || !id || !client) return;
    const { data, error } = await client.rpc("preco_produto_info", {
      _produto_id: id,
      _cliente_id: clienteFoco || null,
    });
    if (error) return;
    const info = (Array.isArray(data) ? data[0] : data) as
      | { preco: number; tabela_nome: string | null; vigencia_fim: string | null; promocao: boolean }
      | undefined;
    const vigente = Number(info?.preco ?? 0);
    if (!vigente) return;
    setItem((s) => (s.produto_id === id ? { ...s, preco: String(vigente) } : s));
    if (info?.promocao && vigente !== base) {
      setPromo({
        preco: vigente,
        nome: String(info.tabela_nome ?? "Promoção"),
        fim: info.vigencia_fim ?? null,
      });
    }
  }



  /** Ao escolher o cliente, já traz a rota cadastrada dele. */
  function pickPartner(id: string) {
    const p = partners.data?.find((x) => x["id"] === id);
    setHeader((h) => ({
      ...h,
      partner: id,
      ...(config.table === "pedidos" ? { rota: String(p?.["rota_id"] ?? "") } : {}),
    }));
  }

  const creditoPainel = (() => {
    if (config.partnerTable !== "clientes" || !clienteFoco) return null;
    const c = credito.data;
    const limite = Number(c?.["limite_credito"] ?? 0);
    const aberto = Number(c?.["em_aberto"] ?? 0);
    const disponivel = Number(c?.["limite_disponivel"] ?? limite - aberto);
    const vencido = Number(c?.["vencido"] ?? 0);
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Situação de crédito do cliente
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Limite</p>
            <p className="text-sm font-semibold">{brl(limite)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Em aberto</p>
            <p className="text-sm font-semibold">{brl(aberto)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Disponível</p>
            <p className={`text-sm font-semibold ${disponivel < 0 ? "text-destructive" : ""}`}>
              {brl(disponivel)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vencido</p>
            <p className={`text-sm font-semibold ${vencido > 0 ? "text-destructive" : ""}`}>
              {brl(vencido)}
            </p>
          </div>
        </div>
        {(titulosAbertos.data ?? []).length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {titulosAbertos.data!.map((t) => {
                  const saldo = Number(t["valor"] ?? 0) - Number(t["valor_pago"] ?? 0);
                  const venc = String(t["vencimento"] ?? "");
                  const atrasado = venc < new Date().toISOString().slice(0, 10);
                  return (
                    <TableRow key={String(t["id"])}>
                      <TableCell>
                        {String(t["documento"] ?? "—")}/{String(t["parcela"] ?? 1)}
                      </TableCell>
                      <TableCell className={atrasado ? "text-destructive" : ""}>
                        {venc ? new Date(`${venc}T00:00:00`).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right">{brl(saldo)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Nenhuma parcela em aberto para este cliente.
          </p>
        )}
      </div>
    );
  })();


  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");
  const produtoName = (id: unknown) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? "—");

  const statusTone = (s: string) => {
    const v = s.toLowerCase();
    if (v.startsWith("cancel")) return "bg-destructive/10 text-destructive";
    if (["faturado", "entregue", "liquidado", "recebido"].includes(v))
      return "bg-primary/15 text-primary";
    if (["aprovado", "confirmado"].includes(v)) return "bg-emerald-500/15 text-emerald-600";
    if (["separacao", "separado", "expedicao", "em_rota"].includes(v))
      return "bg-amber-500/15 text-amber-600";
    return "bg-secondary text-secondary-foreground";
  };
  const fmtDate = (v: unknown) => {
    const s = String(v ?? "");
    return s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—";
  };
  const ticket = docsFiltrados.length ? totalFiltrado / docsFiltrados.length : 0;
  const abertos = docsFiltrados.filter((d) =>
    ["rascunho", "digitacao", "aprovado", "confirmado", "separacao", "separado"].includes(
      String(d["status"]).toLowerCase(),
    ),
  ).length;
  const statusResumo = (() => {
    const m = new Map<string, number>();
    for (const d of docsFiltrados) {
      const k = String(d["status"]);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const listaVisivel = !selected && !openNew;

  return (
    <div className="space-y-6">
      <section className={`space-y-3 ${listaVisivel ? "" : "hidden"}`}>
        <div className="flex justify-end">
          <Button onClick={() => setOpenNew(true)} disabled={!canWrite}>
            <Plus className="size-4" /> Novo Pedido
          </Button>
        </div>



        <FilterBar onClear={() => setFiltros({})}>

          <FilterText
            label="Buscar"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder={`Nº, ${config.partnerLabel.toLowerCase()} ou observação`}
          />
          <FilterSelect
            label="Status"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={statusOptions}
          />
          <FilterSelect
            label={config.partnerLabel}
            value={filtros["parceiro"] ?? ""}
            onChange={(v) => setF("parceiro", v)}
            options={(partners.data ?? []).map((p) => ({
              value: String(p["id"]),
              label: String(p["razao_social"]),
            }))}
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={(centros.data ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["nome"]),
            }))}
          />
          {config.table === "pedidos" ? (
            <FilterSelect
              label="Rota"
              value={filtros["rota"] ?? ""}
              onChange={(v) => setF("rota", v)}
              options={(rotas.data ?? []).map((r) => ({
                value: String(r["id"]),
                label: String(r["nome"]),
              }))}
            />
          ) : null}
          <FilterSelect
            label="Forma de pagamento"
            value={filtros["forma"] ?? ""}
            onChange={(v) => setF("forma", v)}
            options={(formas.data ?? []).map((f) => ({
              value: String(f["id"]),
              label: String(f["nome"]),
            }))}
          />
          <FilterText
            label={`${config.dateLabel} de`}
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label={`${config.dateLabel} até`}
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
          <FilterText
            label="Valor mínimo"
            type="number"
            value={filtros["min"] ?? ""}
            onChange={(v) => setF("min", v)}
          />
          <FilterText
            label="Valor máximo"
            type="number"
            value={filtros["max"] ?? ""}
            onChange={(v) => setF("max", v)}
          />
        </FilterBar>

        <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
          {[
            { label: "Documentos", value: String(docsFiltrados.length) },
            { label: "Total", value: brl(totalFiltrado) },
            { label: "Ticket médio", value: brl(ticket) },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="truncate text-sm font-semibold">{k.value}</p>
            </div>
          ))}
        </div>

        {statusResumo.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setF("status", "")}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                !filtros["status"] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Todos ({docsFiltrados.length})
            </button>
            {statusResumo.map(([s, n]) => (
              <button
                key={s}
                onClick={() => setF("status", filtros["status"] === s ? "" : s)}
                className={`rounded-full px-2.5 py-1 text-[11px] capitalize transition-colors ${
                  filtros["status"] === s
                    ? "bg-primary text-primary-foreground"
                    : `${statusTone(s)} hover:opacity-80`
                }`}
              >
                {s.replace(/_/g, " ")} ({n})
              </button>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {abertos} em andamento · {docsFiltrados.length} no filtro
        </p>

        <div className="rounded-lg border border-border bg-card sm:overflow-x-auto">
          {docs.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : docs.isError ? (
            <p className="p-4 text-sm text-destructive">{(docs.error as Error).message}</p>
          ) : docsFiltrados.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhum documento neste filtro.</p>
              <Button variant="link" onClick={() => setFiltros({})} className="text-xs">
                Limpar filtros
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile: cartões */}
              <ul className="divide-y divide-border sm:hidden">
                {docsFiltrados.map((d) => {
                  const ativo = selected === d["id"];
                  return (
                    <li
                      key={String(d["id"])}
                      onClick={() => setSelected(String(d["id"]))}
                      className={`cursor-pointer border-l-2 p-3 transition-colors ${
                        ativo ? "border-l-primary bg-accent" : "border-l-transparent active:bg-accent/50"
                      }`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">#{String(d["numero"])}</p>
                          <p className="truncate text-sm">{partnerName(d[config.partnerKey])}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(d[config.dateField])}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">{brl(d["total_liquido"])}</p>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusTone(
                              String(d["status"]),
                            )}`}
                          >
                            {String(d["status"]).replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <table className="hidden w-full min-w-[720px] text-sm sm:table">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nº</th>
                    <th className="px-4 py-2 text-left font-medium">{config.partnerLabel}</th>
                    <th className="px-4 py-2 text-left font-medium">{config.dateLabel}</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docsFiltrados.map((d) => {
                    const ativo = selected === d["id"];
                    return (
                      <tr
                        key={String(d["id"])}
                        onClick={() => setSelected(String(d["id"]))}
                        className={`cursor-pointer border-l-2 transition-colors ${
                          ativo
                            ? "border-l-primary bg-accent"
                            : "border-l-transparent hover:border-l-primary/40 hover:bg-accent/50"
                        }`}
                      >
                        <td className="px-4 py-2.5 font-semibold">#{String(d["numero"])}</td>
                        <td className="max-w-[380px] truncate px-4 py-2.5">
                          {partnerName(d[config.partnerKey])}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {fmtDate(d[config.dateField])}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusTone(
                              String(d["status"]),
                            )}`}
                          >
                            {String(d["status"]).replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {brl(d["total_liquido"])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>



      </section>

      <section className="space-y-4">
        {!doc ? (
          listaVisivel ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Selecione um documento na lista acima ou crie um novo.
            </div>
          ) : null
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              ← Voltar à lista
            </Button>
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

            {creditoPainel}




            {["rascunho", "digitacao"].includes(String(doc["status"])) ? (
              <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(320px,4fr)_1fr_1fr_1fr_auto]">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  <ProdutoPicker
                    produtos={produtos.data ?? []}
                    value={item.produto_id}
                    onPick={(id) => pickProduto(id)}
                  />
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
                  {promo !== null ? (
                    <p className="text-xs font-medium text-primary">
                      {promo.nome}: {brl(promo.preco)}
                      <br />
                      {promo.fim
                        ? `Válida até ${fmtDate(promo.fim)}`
                        : "Sem data limite"}
                    </p>
                  ) : null}

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

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
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
                onChange={(e) => pickPartner(e.target.value)}
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
            {clienteFoco ? <div className="sm:col-span-2">{creditoPainel}</div> : null}

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

/** Busca de produto por código ou nome, com lista filtrada. */
function ProdutoPicker({
  produtos,
  value,
  onPick,
}: {
  produtos: Row[];
  value: string;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const sel = produtos.find((p) => String(p["id"]) === value);
  const rotulo = sel
    ? `${String(sel["codigo"] ?? "")} · ${String(sel["descricao"])}`
    : "";
  const termo = q.trim().toLowerCase();
  const lista = (
    termo
      ? produtos.filter(
          (p) =>
            String(p["descricao"]).toLowerCase().includes(termo) ||
            String(p["codigo"] ?? "").toLowerCase().includes(termo),
        )
      : produtos
  ).slice(0, 50);

  return (
    <div className="relative">
      <Input
        className="h-9"
        value={aberto ? q : rotulo}
        placeholder="Buscar por código ou nome"
        onFocus={() => {
          setQ("");
          setAberto(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setAberto(true);
        }}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
      />
      {aberto ? (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {lista.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            lista.map((p) => (
              <button
                key={String(p["id"])}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(String(p["id"]));
                  setAberto(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">
                  <span className="font-semibold">{String(p["codigo"] ?? "—")}</span> ·{" "}
                  {String(p["descricao"])}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  est. {String(p["estoque_atual"] ?? 0)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
