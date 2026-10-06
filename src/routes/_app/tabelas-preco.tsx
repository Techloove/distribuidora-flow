import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BadgePercent,
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      { title: "Promoções — ERP Distribuidora" },
      {
        name: "description",
        content: "Crie campanhas e gerencie produtos e preços promocionais em um só lugar.",
      },
      { property: "og:title", content: "Promoções — ERP Distribuidora" },
      { property: "og:description", content: "Campanhas, produtos e preços especiais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TabelasPrecoPage,
});

type Campanha = {
  id: string;
  nome: string;
  ativo: boolean;
  cliente_id: string | null;
  uf: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  prioridade: number;
};
type Produto = { id: string; codigo: string; descricao: string; preco_venda: number };
type Item = {
  id: string;
  tabela_id: string;
  produto_id: string;
  preco: number;
  desconto_maximo: number;
};
type Oferta = {
  item_id: string;
  tabela_id: string;
  tabela_nome: string;
  produto_id: string;
  produto_codigo: string;
  produto_descricao: string;
  preco_normal: number;
  preco_promocional: number;
  vigente: boolean;
  vigencia_fim: string | null;
};
type Cliente = { id: string; razao_social: string };
type Status = "Ativa" | "Agendada" | "Pausada" | "Encerrada";
const buscar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const hojeLocal = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dataBR = (valor: string | null) =>
  valor ? valor.slice(0, 10).split("-").reverse().join("/") : "Sem data final";
const status = (c: Campanha, hoje: string): Status =>
  !c.ativo
    ? "Pausada"
    : c.vigencia_inicio > hoje
      ? "Agendada"
      : c.vigencia_fim && c.vigencia_fim < hoje
        ? "Encerrada"
        : "Ativa";
const corStatus = (valor: Status) =>
  valor === "Ativa"
    ? "bg-chart-2/10 text-chart-2"
    : valor === "Agendada"
      ? "bg-primary/10 text-primary"
      : "bg-muted text-muted-foreground";
const novoFormulario = () => ({
  nome: "",
  vigencia_inicio: hojeLocal(),
  vigencia_fim: "",
  cliente_id: "",
  uf: "",
  prioridade: "0",
});
const ufs =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const precoCalculado = (normal: number, percentual: number) =>
  Math.round(normal * (1 - percentual / 100) * 10000) / 10000;
const economia = (normal: number, preco: number) =>
  normal > 0 && preco < normal
    ? `${((1 - preco / normal) * 100).toFixed(1)}% de desconto`
    : preco > normal
      ? "Acima do preço normal"
      : "Preço normal";

// O limite padrão do Supabase não deve ocultar produtos em catálogos maiores.
async function listarPaginas<T>(
  consulta: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const registros: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    registros.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return registros;
  }
}

function TabelasPrecoPage() {
  const { client, canManage, user, loading } = useSupabase();
  const queryClient = useQueryClient();
  const hoje = hojeLocal();
  const [selected, setSelected] = useState<string | null>(null);
  const [buscaCampanha, setBuscaCampanha] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [buscaItem, setBuscaItem] = useState("");
  const [visao, setVisao] = useState("campanhas");
  const [dialogCampanha, setDialogCampanha] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [head, setHead] = useState(novoFormulario);
  const [dialogProdutos, setDialogProdutos] = useState(false);
  const [campanhaProdutos, setCampanhaProdutos] = useState<string | null>(null);
  const [editandoItem, setEditandoItem] = useState<Item | null>(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [modoPreco, setModoPreco] = useState("percentual");
  const [percentual, setPercentual] = useState("10");
  const [preco, setPreco] = useState("");
  const [descontoMaximo, setDescontoMaximo] = useState("0");
  const [remover, setRemover] = useState<Item | null>(null);
  const enabled = !!client && !!user && !loading;

  const tabelas = useQuery({
    queryKey: ["tabelas_preco", user?.id],
    enabled,
    queryFn: () =>
      listarPaginas<Campanha>((de, ate) =>
        client!
          .from("tabelas_preco")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, ate),
      ),
  });
  const clientes = useQuery({
    queryKey: ["clientes", "options", user?.id],
    enabled,
    queryFn: () =>
      listarPaginas<Cliente>((de, ate) =>
        client!
          .from("clientes")
          .select("id, razao_social")
          .order("razao_social")
          .order("id")
          .range(de, ate),
      ),
  });
  const produtos = useQuery({
    queryKey: ["produtos", "options", user?.id],
    enabled,
    queryFn: () =>
      listarPaginas<Produto>((de, ate) =>
        client!
          .from("produtos")
          .select("id, codigo, descricao, preco_venda")
          .order("descricao")
          .order("id")
          .range(de, ate),
      ),
  });
  const itens = useQuery({
    queryKey: ["tabela_preco_itens", selected, user?.id],
    enabled: enabled && !!selected,
    queryFn: () =>
      listarPaginas<Item>((de, ate) =>
        client!
          .from("tabela_preco_itens")
          .select("*")
          .eq("tabela_id", selected!)
          .order("created_at")
          .order("id")
          .range(de, ate),
      ),
  });
  const promocoes = useQuery({
    queryKey: ["vw_promocoes", user?.id],
    enabled,
    queryFn: () =>
      listarPaginas<Oferta>((de, ate) =>
        client!
          .from("vw_promocoes")
          .select("*")
          .order("produto_descricao")
          .order("item_id")
          .range(de, ate),
      ),
  });
  const produtoPorId = useMemo(
    () => new Map((produtos.data ?? []).map((p) => [p.id, p])),
    [produtos.data],
  );
  const filtradas = useMemo(
    () =>
      (tabelas.data ?? []).filter(
        (c) =>
          buscar(c.nome).includes(buscar(buscaCampanha)) &&
          (!filtroStatus || status(c, hoje) === filtroStatus),
      ),
    [tabelas.data, buscaCampanha, filtroStatus, hoje],
  );
  const campanha = (tabelas.data ?? []).find((c) => c.id === selected);
  useEffect(() => {
    if (!tabelas.isSuccess) return;
    if (!filtradas.some((c) => c.id === selected)) setSelected(filtradas[0]?.id ?? null);
  }, [filtradas, selected, tabelas.isSuccess]);
  useEffect(() => {
    setBuscaItem("");
  }, [selected]);
  const itensFiltrados = (itens.data ?? []).filter((i) => {
    const p = produtoPorId.get(i.produto_id);
    return buscar(`${p?.codigo ?? ""} ${p?.descricao ?? ""}`).includes(buscar(buscaItem));
  });
  const ofertas = (promocoes.data ?? []).filter((p) => p.vigente);
  const descontos = ofertas.filter(
    (p) => Number(p.preco_normal) > Number(p.preco_promocional) && Number(p.preco_normal) > 0,
  );
  const descontoMedio = descontos.length
    ? descontos.reduce(
        (s, p) => s + (1 - Number(p.preco_promocional) / Number(p.preco_normal)) * 100,
        0,
      ) / descontos.length
    : 0;
  const idsExistentes = new Set((itens.data ?? []).map((i) => i.produto_id));
  const disponiveis = (produtos.data ?? []).filter(
    (p) =>
      (!idsExistentes.has(p.id) || editandoItem?.produto_id === p.id) &&
      buscar(`${p.codigo} ${p.descricao}`).includes(buscar(buscaProduto)),
  );
  const resumoProdutos = selecionados
    .map((id) => produtoPorId.get(id))
    .filter((p): p is Produto => !!p);
  const previewPreco = (p: Produto) =>
    modoPreco === "percentual"
      ? precoCalculado(Number(p.preco_venda), Number(percentual))
      : Number(preco);

  async function atualizarOfertas() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tabelas_preco"] }),
      queryClient.invalidateQueries({ queryKey: ["tabela_preco_itens"] }),
      queryClient.invalidateQueries({ queryKey: ["vw_promocoes"] }),
      queryClient.invalidateQueries({ queryKey: ["preco_produto_info"] }),
    ]);
  }
  const salvarCampanha = useMutation({
    mutationFn: async () => {
      if (!canManage) throw new Error("Sem permissão para gerenciar promoções.");
      if (!head.nome.trim()) throw new Error("Informe o nome da promoção.");
      if (!head.vigencia_inicio) throw new Error("Informe a data de início.");
      if (head.vigencia_fim && head.vigencia_fim < head.vigencia_inicio)
        throw new Error("A data final deve ser igual ou posterior ao início.");
      if (!Number.isInteger(Number(head.prioridade)))
        throw new Error("A prioridade deve ser um número inteiro.");
      const payload = {
        nome: head.nome.trim(),
        cliente_id: head.cliente_id || null,
        uf: head.uf || null,
        vigencia_inicio: head.vigencia_inicio,
        vigencia_fim: head.vigencia_fim || null,
        prioridade: Number(head.prioridade),
      };
      const request = editando
        ? client!.from("tabelas_preco").update(payload).eq("id", editando)
        : client!.from("tabelas_preco").insert(payload);
      const { data, error } = await request.select("id").single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: async (id) => {
      toast.success(
        editando ? "Promoção atualizada." : "Promoção criada. Agora adicione os produtos.",
      );
      setDialogCampanha(false);
      await atualizarOfertas();
      setSelected(id);
      setBuscaCampanha("");
      setFiltroStatus("");
      setVisao("campanhas");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const alternarAtivo = useMutation({
    mutationFn: async (c: Campanha) => {
      if (!canManage) throw new Error("Sem permissão para gerenciar promoções.");
      const { error } = await client!
        .from("tabelas_preco")
        .update({ ativo: !c.ativo })
        .eq("id", c.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return !c.ativo;
    },
    onSuccess: async (ativo) => {
      toast.success(ativo ? "Promoção ativada." : "Promoção pausada.");
      await atualizarOfertas();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const salvarProdutos = useMutation({
    mutationFn: async () => {
      if (!canManage || !campanhaProdutos)
        throw new Error("Sem permissão ou campanha selecionada.");
      if (!selecionados.length) throw new Error("Selecione pelo menos um produto.");
      if (selecionados.length > 200) throw new Error("Inclua até 200 produtos de cada vez.");
      if (modoPreco === "preco" && selecionados.length !== 1)
        throw new Error("Para vários produtos, utilize o desconto percentual.");
      if (
        modoPreco === "percentual" &&
        (!percentual.trim() ||
          !Number.isFinite(Number(percentual)) ||
          Number(percentual) < 0 ||
          Number(percentual) > 100)
      )
        throw new Error("Informe um desconto entre 0 e 100%.");
      if (
        modoPreco === "preco" &&
        (!preco.trim() || !Number.isFinite(Number(preco)) || Number(preco) < 0)
      )
        throw new Error("Informe um preço válido.");
      if (
        !descontoMaximo.trim() ||
        !Number.isFinite(Number(descontoMaximo)) ||
        Number(descontoMaximo) < 0 ||
        Number(descontoMaximo) > 100
      )
        throw new Error("O desconto adicional deve estar entre 0 e 100%.");
      const payload = selecionados.map((id) => {
        const p = produtoPorId.get(id);
        if (!p || !Number.isFinite(Number(p.preco_venda)))
          throw new Error("Não foi possível conferir o preço normal do produto.");
        return {
          tabela_id: campanhaProdutos,
          produto_id: id,
          preco: Math.round(previewPreco(p) * 10000) / 10000,
          desconto_maximo: Number(descontoMaximo),
        };
      });
      // Inclusão usa INSERT: outra inclusão simultânea nunca sobrescreve preços existentes.
      const request = editandoItem
        ? client!
            .from("tabela_preco_itens")
            .update({ preco: payload[0]!.preco, desconto_maximo: payload[0]!.desconto_maximo })
            .eq("id", editandoItem.id)
            .eq("tabela_id", campanhaProdutos)
        : client!.from("tabela_preco_itens").insert(payload);
      const { data, error } = await request.select("id");
      if (error)
        throw new Error(
          error.code === "23505"
            ? "Um produto já foi incluído nesta campanha. Atualize a lista e tente novamente."
            : error.message,
        );
      if (data?.length !== payload.length)
        throw new Error("Não foi possível salvar todos os produtos. Confira suas permissões.");
      return payload.length;
    },
    onSuccess: async (count) => {
      toast.success(editandoItem ? "Preço atualizado." : `${count} produto(s) incluído(s).`);
      setDialogProdutos(false);
      await atualizarOfertas();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removerProduto = useMutation({
    mutationFn: async (i: Item) => {
      if (!canManage) throw new Error("Sem permissão para gerenciar promoções.");
      const { error } = await client!
        .from("tabela_preco_itens")
        .delete()
        .eq("id", i.id)
        .eq("tabela_id", i.tabela_id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Produto removido da promoção.");
      setRemover(null);
      await atualizarOfertas();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function abrirCampanha(c?: Campanha) {
    setEditando(c?.id ?? null);
    setHead(
      c
        ? {
            nome: c.nome,
            cliente_id: c.cliente_id ?? "",
            uf: c.uf ?? "",
            vigencia_inicio: c.vigencia_inicio,
            vigencia_fim: c.vigencia_fim ?? "",
            prioridade: String(c.prioridade),
          }
        : novoFormulario(),
    );
    setDialogCampanha(true);
  }
  function abrirProdutos(i?: Item) {
    setCampanhaProdutos(selected);
    setEditandoItem(i ?? null);
    setSelecionados(i ? [i.produto_id] : []);
    setBuscaProduto("");
    setModoPreco(i ? "preco" : "percentual");
    setPercentual("10");
    setPreco(i ? String(i.preco) : "");
    setDescontoMaximo(String(i?.desconto_maximo ?? 0));
    setDialogProdutos(true);
  }
  function escolherProduto(id: string) {
    const next = selecionados.includes(id)
      ? selecionados.filter((p) => p !== id)
      : [...selecionados, id];
    setSelecionados(next);
    if (next.length > 1) setModoPreco("percentual");
    if (next.length === 1) setPreco(String(produtoPorId.get(next[0]!)?.preco_venda ?? ""));
  }
  function prazoRapido(dias: number) {
    const inicio = head.vigencia_inicio || hoje;
    const data = new Date(`${inicio}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + dias - 1);
    setHead((h) => ({
      ...h,
      vigencia_inicio: inicio,
      vigencia_fim: data.toISOString().slice(0, 10),
    }));
  }

  return (
    <ErpLayout
      title="Promoções"
      description="Escolha uma campanha e organize suas ofertas."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
          {canManage && (
            <Button onClick={() => abrirCampanha()}>
              <Plus className="size-4" /> Nova promoção
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: "Campanhas ativas",
              value: (tabelas.data ?? []).filter((c) => status(c, hoje) === "Ativa").length,
            },
            {
              label: "Campanhas agendadas",
              value: (tabelas.data ?? []).filter((c) => status(c, hoje) === "Agendada").length,
            },
            { label: "Produtos em oferta", value: new Set(ofertas.map((p) => p.produto_id)).size },
            { label: "Desconto médio vigente", value: `${descontoMedio.toFixed(1)}%` },
          ].map((r) => (
            <div key={r.label} className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p className="mt-1 text-2xl font-semibold">
                {tabelas.isPending || promocoes.isPending ? "—" : r.value}
              </p>
            </div>
          ))}
        </div>
        <div className="no-print flex gap-2" aria-label="Visualização de promoções">
          <Button
            variant={visao === "campanhas" ? "default" : "outline"}
            aria-pressed={visao === "campanhas"}
            onClick={() => setVisao("campanhas")}
          >
            Campanhas
          </Button>
          <Button
            variant={visao === "ofertas" ? "default" : "outline"}
            aria-pressed={visao === "ofertas"}
            onClick={() => setVisao("ofertas")}
          >
            Ofertas vigentes
          </Button>
        </div>
        {visao === "campanhas" ? (
          <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <aside className="no-print self-start overflow-hidden rounded-lg border bg-card">
              <div className="space-y-3 border-b p-4">
                <h2 className="font-semibold">Suas campanhas</h2>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Buscar promoção"
                    placeholder="Buscar campanha..."
                    className="pl-9"
                    value={buscaCampanha}
                    onChange={(e) => setBuscaCampanha(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filtrar campanhas por status"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                >
                  <option value="">Todos os status</option>
                  {(["Ativa", "Agendada", "Pausada", "Encerrada"] as Status[]).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="max-h-72 overflow-y-auto p-2 lg:max-h-[65vh]">
                {tabelas.isPending ? (
                  <Carregando texto="Carregando campanhas..." />
                ) : tabelas.isError ? (
                  <Erro texto={tabelas.error.message} />
                ) : !filtradas.length ? (
                  <div className="space-y-2 p-4 text-sm text-muted-foreground">
                    <p>
                      {buscaCampanha || filtroStatus
                        ? "Nenhuma campanha com esses filtros."
                        : "Você ainda não tem campanhas."}
                    </p>
                    {canManage && !buscaCampanha && !filtroStatus && (
                      <Button size="sm" onClick={() => abrirCampanha()}>
                        Criar primeira promoção
                      </Button>
                    )}
                  </div>
                ) : (
                  filtradas.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected === c.id}
                      onClick={() => setSelected(c.id)}
                      className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected === c.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{c.nome}</span>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(status(c, hoje))}`}
                        >
                          {status(c, hoje)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.vigencia_fim ? `Até ${dataBR(c.vigencia_fim)}` : "Sem data final"}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                {filtradas.length} campanha(s)
              </p>
            </aside>
            <section className="print-area min-w-0 overflow-hidden rounded-lg border bg-card">
              {campanha ? (
                <>
                  <div className="space-y-3 border-b p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold">{campanha.nome}</h2>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(status(campanha, hoje))}`}
                          >
                            {status(campanha, hoje)}
                          </span>
                        </div>
                        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="size-4" /> {dataBR(campanha.vigencia_inicio)} ·{" "}
                            {dataBR(campanha.vigencia_fim)}
                          </span>
                          <span>
                            {campanha.cliente_id
                              ? (clientes.data?.find((c) => c.id === campanha.cliente_id)
                                  ?.razao_social ?? "Cliente específico")
                              : "Todos os clientes"}
                            {campanha.uf ? ` · ${campanha.uf}` : ""}
                          </span>
                        </p>
                      </div>
                      {canManage && (
                        <div className="no-print flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => abrirCampanha(campanha)}
                          >
                            <Pencil className="size-4" /> Editar campanha
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={alternarAtivo.isPending}
                            onClick={() => alternarAtivo.mutate(campanha)}
                          >
                            {alternarAtivo.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : null}
                            {campanha.ativo ? "Pausar" : "Ativar"}
                          </Button>
                        </div>
                      )}
                    </div>
                    {status(campanha, hoje) === "Encerrada" && (
                      <p className="text-sm text-muted-foreground">
                        Esta campanha terminou. Edite as datas para voltar a oferecer estes preços.
                      </p>
                    )}
                  </div>
                  <div className="no-print flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative sm:max-w-sm sm:flex-1">
                      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                      <Input
                        aria-label="Buscar produto na promoção"
                        placeholder="Código ou nome do produto..."
                        className="pl-9"
                        value={buscaItem}
                        onChange={(e) => setBuscaItem(e.target.value)}
                      />
                    </div>
                    {canManage && (
                      <Button
                        disabled={
                          itens.isPending || itens.isError || produtos.isPending || produtos.isError
                        }
                        onClick={() => abrirProdutos()}
                      >
                        <Plus className="size-4" /> Adicionar produtos
                      </Button>
                    )}
                  </div>
                  {itens.isPending || produtos.isPending ? (
                    <Carregando texto="Carregando produtos..." />
                  ) : itens.isError || produtos.isError ? (
                    <Erro texto={itens.error?.message ?? produtos.error!.message} />
                  ) : !itensFiltrados.length ? (
                    <div className="space-y-2 px-5 py-16 text-center">
                      <Package className="mx-auto size-9 text-muted-foreground" />
                      <h3 className="font-medium">
                        {buscaItem ? "Nenhum produto encontrado" : "Adicione os primeiros produtos"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {buscaItem
                          ? "Tente outro código ou nome."
                          : canManage
                            ? "Escolha um ou vários produtos e defina a oferta."
                            : "Esta campanha ainda não tem produtos."}
                      </p>
                      {canManage && !buscaItem && (
                        <Button variant="outline" onClick={() => abrirProdutos()}>
                          <Plus className="size-4" /> Selecionar produtos
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">
                              Preço normal
                            </TableHead>
                            <TableHead className="text-right">Sua oferta</TableHead>
                            <TableHead className="hidden md:table-cell">Economia</TableHead>
                            {canManage && (
                              <TableHead className="no-print text-right">Ações</TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itensFiltrados.map((i) => {
                            const p = produtoPorId.get(i.produto_id);
                            return (
                              <TableRow key={i.id}>
                                <TableCell>
                                  <p className="font-medium">
                                    {p?.descricao ?? "Produto indisponível"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {p?.codigo ?? "—"}
                                  </p>
                                </TableCell>
                                <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                                  {p ? brl(p.preco_venda) : "—"}
                                </TableCell>
                                <TableCell className="text-right font-semibold text-primary">
                                  {brl(i.preco)}
                                  {p && (
                                    <p className="mt-1 text-xs font-normal text-muted-foreground md:hidden">
                                      {economia(Number(p.preco_venda), Number(i.preco))}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                                  {p ? economia(Number(p.preco_venda), Number(i.preco)) : "—"}
                                </TableCell>
                                {canManage && (
                                  <TableCell className="no-print">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label={`Editar preço de ${p?.descricao ?? "produto"}`}
                                        disabled={!p}
                                        onClick={() => abrirProdutos(i)}
                                      >
                                        <Pencil className="size-4" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        aria-label={`Remover ${p?.descricao ?? "produto"} da promoção`}
                                        onClick={() => setRemover(i)}
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                )}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                    {itens.isSuccess
                      ? `${itensFiltrados.length} de ${itens.data.length} produto(s)`
                      : ""}
                  </p>
                </>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
                  <BadgePercent className="size-10 text-primary/60" />
                  <h2 className="text-lg font-semibold">Selecione uma campanha</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Os produtos e preços aparecem aqui.
                    {canManage ? " Crie uma promoção para começar." : ""}
                  </p>
                  {canManage && (
                    <Button onClick={() => abrirCampanha()}>
                      <Plus className="size-4" /> Nova promoção
                    </Button>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className="print-area overflow-hidden rounded-lg border bg-card">
            <div className="border-b p-4">
              <h2 className="font-semibold">Ofertas vigentes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Preços disponíveis hoje nas campanhas que você pode visualizar.
              </p>
              <Input
                aria-label="Buscar oferta vigente"
                className="no-print mt-3 max-w-sm"
                placeholder="Código ou nome do produto..."
                value={buscaItem}
                onChange={(e) => setBuscaItem(e.target.value)}
              />
            </div>
            {promocoes.isPending ? (
              <Carregando texto="Carregando ofertas..." />
            ) : promocoes.isError ? (
              <Erro texto={promocoes.error.message} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Campanha</TableHead>
                      <TableHead className="text-right">Preço normal</TableHead>
                      <TableHead className="text-right">Oferta</TableHead>
                      <TableHead>Economia</TableHead>
                      <TableHead>Até</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ofertas
                      .filter((p) =>
                        buscar(`${p.produto_codigo} ${p.produto_descricao}`).includes(
                          buscar(buscaItem),
                        ),
                      )
                      .map((p) => (
                        <TableRow key={p.item_id}>
                          <TableCell>
                            <p className="font-medium">{p.produto_descricao}</p>
                            <p className="text-xs text-muted-foreground">{p.produto_codigo}</p>
                          </TableCell>
                          <TableCell>
                            <button
                              className="text-left text-primary hover:underline"
                              onClick={() => {
                                setSelected(p.tabela_id);
                                setFiltroStatus("");
                                setBuscaCampanha("");
                                setVisao("campanhas");
                              }}
                            >
                              {p.tabela_nome}
                            </button>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {brl(p.preco_normal)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {brl(p.preco_promocional)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {economia(Number(p.preco_normal), Number(p.preco_promocional))}
                          </TableCell>
                          <TableCell>{dataBR(p.vigencia_fim)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {!ofertas.some((p) =>
                  buscar(`${p.produto_codigo} ${p.produto_descricao}`).includes(buscar(buscaItem)),
                ) && (
                  <p className="p-10 text-center text-sm text-muted-foreground">
                    Nenhuma oferta vigente encontrada.
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <Dialog
        open={dialogCampanha}
        onOpenChange={(open) => {
          if (!salvarCampanha.isPending) setDialogCampanha(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar campanha" : "Nova promoção"}</DialogTitle>
            <DialogDescription>
              Defina o nome e o período. Depois, escolha os produtos.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              salvarCampanha.mutate();
            }}
            className="space-y-4"
          >
            <fieldset disabled={salvarCampanha.isPending} className="space-y-4">
              <div>
                <Label htmlFor="promo-nome">Nome da promoção</Label>
                <Input
                  id="promo-nome"
                  autoFocus
                  required
                  maxLength={160}
                  className="mt-1"
                  placeholder="Ex.: Ofertas da semana"
                  value={head.nome}
                  onChange={(e) => setHead((h) => ({ ...h, nome: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="promo-inicio">Começa em</Label>
                  <Input
                    id="promo-inicio"
                    className="mt-1"
                    type="date"
                    required
                    value={head.vigencia_inicio}
                    onChange={(e) => setHead((h) => ({ ...h, vigencia_inicio: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="promo-fim">Termina em</Label>
                  <Input
                    id="promo-fim"
                    className="mt-1"
                    type="date"
                    min={head.vigencia_inicio}
                    value={head.vigencia_fim}
                    onChange={(e) => setHead((h) => ({ ...h, vigencia_fim: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Duração:</span>
                {[7, 15, 30].map((d) => (
                  <Button
                    type="button"
                    key={d}
                    size="sm"
                    variant="outline"
                    onClick={() => prazoRapido(d)}
                  >
                    {d} dias
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setHead((h) => ({ ...h, vigencia_fim: "" }))}
                >
                  Sem data final
                </Button>
              </div>
              <details
                open={!!head.cliente_id || !!head.uf || head.prioridade !== "0"}
                className="rounded-md border p-3"
              >
                <summary className="cursor-pointer text-sm font-medium">Regras opcionais</summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Por padrão, a campanha vale para todos os clientes e estados.
                </p>
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="promo-cliente">Cliente</Label>
                    <select
                      id="promo-cliente"
                      disabled={clientes.isPending || clientes.isError}
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={head.cliente_id}
                      onChange={(e) => setHead((h) => ({ ...h, cliente_id: e.target.value }))}
                    >
                      <option value="">Todos os clientes</option>
                      {(clientes.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.razao_social}
                        </option>
                      ))}
                    </select>
                    {clientes.isError && (
                      <p className="mt-1 text-xs text-destructive">
                        Não foi possível carregar os clientes.
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="promo-uf">Estado</Label>
                      <select
                        id="promo-uf"
                        className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={head.uf}
                        onChange={(e) => setHead((h) => ({ ...h, uf: e.target.value }))}
                      >
                        <option value="">Todos</option>
                        {ufs.map((uf) => (
                          <option key={uf}>{uf}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="promo-prioridade">Prioridade</Label>
                      <Input
                        id="promo-prioridade"
                        className="mt-1"
                        type="number"
                        step="1"
                        value={head.prioridade}
                        onChange={(e) => setHead((h) => ({ ...h, prioridade: e.target.value }))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Se duas campanhas tiverem as mesmas regras, a de maior prioridade será usada.
                  </p>
                </div>
              </details>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={salvarCampanha.isPending}
                  onClick={() => setDialogCampanha(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvarCampanha.isPending}>
                  {salvarCampanha.isPending && <Loader2 className="size-4 animate-spin" />}
                  {editando ? "Salvar campanha" : "Criar promoção"}
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogProdutos}
        onOpenChange={(open) => {
          if (!salvarProdutos.isPending) setDialogProdutos(open);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editandoItem ? "Editar oferta" : "Adicionar produtos"}</DialogTitle>
            <DialogDescription>
              {editandoItem
                ? "Atualize o preço promocional deste produto."
                : "Selecione os produtos e aplique um desconto de uma só vez."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvarProdutos.mutate();
            }}
          >
            {!editandoItem && (
              <div className="space-y-2">
                <Input
                  aria-label="Buscar produtos para adicionar"
                  placeholder="Busque por código ou nome..."
                  value={buscaProduto}
                  onChange={(e) => setBuscaProduto(e.target.value)}
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {selecionados.length} selecionado(s) · {disponiveis.length} disponível(is)
                  </span>
                  {selecionados.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setSelecionados([])}
                    >
                      Limpar seleção
                    </Button>
                  )}
                </div>
                <fieldset
                  disabled={salvarProdutos.isPending}
                  className="max-h-52 overflow-y-auto rounded-md border"
                >
                  <legend className="sr-only">Produtos disponíveis</legend>
                  {disponiveis.slice(0, 100).map((p) => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50 ${selecionados.includes(p.id) ? "bg-primary/5" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selecionados.includes(p.id)}
                        onChange={() => escolherProduto(p.id)}
                        disabled={!selecionados.includes(p.id) && selecionados.length >= 200}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{p.descricao}</span>
                        <span className="text-xs text-muted-foreground">{p.codigo}</span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {brl(p.preco_venda)}
                      </span>
                    </label>
                  ))}
                  {!disponiveis.length && (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      {buscaProduto
                        ? "Nenhum produto encontrado."
                        : "Todos os produtos já estão nesta campanha."}
                    </p>
                  )}
                </fieldset>
                {disponiveis.length > 100 && (
                  <p className="text-xs text-muted-foreground">
                    Exibindo os primeiros 100. Use a busca para encontrar outros produtos.
                  </p>
                )}
              </div>
            )}
            <fieldset disabled={salvarProdutos.isPending} className="space-y-3">
              <legend className="mb-2 text-sm font-medium">Como definir a oferta?</legend>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={modoPreco === "percentual" ? "default" : "outline"}
                  aria-pressed={modoPreco === "percentual"}
                  onClick={() => setModoPreco("percentual")}
                >
                  Desconto em %
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={modoPreco === "preco" ? "default" : "outline"}
                  aria-pressed={modoPreco === "preco"}
                  disabled={selecionados.length !== 1}
                  onClick={() => setModoPreco("preco")}
                >
                  Digitar preço
                </Button>
              </div>
              {modoPreco === "percentual" ? (
                <div>
                  <Label htmlFor="promo-percentual">Desconto sobre o preço normal (%)</Label>
                  <Input
                    id="promo-percentual"
                    className="mt-1 max-w-48"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={percentual}
                    onChange={(e) => setPercentual(e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="promo-preco">Preço promocional (R$)</Label>
                  <Input
                    id="promo-preco"
                    className="mt-1 max-w-48"
                    type="number"
                    min="0"
                    step="0.0001"
                    required
                    value={preco}
                    onChange={(e) => setPreco(e.target.value)}
                  />
                </div>
              )}
              {resumoProdutos.length > 0 && (
                <div
                  className="max-h-40 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-3"
                  aria-label="Prévia dos preços"
                >
                  {resumoProdutos.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{p.descricao}</span>
                      <span className="shrink-0">
                        <span className="mr-2 text-muted-foreground">{brl(p.preco_venda)}</span>
                        <ChevronRight className="mr-2 inline size-3" />
                        <strong>
                          {Number.isFinite(previewPreco(p)) && previewPreco(p) >= 0
                            ? brl(previewPreco(p))
                            : "—"}
                        </strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <details className="rounded-md border p-3" open={Number(descontoMaximo) > 0}>
                <summary className="cursor-pointer text-sm">Limite de desconto no pedido</summary>
                <Label htmlFor="promo-desconto-maximo" className="mt-3 block">
                  Desconto máximo (%)
                </Label>
                <Input
                  id="promo-desconto-maximo"
                  className="mt-1 max-w-48"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={descontoMaximo}
                  onChange={(e) => setDescontoMaximo(e.target.value)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Define o desconto máximo do produto na tabela. Este valor não altera o preço da
                  oferta.
                </p>
              </details>
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={salvarProdutos.isPending}
                onClick={() => setDialogProdutos(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!selecionados.length || salvarProdutos.isPending}>
                {salvarProdutos.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {editandoItem
                  ? "Salvar preço"
                  : `Adicionar ${selecionados.length || ""} produto${selecionados.length === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remover}
        onOpenChange={(open) => {
          if (!open && !removerProduto.isPending) setRemover(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover produto da promoção?</DialogTitle>
            <DialogDescription>
              {remover ? produtoPorId.get(remover.produto_id)?.descricao : ""}. O produto continua
              no cadastro do sistema.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={removerProduto.isPending}
              onClick={() => setRemover(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={removerProduto.isPending}
              onClick={() => remover && removerProduto.mutate(remover)}
            >
              {removerProduto.isPending && <Loader2 className="size-4 animate-spin" />}Remover da
              promoção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {texto}
    </div>
  );
}
function Erro({ texto }: { texto: string }) {
  return (
    <p role="alert" className="p-5 text-sm text-destructive">
      {texto}
    </p>
  );
}
