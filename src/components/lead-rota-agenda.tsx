import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ClipboardList,
  Flame,
  History,
  HandCoins,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Repeat,
  ShoppingCart,
  User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { brl } from "@/lib/formatacao";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
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
import { useCentroValido } from "@/lib/centros-acesso";
import { useAcesso } from "@/lib/permissoes";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { RESULTADOS_CONTATO, type AgendaFiltros } from "@/lib/agenda-comercial";
import { useSupabase } from "@/lib/supabase-provider";

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

const resultadoOptions = RESULTADOS_CONTATO;

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

type Contadores = {
  total: number;
  contatados: number;
  naoContatados: number;
  pedidos: number;
  negociacao: number;
  semInteresse: number;
  atencao90: number;
  atencao60: number;
  atencao30: number;
};
const CONTADORES_VAZIOS: Contadores = {
  total: 0,
  contatados: 0,
  naoContatados: 0,
  pedidos: 0,
  negociacao: 0,
  semInteresse: 0,
  atencao90: 0,
  atencao60: 0,
  atencao30: 0,
};
export function LeadRotaAgenda({
  filtros: compartilhados,
  onCobrar,
}: {
  filtros: AgendaFiltros;
  onCobrar: (cliente: Row) => void;
}) {
  const { client, roles, user } = useSupabase();
  const cv = useCentroValido();
  const { centro } = cv;
  const perm = usePermissoesRotinas();
  const rotaId = compartilhados.rota;
  const [filtros, setFiltros] = useState<Record<string, string>>({ ordem: "oportunidade" });
  const setF = (k: string, v: string) => {
    setFiltros((s) => ({ ...s, [k]: v }));
    setPagina(1);
  };
  const [pagina, setPagina] = useState(1);
  const [clienteAberto, setClienteAberto] = useState<string | null>(null);
  const [contatoAberto, setContatoAberto] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState<string | null>(null);
  const { criarPedido, iniciarPedido, avisoLimite, setAvisoLimite, podeGerir, podeCriarPedido } =
    useLeadPedido(rotaId);

  const carteira = useQuery({
    queryKey: [
      "agenda_leads_229",
      user?.id,
      roles.slice().sort().join(","),
      centro,
      compartilhados,
      filtros,
      pagina,
    ],
    enabled: !!client && !!rotaId && perm.pode("lead_rota_operar") && !cv.isLoading && !cv.error,
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_leads_229", {
        _rota: rotaId,
        _centro: centro || null,
        _representante: compartilhados.representante || null,
        _cidade: compartilhados.cidade,
        _busca: compartilhados.busca,
        _classificacao: filtros["classificacao"] || "",
        _funil: filtros["funil"] || "",
        _ordem: filtros["ordem"] || "oportunidade",
        _pagina: pagina,
      });
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase229 no Supabase para integrar o Lead Rota."
            : error.message,
        );
      return data as { rows: Row[]; count: number; contadores: Contadores; meta: Row };
    },
  });
  const lista = carteira.data?.rows ?? [];
  const paginada = lista;
  const totalPaginas = Math.max(1, Math.ceil((carteira.data?.count ?? 0) / PAGE_SIZE));
  const contadores = carteira.data?.contadores ?? CONTADORES_VAZIOS;
  const meta = { data: carteira.data?.meta };
  const clienteFoco = lista.find((r) => txt(r["cliente_id"]) === (clienteAberto ?? "")) ?? null;

  return (
    <div className="space-y-5">
      {cv.error && (
        <p role="alert" className="text-sm text-destructive">
          {cv.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Trabalhe a rota com oportunidades, funil, histórico e pedidos. Os contatos ficam
          integrados aos acompanhamentos da Agenda Comercial.
        </p>
        {rotaId && (
          <Button variant="outline" onClick={() => void carteira.refetch()}>
            <RefreshCw className="size-4" />
            Atualizar rota
          </Button>
        )}
      </div>
      {!rotaId ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum cliente é carregado antes da escolha da rota. Selecione o filtro Rota acima para
          abrir a carteira.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["Clientes da rota", contadores.total],
              ["Contatados", contadores.contatados],
              ["Ainda não contatados", contadores.naoContatados],
              ["Pedidos realizados", contadores.pedidos],
              ["Em negociação", contadores.negociacao],
              ["Sem interesse", contadores.semInteresse],
            ].map(([label, valor]) => (
              <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{valor}</p>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
            <div className="rounded-lg border border-border bg-card p-3 col-span-2">
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
            <FilterSelect
              label="Classificação"
              value={filtros["classificacao"] ?? ""}
              onChange={(v) => setF("classificacao", v)}
              options={classificacoes}
              allLabel="Todos"
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
                        <Info label="Situação" value={funilLabels[txt(c["funil_status"])] ?? "—"} />
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
                        <Button
                          size="sm"
                          disabled={criarPedido.isPending || !podeCriarPedido}
                          onClick={() => iniciarPedido(c, "vazio")}
                        >
                          <ShoppingCart className="size-3.5" /> Novo pedido
                        </Button>
                        {num(c["em_aberto"]) > 0 && perm.pode("cobranca_acompanhar") && (
                          <Button size="sm" variant="outline" onClick={() => onCobrar(c)}>
                            <HandCoins className="size-3.5" />
                            Cobrar cliente
                          </Button>
                        )}
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
                  {carteira.data?.count ?? 0} cliente(s) · página {pagina} de {totalPaginas}
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

      {clienteFoco ? (
        <ClientePanel
          cliente={clienteFoco}
          podeCriarPedido={podeCriarPedido && !criarPedido.isPending}
          onClose={() => setClienteAberto(null)}
          onPedido={(modo) => iniciarPedido(clienteFoco, modo)}
          onHistorico={() => {
            setHistoricoAberto(txt(clienteFoco["cliente_id"]));
            setClienteAberto(null);
          }}
          onContato={() => {
            setClienteAberto(null);
            setContatoAberto(txt(clienteFoco["cliente_id"]));
          }}
        />
      ) : null}

      {historicoAberto ? (
        <HistoricoDialog clienteId={historicoAberto} onClose={() => setHistoricoAberto(null)} />
      ) : null}

      {contatoAberto ? (
        <ContatoDialog
          clienteId={contatoAberto}
          rotaId={rotaId}
          onClose={() => setContatoAberto(null)}
          onSaved={() => {
            void carteira.refetch();
          }}
        />
      ) : null}

      <LimiteLeadDialog
        avisoLimite={avisoLimite}
        setAvisoLimite={setAvisoLimite}
        criarPedido={criarPedido}
        podeGerir={podeGerir}
      />
    </div>
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
  podeCriarPedido,
  onClose,
  onPedido,
  onHistorico,
  onContato,
}: {
  cliente: Row;
  podeCriarPedido: boolean;
  onClose: () => void;
  onPedido: (modo: string) => void;
  onHistorico: () => void;
  onContato: () => void;
}) {
  const { client } = useSupabase();
  const clienteId = txt(cliente["cliente_id"]);

  const historico = useLeadHistorico(clienteId);
  const pedidos = { data: historico.data?.pedidos, isLoading: historico.isPending };
  const produtos = { data: historico.data?.produtos };

  const frequentes = produtos.data ?? [];
  const emFalta = frequentes.filter(
    (p) => num(p["frequencia"]) >= 2 && num(p["dias_ultima_compra"]) >= 30,
  );
  const zap = whatsappLink(cliente);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        {historico.error && (
          <p role="alert" className="text-sm text-destructive">
            {historico.error.message}
          </p>
        )}
        {historico.data &&
          (historico.data.count_pedidos > 200 || historico.data.count_produtos > 200) && (
            <p className="text-xs text-muted-foreground">
              Exibindo até os últimos 200 pedidos e 200 produtos mais frequentes neste filtro.
            </p>
          )}
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
            <Info
              label="Vencido"
              value={brl(cliente["vencido"])}
              danger={num(cliente["vencido"]) > 0}
            />
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
            <p className="mt-2 text-xs font-medium">
              Costuma comprar e está sem comprar há 30+ dias
            </p>
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
          <Button disabled={!podeCriarPedido} onClick={() => onPedido("vazio")}>
            <ShoppingCart className="size-4" /> Novo pedido
          </Button>
          <Button disabled={!podeCriarPedido} variant="outline" onClick={() => onPedido("ultimo")}>
            <Repeat className="size-4" /> Repetir último pedido
          </Button>
          <Button
            disabled={!podeCriarPedido}
            variant="outline"
            onClick={() => onPedido("frequentes")}
          >
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
function HistoricoDialog({ clienteId, onClose }: { clienteId: string; onClose: () => void }) {
  const { client } = useSupabase();

  const historico = useLeadHistorico(clienteId);
  const pedidos = { data: historico.data?.pedidos, isLoading: historico.isPending };
  const produtos = { data: historico.data?.produtos };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        {historico.error && (
          <p role="alert" className="text-sm text-destructive">
            {historico.error.message}
          </p>
        )}
        {historico.data &&
          (historico.data.count_pedidos > 200 || historico.data.count_produtos > 200) && (
            <p className="text-xs text-muted-foreground">
              Exibindo até os últimos 200 pedidos e 200 produtos mais frequentes neste filtro.
            </p>
          )}
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
  onClose,
  onSaved,
}: {
  clienteId: string;
  rotaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client, user, roles } = useSupabase();
  const { centro } = useCentroValido();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    resultado: "contato_realizado",
    observacao: "",
    proximo_contato: "",
  });

  const historico = useQuery({
    queryKey: ["lead_contatos", clienteId, user?.id, roles.slice().sort().join(","), centro],
    enabled: !!client,
    queryFn: async () => {
      let consulta = client!
        .from("lead_contatos")
        .select("id, resultado, observacao, proximo_contato, created_at")
        .eq("cliente_id", clienteId);
      if (centro) consulta = consulta.or(`centro_id.eq.${centro},centro_id.is.null`);
      const { data, error } = await consulta.order("created_at", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("agenda_registrar_contato_229", {
        _cliente: clienteId,
        _rota: rotaId || null,
        _resultado: form.resultado,
        _observacao: form.observacao || null,
        _proximo: form.proximo_contato || null,
        _centro: centro || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Contato registrado");
      queryClient.invalidateQueries({
        queryKey: ["lead_contatos", clienteId, user?.id, roles.slice().sort().join(","), centro],
      });
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
              aria-label="Resultado do contato"
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
              aria-label="Observação do contato"
              maxLength={4000}
              value={form.observacao}
              onChange={(e) => setForm((s) => ({ ...s, observacao: e.target.value }))}
              rows={3}
            />
          </div>
          <div>
            <Label>Data do próximo contato</Label>
            <Input
              type="date"
              aria-label="Data do próximo contato"
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
            {salvar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Flame className="size-4" />
            )}
            Salvar contato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useLeadPedido(rotaId: string) {
  const { client, roles } = useSupabase();
  const { centro } = useCentroValido();
  const acesso = useAcesso();
  const perm = usePermissoesRotinas();
  const navigate = useNavigate(),
    queryClient = useQueryClient();
  const podeGerir = roles.some((r) => r === "admin" || r === "gestor");
  const [avisoLimite, setAvisoLimite] = useState<{ cliente: Row; modo: string } | null>(null);
  const criarPedido = useMutation({
    mutationFn: async ({ clienteId, modo }: { clienteId: string; modo: string }) => {
      if (!acesso.pode("/pedidos") || !perm.pode("lead_rota_operar"))
        throw new Error("Sem permissão para criar pedidos pela agenda");
      const { data, error } = await client!.rpc("lead_criar_pedido", {
        _cliente_id: clienteId,
        _modo: modo,
        _rota_id: rotaId || null,
        _centro_id: centro || null,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    onSuccess: (id) => {
      toast.success("Pedido criado com cliente, vendedor, rota e condições preenchidos");
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["agenda_leads_229"] });
      navigate({ to: "/pedidos", search: { pedido: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function iniciarPedido(cliente: Row, modo: string) {
    if (num(cliente["limite_credito"]) > 0 && num(cliente["limite_disponivel"]) <= 0) {
      setAvisoLimite({ cliente, modo });
      return;
    }
    criarPedido.mutate({ clienteId: txt(cliente["cliente_id"]), modo });
  }

  return {
    criarPedido,
    iniciarPedido,
    avisoLimite,
    setAvisoLimite,
    podeGerir,
    podeCriarPedido: acesso.pode("/pedidos") && perm.pode("lead_rota_operar"),
  };
}
function LimiteLeadDialog({
  avisoLimite,
  setAvisoLimite,
  criarPedido,
  podeGerir,
}: Pick<
  ReturnType<typeof useLeadPedido>,
  "avisoLimite" | "setAvisoLimite" | "criarPedido" | "podeGerir"
>) {
  return (
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
  );
}

function useLeadHistorico(clienteId: string) {
  const { client, user, roles } = useSupabase(),
    { centro } = useCentroValido();
  return useQuery({
    queryKey: [
      "agenda_lead_historico_229",
      user?.id,
      roles.slice().sort().join(","),
      clienteId,
      centro,
    ],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_lead_historico_229", {
        _cliente: clienteId,
        _centro: centro || null,
      });
      if (error) throw new Error(error.message);
      return data as {
        pedidos: Row[];
        produtos: Row[];
        count_pedidos: number;
        count_produtos: number;
      };
    },
  });
}
export function AcoesLeadCliente({ clienteId }: { clienteId: string }) {
  const { client, user, roles } = useSupabase(),
    { centro } = useCentroValido(),
    perm = usePermissoesRotinas();
  const [modo, setModo] = useState<"cliente" | "historico" | "contato" | null>(null);
  const cliente = useQuery({
    queryKey: [
      "agenda_lead_cliente_229",
      user?.id,
      roles.slice().sort().join(","),
      clienteId,
      centro,
    ],
    enabled: !!client && modo !== null && perm.pode("lead_rota_operar"),
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_lead_cliente_229", {
        _cliente: clienteId,
        _centro: centro || null,
      });
      if (error) throw new Error(error.message);
      return data as Row;
    },
  });
  const pedido = useLeadPedido(txt(cliente.data?.["rota_id"]));
  if (!perm.pode("lead_rota_operar")) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setModo("cliente")}>
          <User className="size-3.5" />
          Visão completa do cliente
        </Button>
        <Button size="sm" variant="outline" onClick={() => setModo("historico")}>
          <History className="size-3.5" />
          Histórico de compras
        </Button>
      </div>
      {modo && cliente.isPending && <p className="text-xs">Carregando cliente…</p>}
      {modo && cliente.error && (
        <p role="alert" className="text-sm text-destructive">
          {cliente.error.message}
        </p>
      )}
      {modo === "cliente" && cliente.data && (
        <ClientePanel
          cliente={cliente.data}
          podeCriarPedido={pedido.podeCriarPedido && !pedido.criarPedido.isPending}
          onClose={() => setModo(null)}
          onPedido={(m) => pedido.iniciarPedido(cliente.data!, m)}
          onHistorico={() => setModo("historico")}
          onContato={() => setModo("contato")}
        />
      )}
      {modo === "historico" && cliente.data && (
        <HistoricoDialog clienteId={clienteId} onClose={() => setModo(null)} />
      )}
      {modo === "contato" && cliente.data && (
        <ContatoDialog
          clienteId={clienteId}
          rotaId={txt(cliente.data["rota_id"])}
          onClose={() => setModo(null)}
          onSaved={() => void cliente.refetch()}
        />
      )}
      <LimiteLeadDialog {...pedido} />
    </div>
  );
}
