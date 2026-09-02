import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ClipboardList,
  Flame,
  History,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Repeat,
  ShoppingCart,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
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
import { Textarea } from "@/components/ui/textarea";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/lead-rota")({
  head: () => ({
    meta: [
      { title: "Lead Rota — vendas ativas por rota | ERP Distribuidora" },
      {
        name: "description",
        content:
          "Selecione uma rota e trabalhe a carteira inteira: histórico do cliente, produtos frequentes, limite de crédito, registro de contato e novo pedido em poucos cliques.",
      },
      { property: "og:title", content: "Lead Rota — vendas ativas por rota" },
      {
        property: "og:description",
        content: "Carteira de clientes por rota com histórico, limite e novo pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadRotaPage,
});

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v == null ? "" : String(v));
const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const PAGE_SIZE = 24;

const funilLabels: Record<string, string> = {
  nao_contatado: "Não contatado",
  contato_realizado: "Contato realizado",
  aguardando_retorno: "Aguardando retorno",
  em_negociacao: "Pedido em negociação",
  pedido_realizado: "Pedido realizado",
  sem_interesse: "Sem interesse",
  nao_localizado: "Não localizado",
  proximo_contato: "Próximo contato agendado",
};

const resultadoOptions = [
  { value: "contato_realizado", label: "Contato realizado" },
  { value: "nao_atendeu", label: "Não atendeu" },
  { value: "pediu_retorno", label: "Pediu retorno" },
  { value: "fez_pedido", label: "Fez pedido" },
  { value: "sem_interesse", label: "Não tem interesse" },
  { value: "cliente_fechado", label: "Cliente fechado" },
  { value: "nao_localizado", label: "Não localizado" },
  { value: "outro", label: "Outro" },
];

const classificacoes = [
  { value: "recente", label: "Comprou recentemente (até 15 dias)" },
  { value: "15", label: "Sem comprar há 15 dias" },
  { value: "30", label: "Sem comprar há 30 dias" },
  { value: "45", label: "Sem comprar há 45 dias" },
  { value: "60", label: "Sem comprar há 60 dias" },
  { value: "90", label: "Sem comprar há 90 dias" },
  { value: "inadimplente", label: "Inadimplentes" },
  { value: "sem_mes", label: "Sem pedido no mês" },
  { value: "potencial", label: "Potencial de compra" },
];

const ordenacoes = [
  { value: "oportunidade", label: "Ordenar por oportunidade" },
  { value: "nome", label: "Nome" },
  { value: "ultima", label: "Última compra" },
  { value: "dias", label: "Dias sem comprar" },
  { value: "valor_ultima", label: "Valor da última compra" },
  { value: "ticket", label: "Ticket médio" },
  { value: "limite", label: "Limite disponível" },
];

function oportunidade(score: number) {
  if (score >= 60) return { icon: "🔥", label: "Alta oportunidade", cls: "text-destructive" };
  if (score >= 30) return { icon: "🟡", label: "Média oportunidade", cls: "text-amber-500" };
  return { icon: "⚪", label: "Baixa oportunidade", cls: "text-muted-foreground" };
}

function semaforoDias(dias: number) {
  if (dias >= 90) return "🔴";
  if (dias >= 60) return "🟠";
  if (dias >= 30) return "🟡";
  return "🟢";
}

function whatsappLink(cliente: Row) {
  const raw = txt(cliente["whatsapp"]) || txt(cliente["telefone"]);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/55${digits.slice(-11)}`;
}

function LeadRotaPage() {
  const { client, roles, user } = useSupabase();
  const { centro } = useCentro();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const podeGerir = roles.some((r) => r === "admin" || r === "gestor");
  const [rotaId, setRotaId] = useState("");
  const [filtros, setFiltros] = useState<Record<string, string>>({ ordem: "oportunidade" });
  const setF = (k: string, v: string) => {
    setFiltros((s) => ({ ...s, [k]: v }));
    setPagina(1);
  };
  const [pagina, setPagina] = useState(1);
  const [clienteAberto, setClienteAberto] = useState<string | null>(null);
  const [contatoAberto, setContatoAberto] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState<string | null>(null);
  const [avisoLimite, setAvisoLimite] = useState<{ cliente: Row; modo: string } | null>(null);

  const rotas = useQuery({
    queryKey: ["rotas", "lead"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("rotas")
        .select("id, nome, regiao, dia_semana, sequencia, centro_id")
        .eq("ativo", true)
        .order("sequencia", { ascending: true })
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const vendedores = useQuery({
    queryKey: ["representantes", "lead"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const centros = useQuery({
    queryKey: ["centros", "lead"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  /** Carteira da rota: só busca depois que o vendedor escolhe a rota. */
  const carteira = useQuery({
    queryKey: ["vw_lead_rota", rotaId],
    enabled: !!client && !!rotaId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_rota")
        .select("*")
        .eq("rota_id", rotaId)
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const meta = useQuery({
    queryKey: ["vw_lead_rota_metas", rotaId],
    enabled: !!client && !!rotaId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_rota_metas")
        .select("*")
        .eq("rota_id", rotaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Row | null;
    },
  });

  const lista = useMemo(() => {
    let rows = carteira.data ?? [];
    const centroFiltro = filtros["centro"] || centro;
    if (centroFiltro) rows = rows.filter((r) => txt(r["centro_id"]) === centroFiltro);
    if (filtros["vendedor"])
      rows = rows.filter((r) => txt(r["representante_id"]) === filtros["vendedor"]);
    if (filtros["status"]) rows = rows.filter((r) => txt(r["status"]) === filtros["status"]);
    if (filtros["funil"]) rows = rows.filter((r) => txt(r["funil_status"]) === filtros["funil"]);
    const busca = (filtros["busca"] ?? "").trim().toLowerCase();
    if (busca)
      rows = rows.filter((r) =>
        [r["razao_social"], r["nome_fantasia"], r["codigo"], r["cidade"], r["telefone"]]
          .map(txt)
          .join(" ")
          .toLowerCase()
          .includes(busca),
      );

    const cls = filtros["classificacao"];
    if (cls === "recente") rows = rows.filter((r) => num(r["dias_sem_comprar"]) <= 15);
    else if (["15", "30", "45", "60", "90"].includes(cls ?? ""))
      rows = rows.filter((r) => num(r["dias_sem_comprar"]) >= Number(cls));
    else if (cls === "inadimplente") rows = rows.filter((r) => num(r["vencido"]) > 0);
    else if (cls === "sem_mes") rows = rows.filter((r) => num(r["pedidos_mes"]) === 0);
    else if (cls === "potencial")
      rows = rows.filter(
        (r) => num(r["score_oportunidade"]) >= 50 && num(r["limite_disponivel"]) > 0,
      );

    const ordem = filtros["ordem"] ?? "oportunidade";
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (ordem) {
        case "nome":
          return txt(a["razao_social"]).localeCompare(txt(b["razao_social"]));
        case "ultima":
          return txt(b["ultima_compra"]).localeCompare(txt(a["ultima_compra"]));
        case "dias":
          return num(b["dias_sem_comprar"]) - num(a["dias_sem_comprar"]);
        case "valor_ultima":
          return num(b["ultima_compra_valor"]) - num(a["ultima_compra_valor"]);
        case "ticket":
          return num(b["ticket_medio"]) - num(a["ticket_medio"]);
        case "limite":
          return num(b["limite_disponivel"]) - num(a["limite_disponivel"]);
        default:
          return num(b["score_oportunidade"]) - num(a["score_oportunidade"]);
      }
    });
    return sorted;
  }, [carteira.data, filtros, centro]);

  const paginada = lista.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));

  const contadores = useMemo(() => {
    const rows = lista;
    const conta = (s: string) => rows.filter((r) => txt(r["funil_status"]) === s).length;
    const contatados = rows.filter(
      (r) => txt(r["funil_status"]) && txt(r["funil_status"]) !== "nao_contatado",
    ).length;
    return {
      total: rows.length,
      contatados,
      naoContatados: rows.length - contatados,
      pedidos: conta("pedido_realizado"),
      negociacao: conta("em_negociacao"),
      semInteresse: conta("sem_interesse"),
      atencao90: rows.filter((r) => num(r["dias_sem_comprar"]) >= 90).length,
      atencao60: rows.filter(
        (r) => num(r["dias_sem_comprar"]) >= 60 && num(r["dias_sem_comprar"]) < 90,
      ).length,
      atencao30: rows.filter(
        (r) => num(r["dias_sem_comprar"]) >= 30 && num(r["dias_sem_comprar"]) < 60,
      ).length,
    };
  }, [lista]);

  const clienteFoco = useMemo(
    () => lista.find((r) => txt(r["cliente_id"]) === (clienteAberto ?? "")) ?? null,
    [lista, clienteAberto],
  );

  const criarPedido = useMutation({
    mutationFn: async ({ clienteId, modo }: { clienteId: string; modo: string }) => {
      const { data, error } = await client!.rpc("lead_criar_pedido", {
        _cliente_id: clienteId,
        _modo: modo,
        _rota_id: rotaId || null,
        _centro_id: null,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    onSuccess: (id) => {
      toast.success("Pedido criado com cliente, vendedor, rota e condições preenchidos");
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      navigate({ to: "/pedidos", search: { pedido: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function iniciarPedido(cliente: Row, modo: string) {
    const excesso = num(cliente["ultima_compra_valor"]);
    if (num(cliente["limite_credito"]) > 0 && num(cliente["limite_disponivel"]) <= 0) {
      setAvisoLimite({ cliente, modo });
      return;
    }
    void excesso;
    criarPedido.mutate({ clienteId: txt(cliente["cliente_id"]), modo });
  }

  return (
    <ErpLayout
      title="Lead Rota"
      description="Escolha a rota, trabalhe a carteira inteira e transforme cada visita em pedido."
      actions={
        rotaId ? (
          <Button
            variant="outline"
            onClick={() => {
              void carteira.refetch();
              void meta.refetch();
            }}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <section className="rounded-lg border border-border bg-card p-4">
          <Label className="text-sm font-medium">Selecione uma rota</Label>
          <select
            value={rotaId}
            onChange={(e) => {
              setRotaId(e.target.value);
              setPagina(1);
            }}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md"
          >
            <option value="">— escolha a rota para carregar os clientes —</option>
            {(rotas.data ?? []).map((r) => (
              <option key={txt(r["id"])} value={txt(r["id"])}>
                {txt(r["nome"])}
                {r["regiao"] ? ` · ${txt(r["regiao"])}` : ""}
                {r["dia_semana"] ? ` · ${txt(r["dia_semana"])}` : ""}
              </option>
            ))}
          </select>
        </section>

        {!rotaId ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum cliente é carregado antes da escolha da rota. Selecione uma rota acima para abrir
            a carteira.
          </p>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                ["Clientes da rota", contadores.total],
                ["Contatados", contadores.contatados],
                ["Ainda não contatados", contadores.naoContatados],
                ["Pedidos realizados", contadores.pedidos],
                ["Em negociação", contadores.negociacao],
                ["Sem interesse", contadores.semInteresse],
              ].map(([label, valor]) => (
                <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-xl font-semibold">{valor}</p>
                </div>
              ))}
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Faturamento do mês na rota
                </p>
                <p className="text-lg font-semibold">{brl(meta.data?.["faturamento_mes"])}</p>
                <p className="text-xs text-muted-foreground">
                  {num(meta.data?.["pedidos_mes"])} pedido(s) ·{" "}
                  {num(meta.data?.["pedidos_mes"]) > 0
                    ? brl(num(meta.data?.["faturamento_mes"]) / num(meta.data?.["pedidos_mes"]))
                    : brl(0)}{" "}
                  ticket médio
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Taxa de conversão
                </p>
                <p className="text-lg font-semibold">
                  {contadores.total > 0
                    ? ((num(meta.data?.["clientes_com_pedido"]) / contadores.total) * 100).toFixed(1)
                    : "0,0"}
                  %
                </p>
                <p className="text-xs text-muted-foreground">
                  {num(meta.data?.["clientes_com_pedido"])} cliente(s) com pedido no mês
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Clientes que precisam de atenção
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-sm">
                  <button
                    className="rounded-md border border-border px-2 py-1"
                    onClick={() => setF("classificacao", "90")}
                  >
                    🔴 +90 dias: {contadores.atencao90}
                  </button>
                  <button
                    className="rounded-md border border-border px-2 py-1"
                    onClick={() => setF("classificacao", "60")}
                  >
                    🟠 +60 dias: {contadores.atencao60}
                  </button>
                  <button
                    className="rounded-md border border-border px-2 py-1"
                    onClick={() => setF("classificacao", "30")}
                  >
                    🟡 +30 dias: {contadores.atencao30}
                  </button>
                </div>
              </div>
            </section>

            <FilterBar onClear={() => setFiltros({ ordem: "oportunidade" })}>
              <FilterText
                label="Buscar cliente"
                value={filtros["busca"] ?? ""}
                onChange={(v) => setF("busca", v)}
                placeholder="Nome, código, cidade ou telefone"
              />
              <FilterSelect
                label="Classificação"
                value={filtros["classificacao"] ?? ""}
                onChange={(v) => setF("classificacao", v)}
                options={classificacoes}
                allLabel="Todos"
              />
              {podeGerir ? (
                <FilterSelect
                  label="Vendedor"
                  value={filtros["vendedor"] ?? ""}
                  onChange={(v) => setF("vendedor", v)}
                  options={(vendedores.data ?? []).map((v) => ({
                    value: txt(v["id"]),
                    label: txt(v["nome"]),
                  }))}
                />
              ) : null}
              <FilterSelect
                label="Centro de custo"
                value={filtros["centro"] ?? ""}
                onChange={(v) => setF("centro", v)}
                options={(centros.data ?? []).map((c) => ({
                  value: txt(c["id"]),
                  label: txt(c["nome"]),
                }))}
              />
              <FilterSelect
                label="Situação do funil"
                value={filtros["funil"] ?? ""}
                onChange={(v) => setF("funil", v)}
                options={Object.entries(funilLabels).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                label="Ordenar por"
                value={filtros["ordem"] ?? "oportunidade"}
                onChange={(v) => setF("ordem", v)}
                options={ordenacoes}
                allLabel="Oportunidade"
              />
            </FilterBar>

            {carteira.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando carteira da rota...
              </div>
            ) : carteira.isError ? (
              <p className="text-sm text-destructive">{(carteira.error as Error).message}</p>
            ) : lista.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado nesta rota com os filtros atuais.
              </p>
            ) : (
              <>
                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {paginada.map((c) => {
                    const op = oportunidade(num(c["score_oportunidade"]));
                    const zap = whatsappLink(c);
                    return (
                      <article
                        key={txt(c["cliente_id"])}
                        className="rounded-lg border border-border bg-card p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <button
                              className="truncate text-left font-semibold hover:underline"
                              onClick={() => setClienteAberto(txt(c["cliente_id"]))}
                            >
                              {txt(c["razao_social"])}
                            </button>
                            {c["nome_fantasia"] ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {txt(c["nome_fantasia"])}
                              </p>
                            ) : null}
                          </div>
                          <span className={`shrink-0 text-xs ${op.cls}`} title={op.label}>
                            {op.icon} {num(c["score_oportunidade"]).toFixed(0)}
                          </span>
                        </div>

                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <Info label="Rota" value={txt(c["rota"]) || "—"} />
                          <Info label="Vendedor" value={txt(c["representante"]) || "—"} />
                          <Info label="Cidade" value={txt(c["cidade"]) || "—"} />
                          <Info label="Telefone" value={txt(c["telefone"]) || "—"} />
                          <Info label="Endereço" value={txt(c["endereco"]) || "—"} />
                          <Info
                            label="Situação"
                            value={funilLabels[txt(c["funil_status"])] ?? "—"}
                          />
                          <Info label="Última compra" value={fmtDate(c["ultima_compra"])} />
                          <Info
                            label="Dias sem comprar"
                            value={`${semaforoDias(num(c["dias_sem_comprar"]))} ${
                              num(c["dias_sem_comprar"]) >= 9999
                                ? "nunca comprou"
                                : `${num(c["dias_sem_comprar"])} dias`
                            }`}
                          />
                          <Info label="Valor última" value={brl(c["ultima_compra_valor"])} />
                          <Info label="Pedidos" value={txt(c["pedidos"])} />
                          <Info label="Ticket médio" value={brl(c["ticket_medio"])} />
                          <Info label="Limite" value={brl(c["limite_credito"])} />
                          <Info label="Em aberto" value={brl(c["em_aberto"])} />
                          <Info
                            label="Vencido"
                            value={brl(c["vencido"])}
                            danger={num(c["vencido"]) > 0}
                          />
                          <Info label="Disponível" value={brl(c["limite_disponivel"])} />
                          <Info label="Status" value={txt(c["status"])} />
                        </dl>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setClienteAberto(txt(c["cliente_id"]))}
                          >
                            <User className="size-3.5" /> Ver cliente
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setHistoricoAberto(txt(c["cliente_id"]))}
                          >
                            <History className="size-3.5" /> Histórico
                          </Button>
                          <Button size="sm" onClick={() => iniciarPedido(c, "vazio")}>
                            <ShoppingCart className="size-3.5" /> Novo pedido
                          </Button>
                          {zap ? (
                            <Button size="sm" variant="outline" asChild>
                              <a href={zap} target="_blank" rel="noreferrer">
                                <MessageCircle className="size-3.5" /> WhatsApp
                              </a>
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setContatoAberto(txt(c["cliente_id"]))}
                          >
                            <Phone className="size-3.5" /> Registrar contato
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {lista.length} cliente(s) · página {pagina} de {totalPaginas}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pagina <= 1}
                      onClick={() => setPagina((p) => p - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pagina >= totalPaginas}
                      onClick={() => setPagina((p) => p + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {clienteFoco ? (
        <ClientePanel
          cliente={clienteFoco}
          onClose={() => setClienteAberto(null)}
          onPedido={(modo) => iniciarPedido(clienteFoco, modo)}
          onHistorico={() => {
            setHistoricoAberto(txt(clienteFoco["cliente_id"]));
            setClienteAberto(null);
          }}
          onContato={() => setContatoAberto(txt(clienteFoco["cliente_id"]))}
        />
      ) : null}

      {historicoAberto ? (
        <HistoricoDialog clienteId={historicoAberto} onClose={() => setHistoricoAberto(null)} />
      ) : null}

      {contatoAberto ? (
        <ContatoDialog
          clienteId={contatoAberto}
          rotaId={rotaId}
          userId={user?.id ?? null}
          onClose={() => setContatoAberto(null)}
          onSaved={() => {
            void carteira.refetch();
            void meta.refetch();
          }}
        />
      ) : null}

      <Dialog open={!!avisoLimite} onOpenChange={(o) => !o && setAvisoLimite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> Pedido acima do limite disponível
            </DialogTitle>
            <DialogDescription>
              O cliente não possui limite disponível para novos pedidos.
            </DialogDescription>
          </DialogHeader>
          {avisoLimite ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Info label="Limite" value={brl(avisoLimite.cliente["limite_credito"])} />
              <Info label="Em aberto" value={brl(avisoLimite.cliente["em_aberto"])} />
              <Info label="Vencido" value={brl(avisoLimite.cliente["vencido"])} danger />
              <Info
                label="Limite disponível"
                value={brl(avisoLimite.cliente["limite_disponivel"])}
                danger
              />
              <Info
                label="Excesso estimado"
                value={brl(Math.abs(num(avisoLimite.cliente["limite_disponivel"])))}
              />
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvisoLimite(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!podeGerir}
              title={podeGerir ? undefined : "Somente gestor ou admin pode liberar"}
              onClick={() => {
                if (!avisoLimite) return;
                criarPedido.mutate({
                  clienteId: txt(avisoLimite.cliente["cliente_id"]),
                  modo: avisoLimite.modo,
                });
                setAvisoLimite(null);
              }}
            >
              Enviar para aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

function Info({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate ${danger ? "font-medium text-destructive" : ""}`}>{value}</dd>
    </div>
  );
}

/** Visão rápida do cliente com financeiro, comercial, pedidos, produtos e sugestões. */
function ClientePanel({
  cliente,
  onClose,
  onPedido,
  onHistorico,
  onContato,
}: {
  cliente: Row;
  onClose: () => void;
  onPedido: (modo: string) => void;
  onHistorico: () => void;
  onContato: () => void;
}) {
  const { client } = useSupabase();
  const clienteId = txt(cliente["cliente_id"]);

  const pedidos = useQuery({
    queryKey: ["vw_lead_pedidos", clienteId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_pedidos")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("data_pedido", { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const produtos = useQuery({
    queryKey: ["vw_lead_produtos_cliente", clienteId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_produtos_cliente")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("frequencia", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const frequentes = produtos.data ?? [];
  const emFalta = frequentes.filter(
    (p) => num(p["frequencia"]) >= 2 && num(p["dias_ultima_compra"]) >= 30,
  );
  const zap = whatsappLink(cliente);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{txt(cliente["razao_social"])}</DialogTitle>
          <DialogDescription>
            {txt(cliente["rota"])} · {txt(cliente["representante"]) || "sem vendedor"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Bloco titulo="Cliente">
            <Info label="Telefone" value={txt(cliente["telefone"]) || "—"} />
            <Info label="WhatsApp" value={txt(cliente["whatsapp"]) || "—"} />
            <Info label="Cidade" value={txt(cliente["cidade"]) || "—"} />
            <Info label="Endereço" value={txt(cliente["endereco"]) || "—"} />
            <Info label="Rota" value={txt(cliente["rota"]) || "—"} />
            <Info label="Vendedor" value={txt(cliente["representante"]) || "—"} />
          </Bloco>

          <Bloco titulo="Financeiro">
            <Info label="Limite" value={brl(cliente["limite_credito"])} />
            <Info label="Disponível" value={brl(cliente["limite_disponivel"])} />
            <Info label="Em aberto" value={brl(cliente["em_aberto"])} />
            <Info label="Vencido" value={brl(cliente["vencido"])} danger={num(cliente["vencido"]) > 0} />
          </Bloco>

          <Bloco titulo="Comercial">
            <Info label="Último pedido" value={txt(cliente["ultimo_pedido_numero"]) || "—"} />
            <Info label="Última compra" value={fmtDate(cliente["ultima_compra"])} />
            <Info label="Ticket médio" value={brl(cliente["ticket_medio"])} />
            <Info label="Total comprado" value={brl(cliente["total_comprado"])} />
            <Info
              label="Dias sem comprar"
              value={
                num(cliente["dias_sem_comprar"]) >= 9999
                  ? "nunca comprou"
                  : `${num(cliente["dias_sem_comprar"])} dias`
              }
            />
            <Info
              label="Oportunidade"
              value={`${oportunidade(num(cliente["score_oportunidade"])).icon} ${
                oportunidade(num(cliente["score_oportunidade"])).label
              }`}
            />
          </Bloco>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Últimos pedidos
            </h4>
            {pedidos.isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (pedidos.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum pedido registrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Itens</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pedidos.data ?? []).map((p) => (
                      <TableRow key={txt(p["pedido_id"])}>
                        <TableCell className="font-medium">{txt(p["numero"])}</TableCell>
                        <TableCell>{fmtDate(p["data_pedido"])}</TableCell>
                        <TableCell>{txt(p["representante"]) || "—"}</TableCell>
                        <TableCell className="text-right">{num(p["qtd_itens"])}</TableCell>
                        <TableCell className="capitalize">
                          {txt(p["status"]).replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-right">{brl(p["total_liquido"])}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Produtos que este cliente costuma comprar
            </h4>
            {frequentes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem histórico de produtos.</p>
            ) : (
              <div className="max-h-56 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Última compra</TableHead>
                      <TableHead className="text-right">Qtde</TableHead>
                      <TableHead className="text-right">Preço médio</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Freq.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {frequentes.map((p) => (
                      <TableRow key={txt(p["produto_id"])}>
                        <TableCell>{txt(p["produto"])}</TableCell>
                        <TableCell>{txt(p["produto_codigo"])}</TableCell>
                        <TableCell>{fmtDate(p["ultima_compra"])}</TableCell>
                        <TableCell className="text-right">
                          {num(p["quantidade_total"]).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right">{brl(p["preco_medio"])}</TableCell>
                        <TableCell className="text-right">{brl(p["valor_total"])}</TableCell>
                        <TableCell className="text-right">{num(p["frequencia"])}x</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sugestões para este cliente
            </h4>
            <p className="text-xs text-muted-foreground">
              Baseado apenas no histórico real de compras deste cliente.
            </p>
            <p className="mt-2 text-xs font-medium">Costuma comprar e está sem comprar há 30+ dias</p>
            {emFalta.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nada em atraso no momento.</p>
            ) : (
              <ul className="list-inside list-disc text-xs">
                {emFalta.slice(0, 8).map((p) => (
                  <li key={txt(p["produto_id"])}>
                    {txt(p["produto"])} — última em {fmtDate(p["ultima_compra"])} ·{" "}
                    {num(p["frequencia"])}x comprado
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs font-medium">Mais comprados (oferecer novamente)</p>
            <ul className="list-inside list-disc text-xs">
              {frequentes.slice(0, 5).map((p) => (
                <li key={`top-${txt(p["produto_id"])}`}>
                  {txt(p["produto"])} — {num(p["frequencia"])}x ·{" "}
                  {num(p["quantidade_total"]).toLocaleString("pt-BR")} un
                </li>
              ))}
            </ul>
          </section>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button onClick={() => onPedido("vazio")}>
            <ShoppingCart className="size-4" /> Novo pedido
          </Button>
          <Button variant="outline" onClick={() => onPedido("ultimo")}>
            <Repeat className="size-4" /> Repetir último pedido
          </Button>
          <Button variant="outline" onClick={() => onPedido("frequentes")}>
            <ClipboardList className="size-4" /> Repetir produtos frequentes
          </Button>
          {zap ? (
            <Button variant="outline" asChild>
              <a href={zap} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={onHistorico}>
            <History className="size-4" /> Histórico
          </Button>
          <Button variant="ghost" onClick={onContato}>
            <Phone className="size-4" /> Registrar contato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h4>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</dl>
    </section>
  );
}

/** Histórico completo de pedidos e produtos comprados. */
function HistoricoDialog({
  clienteId,
  onClose,
}: {
  clienteId: string;
  onClose: () => void;
}) {
  const { client } = useSupabase();

  const pedidos = useQuery({
    queryKey: ["vw_lead_pedidos", "full", clienteId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_pedidos")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("data_pedido", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const produtos = useQuery({
    queryKey: ["vw_lead_produtos_cliente", "full", clienteId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_lead_produtos_cliente")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("valor_total", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Histórico de compras</DialogTitle>
          <DialogDescription>Pedidos anteriores e produtos comprados.</DialogDescription>
        </DialogHeader>
        {pedidos.isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <div className="space-y-5 text-sm">
            <div className="max-h-64 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pedidos.data ?? []).map((p) => (
                    <TableRow key={txt(p["pedido_id"])}>
                      <TableCell className="font-medium">{txt(p["numero"])}</TableCell>
                      <TableCell>{fmtDate(p["data_pedido"])}</TableCell>
                      <TableCell>{txt(p["representante"]) || "—"}</TableCell>
                      <TableCell className="text-right">{num(p["qtd_itens"])}</TableCell>
                      <TableCell className="capitalize">
                        {txt(p["status"]).replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-right">{brl(p["total_liquido"])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Produtos comprados
              </h4>
              <div className="max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Última compra</TableHead>
                      <TableHead className="text-right">Qtde</TableHead>
                      <TableHead className="text-right">Preço médio</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                      <TableHead className="text-right">Frequência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(produtos.data ?? []).map((p) => (
                      <TableRow key={txt(p["produto_id"])}>
                        <TableCell>{txt(p["produto"])}</TableCell>
                        <TableCell>{txt(p["produto_codigo"])}</TableCell>
                        <TableCell>{fmtDate(p["ultima_compra"])}</TableCell>
                        <TableCell className="text-right">
                          {num(p["quantidade_total"]).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right">{brl(p["preco_medio"])}</TableCell>
                        <TableCell className="text-right">{brl(p["valor_total"])}</TableCell>
                        <TableCell className="text-right">{num(p["frequencia"])}x</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Registro de contato do vendedor com o cliente da rota. */
function ContatoDialog({
  clienteId,
  rotaId,
  userId,
  onClose,
  onSaved,
}: {
  clienteId: string;
  rotaId: string;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client } = useSupabase();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    resultado: "contato_realizado",
    observacao: "",
    proximo_contato: "",
  });

  const historico = useQuery({
    queryKey: ["lead_contatos", clienteId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("lead_contatos")
        .select("id, resultado, observacao, proximo_contato, created_at")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.from("lead_contatos").insert({
        cliente_id: clienteId,
        rota_id: rotaId || null,
        resultado: form.resultado,
        observacao: form.observacao || null,
        proximo_contato: form.proximo_contato || null,
        responsavel: userId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Contato registrado");
      queryClient.invalidateQueries({ queryKey: ["lead_contatos", clienteId] });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>
            O resultado atualiza automaticamente a situação do cliente no funil da rota.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label>Resultado do contato</Label>
            <select
              value={form.resultado}
              onChange={(e) => setForm((s) => ({ ...s, resultado: e.target.value }))}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {resultadoOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Observação</Label>
            <Textarea
              value={form.observacao}
              onChange={(e) => setForm((s) => ({ ...s, observacao: e.target.value }))}
              rows={3}
            />
          </div>
          <div>
            <Label>Data do próximo contato</Label>
            <Input
              type="date"
              value={form.proximo_contato}
              onChange={(e) => setForm((s) => ({ ...s, proximo_contato: e.target.value }))}
            />
          </div>
          {(historico.data ?? []).length > 0 ? (
            <div className="rounded-md border border-border p-2 text-xs">
              <p className="mb-1 font-medium">Contatos anteriores</p>
              <ul className="space-y-1">
                {(historico.data ?? []).map((h) => (
                  <li key={txt(h["id"])} className="text-muted-foreground">
                    {fmtDate(h["created_at"])} ·{" "}
                    {resultadoOptions.find((o) => o.value === txt(h["resultado"]))?.label ??
                      txt(h["resultado"])}
                    {h["observacao"] ? ` — ${txt(h["observacao"])}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
            Salvar contato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
