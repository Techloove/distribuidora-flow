import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
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

export const Route = createFileRoute("/_app/tabelas-preco")({
  head: () => ({
    meta: [
      { title: "Tabelas de preço — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Política comercial com tabelas de preço por cliente, UF e vigência, com desconto máximo por produto.",
      },
      { property: "og:title", content: "Tabelas de preço — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Defina preços vigentes por cliente, estado e período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TabelasPrecoPage,
});

type Row = Record<string, unknown>;

function TabelasPrecoPage() {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [head, setHead] = useState<Record<string, string>>({
    nome: "",
    cliente_id: "",
    uf: "",
    vigencia_inicio: new Date().toISOString().slice(0, 10),
    vigencia_fim: "",
    prioridade: "0",
  });
  const [item, setItem] = useState({ produto_id: "", preco: "0", desconto_maximo: "0" });
  const [editando, setEditando] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [buscaItem, setBuscaItem] = useState("");
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const tabelas = useQuery({
    queryKey: ["tabelas_preco"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("tabelas_preco")
        .select("*")
        .order("created_at", { ascending: false });
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

  const produtos = useQuery({
    queryKey: ["produtos", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("produtos")
        .select("id, codigo, descricao, preco_venda")
        .order("descricao");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const itens = useQuery({
    queryKey: ["tabela_preco_itens", selected],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from("tabela_preco_itens")
        .select("*")
        .eq("tabela_id", selected!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const promocoes = useQuery({
    queryKey: ["vw_promocoes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_promocoes")
        .select("*")
        .order("produto_descricao");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const [soVigentes, setSoVigentes] = useState(true);
  const promocoesLista = useMemo(() => {
    let list = promocoes.data ?? [];
    if (soVigentes) list = list.filter((p) => Boolean(p["vigente"]));
    const termo = (filtros["produto"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (p) =>
          String(p["produto_descricao"] ?? "").toLowerCase().includes(termo) ||
          String(p["produto_codigo"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [promocoes.data, soVigentes, filtros]);

  const fmtDate = (v: unknown) => {
    const s = String(v ?? "");
    return s && s !== "null"
      ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR")
      : "sem limite";
  };

  const tabelasFiltradas = useMemo(() => {
    let list = tabelas.data ?? [];
    const termo = (filtros["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((t) => String(t["nome"] ?? "").toLowerCase().includes(termo));
    }
    if (filtros["ativo"]) {
      list = list.filter((t) => String(Boolean(t["ativo"])) === filtros["ativo"]);
    }
    return list;
  }, [tabelas.data, filtros]);

  const hoje = new Date().toISOString().slice(0, 10);
  const resumo = useMemo(() => {
    const lista = tabelas.data ?? [];
    const ativas = lista.filter(
      (t) =>
        Boolean(t["ativo"]) &&
        String(t["vigencia_inicio"] ?? "") <= hoje &&
        (!t["vigencia_fim"] || String(t["vigencia_fim"]) >= hoje),
    ).length;
    const agendadas = lista.filter(
      (t) => Boolean(t["ativo"]) && String(t["vigencia_inicio"] ?? "") > hoje,
    ).length;
    const descontos = (promocoes.data ?? [])
      .map((p) => Number(p["variacao_percentual"] ?? 0))
      .filter((valor) => valor < 0);
    const descontoMedio = descontos.length
      ? Math.abs(descontos.reduce((soma, valor) => soma + valor, 0) / descontos.length)
      : 0;
    return { ativas, agendadas, produtos: promocoesLista.length, descontoMedio };
  }, [tabelas.data, promocoes.data, promocoesLista.length, hoje]);

  const tabelaSelecionada = useMemo(
    () => (tabelas.data ?? []).find((t) => String(t["id"]) === selected),
    [tabelas.data, selected],
  );

  const itensFiltrados = useMemo(() => {
    const termo = buscaItem.trim().toLowerCase();
    if (!termo) return itens.data ?? [];
    return (itens.data ?? []).filter((registro) =>
      nomeProduto(registro["produto_id"]).toLowerCase().includes(termo),
    );
  }, [itens.data, buscaItem, produtos.data]);

  const statusTabela = (tabela: Row) => {
    if (!tabela["ativo"]) return { label: "Inativa", tone: "muted" } as const;
    if (String(tabela["vigencia_inicio"] ?? "") > hoje)
      return { label: "Agendada", tone: "scheduled" } as const;
    if (tabela["vigencia_fim"] && String(tabela["vigencia_fim"]) < hoje)
      return { label: "Encerrada", tone: "muted" } as const;
    return { label: "Ativa", tone: "active" } as const;
  };

  const nomeProduto = (id: unknown) => {
    const p = produtos.data?.find((x) => x["id"] === id);
    return p ? `${String(p["codigo"] ?? "")} ${String(p["descricao"])}`.trim() : "—";
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!head["nome"]!.trim()) throw new Error("Informe o nome da promoção");
      const payload = {
        nome: head["nome"]!.trim(),
        cliente_id: head["cliente_id"]! || null,
        uf: head["uf"]!.trim().toUpperCase() || null,
        vigencia_inicio: head["vigencia_inicio"]! || new Date().toISOString().slice(0, 10),
        vigencia_fim: head["vigencia_fim"]! || null,
        prioridade: Number(head["prioridade"]! || 0),
      };
      if (editando) {
        const { error } = await client!
          .from("tabelas_preco")
          .update(payload)
          .eq("id", editando);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await client!.from("tabelas_preco").insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(editando ? "Promoção atualizada" : "Promoção criada");
      setEditando(null);
      setHead({
        nome: "",
        cliente_id: "",
        uf: "",
        vigencia_inicio: new Date().toISOString().slice(0, 10),
        vigencia_fim: "",
        prioridade: "0",
      });
      queryClient.invalidateQueries({ queryKey: ["tabelas_preco"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await client!
        .from("tabelas_preco")
        .update({ ativo: !row["ativo"] })
        .eq("id", row["id"] as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tabelas_preco"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione uma tabela");
      if (!item.produto_id) throw new Error("Selecione o produto");
      const { error } = await client!.from("tabela_preco_itens").upsert(
        {
          tabela_id: selected,
          produto_id: item.produto_id,
          preco: Number(item.preco || 0),
          desconto_maximo: Number(item.desconto_maximo || 0),
        },
        { onConflict: "tabela_id,produto_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Preço salvo");
      setItem({ produto_id: "", preco: "0", desconto_maximo: "0" });
      queryClient.invalidateQueries({ queryKey: ["tabela_preco_itens", selected] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from("tabela_preco_itens").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tabela_preco_itens", selected] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ErpLayout
      title="Promoções"
      description="Planeje campanhas, defina preços especiais e acompanhe tudo em um só lugar."
      actions={
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="font-promo-body space-y-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo das promoções">
          {[
            { label: "Promoções ativas", value: resumo.ativas, icon: CheckCircle2, tone: "text-chart-2 bg-chart-2/10" },
            { label: "Agendadas", value: resumo.agendadas, icon: Clock3, tone: "text-primary bg-primary/10" },
            { label: "Produtos em oferta", value: resumo.produtos, icon: Package, tone: "text-chart-4 bg-chart-4/10" },
            { label: "Desconto médio", value: `${resumo.descontoMedio.toFixed(1)}%`, icon: BadgePercent, tone: "text-destructive bg-destructive/10" },
          ].map((dado) => (
            <div key={dado.label} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-md ${dado.tone}`}>
                <dado.icon className="size-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{dado.label}</p>
                <p className="font-promo-display text-2xl font-semibold text-foreground">{dado.value}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-promo-display text-base font-semibold">Campanhas comerciais</h2>
              <p className="text-xs text-muted-foreground">Selecione uma promoção para ajustar seus produtos e preços.</p>
            </div>
            <div className="no-print flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="relative min-w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Buscar promoção"
                  className="pl-9"
                  value={filtros["busca"] ?? ""}
                  onChange={(e) => setF("busca", e.target.value)}
                  placeholder="Buscar promoção..."
                />
              </div>
              <select
                aria-label="Filtrar por status"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={filtros["ativo"] ?? ""}
                onChange={(e) => setF("ativo", e.target.value)}
              >
                <option value="">Todos os status</option>
                <option value="true">Ativas</option>
                <option value="false">Inativas</option>
              </select>
              {canManage ? (
                <Button
                  onClick={() => {
                    setSelected(null);
                    setEditando(null);
                    setHead({
                      nome: "",
                      cliente_id: "",
                      uf: "",
                      vigencia_inicio: new Date().toISOString().slice(0, 10),
                      vigencia_fim: "",
                      prioridade: "0",
                    });
                  }}
                >
                  <Plus className="size-4" /> Nova promoção
                </Button>
              ) : null}
            </div>
          </div>

          {tabelas.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando promoções...
            </div>
          ) : tabelas.isError ? (
            <p className="p-6 text-sm text-destructive">{(tabelas.error as Error).message}</p>
          ) : tabelasFiltradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma promoção encontrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Promoção</TableHead>
                    <TableHead>Aplicação</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead className="text-center">Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tabelasFiltradas.map((t) => {
                    const status = statusTabela(t);
                    const estaSelecionada = selected === String(t["id"]);
                    return (
                      <TableRow
                        key={String(t["id"])}
                        onClick={() => setSelected(String(t["id"]))}
                        className={`cursor-pointer transition-colors ${estaSelecionada ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : "hover:bg-muted/50"}`}
                      >
                        <TableCell>
                          <div className="font-medium text-foreground">{String(t["nome"])}</div>
                          <div className="text-xs text-muted-foreground">{(itens.data ?? []).length && estaSelecionada ? `${itens.data?.length} produtos nesta tabela` : "Clique para gerenciar"}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {t["cliente_id"]
                            ? String(clientes.data?.find((c) => c["id"] === t["cliente_id"])?.["razao_social"] ?? "Cliente específico")
                            : t["uf"]
                              ? `Estado: ${String(t["uf"])}`
                              : "Todos os clientes"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm"><CalendarDays className="size-4 text-muted-foreground" />{fmtDate(t["vigencia_inicio"])} — {fmtDate(t["vigencia_fim"])}</div>
                        </TableCell>
                        <TableCell className="text-center font-medium">{String(t["prioridade"])}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone === "active" ? "bg-chart-2/10 text-chart-2" : status.tone === "scheduled" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                            <span className={`size-1.5 rounded-full ${status.tone === "active" ? "bg-chart-2" : status.tone === "scheduled" ? "bg-primary" : "bg-muted-foreground"}`} />
                            {status.label}
                          </span>
                        </TableCell>
                        <TableCell className="no-print text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Editar promoção"
                              disabled={!canManage}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(String(t["id"]));
                                setEditando(String(t["id"]));
                                setHead({
                                  nome: String(t["nome"] ?? ""), cliente_id: String(t["cliente_id"] ?? ""),
                                  uf: String(t["uf"] ?? ""), vigencia_inicio: String(t["vigencia_inicio"] ?? ""),
                                  vigencia_fim: String(t["vigencia_fim"] ?? ""), prioridade: String(t["prioridade"] ?? 0),
                                });
                              }}
                            ><Pencil className="size-4" /></Button>
                            <Button size="sm" variant="outline" disabled={!canManage} onClick={(e) => { e.stopPropagation(); toggleAtivo.mutate(t); }}>
                              {t["ativo"] ? "Pausar" : "Ativar"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-promo-display text-xl font-semibold">
                  {tabelaSelecionada ? String(tabelaSelecionada["nome"]) : editando ? "Editar promoção" : "Nova promoção"}
                </h2>
                {tabelaSelecionada ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTabela(tabelaSelecionada).tone === "active" ? "bg-chart-2/10 text-chart-2" : "bg-muted text-muted-foreground"}`}>
                    {statusTabela(tabelaSelecionada).label}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {tabelaSelecionada ? "Revise as regras e atualize os produtos desta promoção." : "Preencha as regras para iniciar uma nova campanha."}
              </p>
            </div>
            {tabelaSelecionada && canManage && !editando ? (
              <Button variant="outline" onClick={() => {
                setEditando(String(tabelaSelecionada["id"]));
                setHead({ nome: String(tabelaSelecionada["nome"] ?? ""), cliente_id: String(tabelaSelecionada["cliente_id"] ?? ""), uf: String(tabelaSelecionada["uf"] ?? ""), vigencia_inicio: String(tabelaSelecionada["vigencia_inicio"] ?? ""), vigencia_fim: String(tabelaSelecionada["vigencia_fim"] ?? ""), prioridade: String(tabelaSelecionada["prioridade"] ?? 0) });
              }}><Pencil className="size-4" /> Editar regras</Button>
            ) : null}
          </div>

          <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="border-b border-border bg-muted/30 p-5 lg:border-b-0 lg:border-r">
              <h3 className="mb-4 font-promo-display text-xs font-semibold uppercase text-muted-foreground">Configuração da campanha</h3>
              {canManage && (!tabelaSelecionada || editando) ? (
                <div className="space-y-4">
                  <div><Label>Nome da promoção</Label><Input className="mt-1" value={head["nome"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Semana do Cimento" /></div>
                  <div><Label>Cliente</Label><select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={head["cliente_id"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, cliente_id: e.target.value }))}><option value="">Todos os clientes</option>{(clientes.data ?? []).map((c) => <option key={String(c["id"])} value={String(c["id"])}>{String(c["razao_social"])}</option>)}</select></div>
                  <div><Label>UF</Label><Input className="mt-1" maxLength={2} value={head["uf"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, uf: e.target.value }))} placeholder="Todos os estados" /></div>
                  <div className="grid grid-cols-2 gap-2"><div><Label>Início</Label><Input className="mt-1" type="date" value={head["vigencia_inicio"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, vigencia_inicio: e.target.value }))} /></div><div><Label>Fim</Label><Input className="mt-1" type="date" value={head["vigencia_fim"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, vigencia_fim: e.target.value }))} /></div></div>
                  <div><Label>Prioridade</Label><Input className="mt-1" type="number" value={head["prioridade"] ?? ""} onChange={(e) => setHead((f) => ({ ...f, prioridade: e.target.value }))} /></div>
                  <Button className="w-full" disabled={criar.isPending} onClick={() => criar.mutate()}>{criar.isPending ? <Loader2 className="size-4 animate-spin" /> : editando ? <Pencil className="size-4" /> : <Plus className="size-4" />}{editando ? "Salvar alterações" : "Criar promoção"}</Button>
                  {editando ? <Button className="w-full" variant="ghost" onClick={() => setEditando(null)}>Descartar alterações</Button> : null}
                </div>
              ) : tabelaSelecionada ? (
                <dl className="space-y-4 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Aplicação</dt><dd className="mt-1 font-medium">{tabelaSelecionada["cliente_id"] ? String(clientes.data?.find((c) => c["id"] === tabelaSelecionada["cliente_id"])?.["razao_social"] ?? "Cliente específico") : tabelaSelecionada["uf"] ? `Estado: ${String(tabelaSelecionada["uf"])}` : "Todos os clientes"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Período de vigência</dt><dd className="mt-1 font-medium">{fmtDate(tabelaSelecionada["vigencia_inicio"])} — {fmtDate(tabelaSelecionada["vigencia_fim"])}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Prioridade comercial</dt><dd className="mt-1 font-medium">{String(tabelaSelecionada["prioridade"])}</dd></div>
                </dl>
              ) : <p className="text-sm text-muted-foreground">Crie uma promoção ou selecione uma campanha acima.</p>}
            </aside>

            <div className="min-w-0">
              {selected ? (
                <>
                  {canManage ? (
                    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(0,1.5fr)_minmax(8rem,.6fr)_minmax(8rem,.6fr)_auto] md:items-end">
                      <div><Label>Produto</Label><select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={item.produto_id} onChange={(e) => { const p = produtos.data?.find((x) => x["id"] === e.target.value); setItem((f) => ({ ...f, produto_id: e.target.value, preco: String(p?.["preco_venda"] ?? f.preco) })); }}><option value="">Selecione um produto...</option>{(produtos.data ?? []).map((p) => <option key={String(p["id"])} value={String(p["id"])}>{nomeProduto(p["id"])}</option>)}</select></div>
                      <div><Label>Preço promocional</Label><Input className="mt-1" type="number" step="0.01" value={item.preco} onChange={(e) => setItem((f) => ({ ...f, preco: e.target.value }))} /></div>
                      <div><Label>Desconto máx.</Label><Input className="mt-1" type="number" step="0.01" value={item.desconto_maximo} onChange={(e) => setItem((f) => ({ ...f, desconto_maximo: e.target.value }))} /></div>
                      <Button disabled={addItem.isPending} onClick={() => addItem.mutate()}><Plus className="size-4" /> Salvar preço</Button>
                    </div>
                  ) : null}
                  <div className="border-b border-border p-4"><div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Buscar produto na promoção" className="bg-muted/60 pl-9" value={buscaItem} onChange={(e) => setBuscaItem(e.target.value)} placeholder="Pesquisar produto por código ou nome..." /></div></div>
                  {itens.isLoading ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando produtos...</div> : itensFiltrados.length === 0 ? <div className="py-14 text-center"><Package className="mx-auto mb-3 size-8 text-muted-foreground/50" /><p className="text-sm font-medium">Nenhum produto nesta promoção</p><p className="mt-1 text-xs text-muted-foreground">Use o formulário acima para incluir o primeiro preço.</p></div> : (
                    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Preço normal</TableHead><TableHead className="text-right">Preço promocional</TableHead><TableHead className="text-right">Desconto</TableHead><TableHead className="no-print" /></TableRow></TableHeader><TableBody>{itensFiltrados.map((i) => { const produto = produtos.data?.find((p) => p["id"] === i["produto_id"]); const normal = Number(produto?.["preco_venda"] ?? 0); const promocional = Number(i["preco"] ?? 0); const desconto = normal > 0 ? Math.max(0, ((normal - promocional) / normal) * 100) : 0; return <TableRow key={String(i["id"])}><TableCell><div className="font-medium">{String(produto?.["descricao"] ?? "Produto")}</div><div className="font-mono text-xs text-muted-foreground">{String(produto?.["codigo"] ?? "—")}</div></TableCell><TableCell className="text-right text-muted-foreground">{brl(normal)}</TableCell><TableCell className="text-right font-semibold text-primary">{brl(promocional)}</TableCell><TableCell className="text-right"><span className="rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">-{desconto.toFixed(1)}%</span></TableCell><TableCell className="no-print text-right"><Button size="icon" variant="ghost" title="Editar preço" disabled={!canManage} onClick={() => setItem({ produto_id: String(i["produto_id"] ?? ""), preco: String(i["preco"] ?? 0), desconto_maximo: String(i["desconto_maximo"] ?? 0) })}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" title="Remover produto" disabled={!canManage} onClick={() => removeItem.mutate(String(i["id"]))}><Trash2 className="size-4" /></Button></TableCell></TableRow>; })}</TableBody></Table></div>
                  )}
                </>
              ) : <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><BadgePercent className="mb-3 size-10 text-primary/50" /><p className="font-promo-display font-semibold">Sua campanha começa pelas regras</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Depois de criar a promoção, selecione-a para incluir produtos e definir os preços especiais.</p></div>}
            </div>
          </div>
        </section>

        <section className="print-area overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="font-promo-display text-base font-semibold">Vitrine de produtos em promoção</h2><p className="text-xs text-muted-foreground">Confira rapidamente preços e datas de todas as ofertas.</p></div>
            <div className="no-print flex flex-col gap-2 sm:flex-row"><Input aria-label="Buscar produto em promoção" value={filtros["produto"] ?? ""} onChange={(e) => setF("produto", e.target.value)} placeholder="Código ou produto..." /><select aria-label="Filtrar vigência" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={soVigentes ? "vigentes" : "todas"} onChange={(e) => setSoVigentes(e.target.value !== "todas")}><option value="vigentes">Somente vigentes</option><option value="todas">Todas</option></select></div>
          </div>
          {promocoes.isLoading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando ofertas...</div> : promocoes.isError ? <p className="p-6 text-sm text-destructive">{(promocoes.error as Error).message}</p> : promocoesLista.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhum produto em promoção.</p> : (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Promoção</TableHead><TableHead className="text-right">Preço normal</TableHead><TableHead className="text-right">Preço promocional</TableHead><TableHead className="text-right">Economia</TableHead><TableHead>Data limite</TableHead></TableRow></TableHeader><TableBody>{promocoesLista.map((p) => { const variacao = Number(p["variacao_percentual"] ?? 0); return <TableRow key={String(p["item_id"])}><TableCell><div className="font-medium">{String(p["produto_descricao"])}</div><div className="font-mono text-xs text-muted-foreground">{String(p["produto_codigo"] ?? "—")}</div></TableCell><TableCell><div className="text-sm">{String(p["tabela_nome"])}</div>{!p["vigente"] ? <span className="text-xs text-muted-foreground">Fora de vigência</span> : null}</TableCell><TableCell className="text-right text-muted-foreground line-through">{brl(p["preco_normal"])}</TableCell><TableCell className="text-right font-semibold text-primary">{brl(p["preco_promocional"])}</TableCell><TableCell className="text-right"><span className="rounded-md bg-chart-2/10 px-2 py-1 text-xs font-semibold text-chart-2">{Math.abs(variacao).toFixed(2)}%</span></TableCell><TableCell className="text-sm">{fmtDate(p["vigencia_fim"])}</TableCell></TableRow>; })}</TableBody></Table></div>
          )}
        </section>
      </div>
    </ErpLayout>
  );
}
