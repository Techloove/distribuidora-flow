import { ReferenciaRegistro } from "@/components/referencia-registro";
import {
  SeparacaoLote,
  AcoesAposSeparacao,
  type PedidoSeparacaoLote,
} from "@/components/separacao-lote";
import { EmitirBoletosPedido } from "@/components/emitir-boletos-pedido";
import { ConcluirSeparacaoPratica } from "@/components/logistica-pratica";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { ImprimirPedidos } from "@/components/imprimir-pedidos";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCentroValido } from "@/lib/centros-acesso";
import { lerPaginas } from "@/lib/paginacao";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/separacao")({
  head: () => ({
    meta: [
      { title: "Separação de pedidos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Seleção de pedidos, filtros operacionais, relatórios consolidados por produto ou cliente e conclusão da separação em lote.",
      },
      { property: "og:title", content: "Separação de pedidos — ERP Distribuidora" },
      { property: "og:description", content: "Picking por pedido ou por onda de separação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SeparacaoPage,
});

type Row = Record<string, unknown>;

function SeparacaoPage() {
  const { client, user, roles } = useSupabase();
  const cv = useCentroValido();
  const { centro } = cv;
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<"pedido" | "onda">("pedido");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [selecao, setSelecao] = useState<{ chave: string; ids: string[] }>({ chave: "", ids: [] });
  const [concluidos, setConcluidos] = useState<PedidoSeparacaoLote[]>([]);
  const chaveSelecao = JSON.stringify([filtros, centro, user?.id]);
  const [selected, setSelected] = useState<string | null>(null);
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const lista = useQuery({
    queryKey: ["vw_separacao", user?.id, roles.slice().sort().join(","), centro],
    enabled: !!client && !cv.isLoading && !cv.error,
    refetchInterval: 30_000,
    queryFn: async () =>
      lerPaginas<Row>((inicio, fim) => {
        let consulta = client!.from("vw_separacao").select("*");
        if (centro) consulta = consulta.eq("centro_id", centro);
        return consulta.order("numero").order("pedido_id").order("item_id").range(inicio, fim);
      }),
  });

  const opcoes = useMemo(() => {
    const list = lista.data ?? [];
    const uniq = (key: string) =>
      [...new Set(list.map((r) => String(r[key] ?? "")).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v }));
    return {
      rotas: uniq("rota"),
      status: uniq("status"),
      clientes: uniq("cliente"),
      centros: uniq("centro"),
      cidades: uniq("cidade"),
      representantes: uniq("representante"),
    };
  }, [lista.data]);

  const rows = useMemo(() => {
    let list = lista.data ?? [];
    if (centro) list = list.filter((r) => r["centro_id"] === centro);
    const f = filtros;
    if (f["cidade"]) list = list.filter((r) => String(r["cidade"] ?? "") === f["cidade"]);
    if (f["representante"])
      list = list.filter((r) => String(r["representante"] ?? "") === f["representante"]);
    if (f["de"]) list = list.filter((r) => String(r["data_pedido"] ?? "").slice(0, 10) >= f["de"]!);
    if (f["ate"])
      list = list.filter((r) => String(r["data_pedido"] ?? "").slice(0, 10) <= f["ate"]!);
    if (f["rota"]) list = list.filter((r) => String(r["rota"] ?? "") === f["rota"]);
    if (f["status"]) list = list.filter((r) => String(r["status"]) === f["status"]);
    if (f["cliente"]) list = list.filter((r) => String(r["cliente"] ?? "") === f["cliente"]);
    if (f["centro"]) list = list.filter((r) => String(r["centro"] ?? "") === f["centro"]);
    if (f["pedido"]) list = list.filter((r) => String(r["numero"] ?? "").includes(f["pedido"]!));
    const termo = (f["produto"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (r) =>
          String(r["produto"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(r["produto_codigo"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    if (f["somenteFalta"] === "1") {
      list = list.filter((r) => Number(r["estoque_atual"] ?? 0) < Number(r["quantidade"] ?? 0));
    }
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? 9999 : Number(v));
    return [...list].sort(
      (a, b) =>
        num(a["rota_sequencia"]) - num(b["rota_sequencia"]) ||
        String(a["rota"] ?? "").localeCompare(String(b["rota"] ?? "")) ||
        num(a["sequencia_entrega"]) - num(b["sequencia_entrega"]) ||
        String(a["numero"] ?? "").localeCompare(String(b["numero"] ?? ""), "pt-BR", {
          numeric: true,
        }),
    );
  }, [lista.data, centro, filtros]);

  const rpc = useMutation({
    mutationFn: async (args: { fn: string; params: Record<string, unknown> }) => {
      const { error } = await client!.rpc(args.fn, args.params);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Separação atualizada");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrar = useMutation({
    mutationFn: async (args: {
      itemId: string;
      quantidade: number;
      acao?: string | null;
      obs?: string | null;
    }) => {
      const { error } = await client!.rpc("registrar_separacao_item", {
        _item_id: args.itemId,
        _quantidade: args.quantidade,
        _acao: args.acao ?? null,
        _obs: args.obs ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });

  /** Agrupamento por onda: soma a quantidade do mesmo produto em vários pedidos. */
  const porProduto = useMemo(() => {
    const map = new Map<
      string,
      { produto: string; codigo: string; quantidade: number; pedidos: string[] }
    >();
    for (const r of rows) {
      const key = String(r["produto_id"]);
      const atual = map.get(key) ?? {
        produto: String(r["produto"]),
        codigo: String(r["produto_codigo"] ?? ""),
        quantidade: 0,
        pedidos: [],
      };
      atual.quantidade += Number(r["quantidade"] ?? 0);
      atual.pedidos.push(String(r["numero"]));
      map.set(key, atual);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [rows]);

  const pedidos = useMemo(() => {
    const map = new Map<
      string,
      {
        numero: string;
        intermediacao: boolean;
        centroId: string;
        cliente: string;
        clienteId: unknown;
        status: string;
        rota: string;
        seq: string;
        romaneio: string;
      }
    >();
    for (const r of rows) {
      const rotaSeq = r["rota_sequencia"];
      const cliSeq = r["sequencia_entrega"];
      map.set(String(r["pedido_id"]), {
        numero: String(r["numero"]),
        intermediacao: r["modalidade_venda"] === "intermediacao",
        centroId: String(r["centro_id"] ?? ""),
        cliente: String(r["cliente"] ?? "—"),
        clienteId: r["cliente_id"],
        status: String(r["status"]),
        rota: String(r["rota"] ?? "—"),
        romaneio: r["romaneio_numero"]
          ? `#${String(r["romaneio_numero"])}${
              r["expedicao_status"] ? ` · ${String(r["expedicao_status"]).replace(/_/g, " ")}` : ""
            }`
          : "—",
        seq: [rotaSeq ? `Sequência da rota: ${rotaSeq}` : null, cliSeq ? `Parada: ${cliSeq}` : null]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return [...map.entries()];
  }, [rows]);

  const idsVisiveis = new Set(pedidos.map(([id]) => id));
  const marcados =
    selecao.chave === chaveSelecao ? selecao.ids.filter((id) => idsVisiveis.has(id)) : [];
  const marcar = (ids: string[]) => setSelecao({ chave: chaveSelecao, ids });
  const metadados = pedidos.map(([id, p]) => ({ id, ...p }));
  const aposConcluir = (lista: PedidoSeparacaoLote[]) => {
    setConcluidos(lista);
    marcar([]);
  };

  const resumoFiltro = [
    filtros["rota"] ? `Rota: ${filtros["rota"]}` : null,
    filtros["status"] ? `Status: ${filtros["status"]}` : null,
    filtros["cliente"] ? `Cliente: ${filtros["cliente"]}` : null,
    filtros["centro"] ? `Centro: ${filtros["centro"]}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const statusTone = (s: string) => {
    const v = s.toLowerCase();
    if (v.startsWith("cancel")) return "bg-destructive/10 text-destructive";
    if (
      [
        "separado",
        "conferido",
        "em_rota",
        "entregue",
        "faturado",
        "nf_emitida",
        "em_carga",
      ].includes(v)
    )
      return "bg-primary/15 text-primary";
    if (["aprovado", "confirmado"].includes(v)) return "bg-emerald-500/15 text-emerald-600";
    if (v === "separacao") return "bg-amber-500/15 text-amber-600";
    return "bg-secondary text-secondary-foreground";
  };

  const itensFalta = rows.filter(
    (r) => Number(r["estoque_atual"] ?? 0) < Number(r["quantidade"] ?? 0),
  ).length;

  const statusResumo = (() => {
    const m = new Map<string, number>();
    for (const [, p] of pedidos) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  return (
    <ErpLayout
      title="Separação"
      description="Separe e confira os produtos. Concluir a separação libera o pedido para montagem da carga."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={lista.isFetching || cv.isLoading || !!cv.error}
            onClick={() => void lista.refetch()}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
          <Button
            variant={modo === "pedido" ? "default" : "outline"}
            onClick={() => setModo("pedido")}
          >
            Por pedido
          </Button>
          <Button variant={modo === "onda" ? "default" : "outline"} onClick={() => setModo("onda")}>
            Por onda
          </Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={rows.length === 0}>
            <Printer className="size-4" /> Imprimir lista do filtro
          </Button>
          <ImprimirPedidos
            pedidoIds={pedidos.map(([id]) => id)}
            label="Imprimir todos os pedidos do filtro"
          />
        </div>
      }
    >
      <div className="space-y-4">
        <details className="no-print rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Como separar e liberar os pedidos para entrega
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Em Pedidos, finalize a aprovação e confirmação da venda e envie os pedidos desejados
              para separação.
            </li>
            <li>
              Aqui, filtre e selecione os pedidos. Imprima os itens consolidados para separar os
              produtos juntos, ou o relatório por cliente para organizar cada pedido.
            </li>
            <li>
              Confira fisicamente produtos e quantidades. Se houver falta ou diferença, abra o
              pedido e registre/revise a quantidade separada antes de concluir.
            </li>
            <li>
              Use Concluir separação, individualmente ou nos selecionados, e confirme apenas se
              todos os itens estiverem completos e conferidos. As quantidades ainda não preenchidas
              serão registradas como completas; divergências já registradas bloqueiam essa
              confirmação.
            </li>
            <li>
              Após concluir, os pedidos ficam prontos para carga. Você pode imprimir cópias e
              escolher os boletos. Em Cargas de entrega, monte a carga com os pedidos separados da
              mesma rota, confira motorista/veículo e despache quando sair.
            </li>
            <li>
              Em Entregas, registre a entrega com data, nome de quem recebeu e comprovante. Só essa
              etapa formaliza o recebimento pelo cliente.
            </li>
          </ol>
        </details>
        <FilterBar onClear={() => setFiltros({})}>
          <FilterSelect
            label="Rota"
            value={filtros["rota"] ?? ""}
            onChange={(v) => setF("rota", v)}
            options={opcoes.rotas}
            allLabel="Todas as rotas"
          />
          <FilterSelect
            label="Status"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={opcoes.status}
          />
          <FilterSelect
            label="Cliente"
            value={filtros["cliente"] ?? ""}
            onChange={(v) => setF("cliente", v)}
            options={opcoes.clientes}
          />
          <FilterSelect
            label="Loja"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={opcoes.centros}
          />
          <FilterText
            label="Nº do pedido"
            value={filtros["pedido"] ?? ""}
            onChange={(v) => setF("pedido", v)}
          />
          <FilterText
            label="Produto (código ou descrição)"
            value={filtros["produto"] ?? ""}
            onChange={(v) => setF("produto", v)}
          />
          <FilterSelect
            label="Estoque"
            value={filtros["somenteFalta"] ?? ""}
            onChange={(v) => setF("somenteFalta", v)}
            options={[{ value: "1", label: "Somente itens em falta" }]}
            allLabel="Todos os itens"
          />
          <FilterSelect
            label="Cidade"
            value={filtros["cidade"] ?? ""}
            onChange={(v) => setF("cidade", v)}
            options={opcoes.cidades}
          />
          <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={opcoes.representantes}
          />
          <FilterText
            label="Data do pedido de"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Data do pedido até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
        </FilterBar>
        <div className="no-print flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            disabled={!pedidos.length}
            onClick={() => marcar(pedidos.map(([id]) => id))}
          >
            Selecionar todos do filtro ({pedidos.length})
          </Button>
          <Button variant="ghost" disabled={!marcados.length} onClick={() => marcar([])}>
            Limpar seleção
          </Button>
          <span className="text-sm">{marcados.length} selecionado(s)</span>
        </div>
        <SeparacaoLote
          pedidos={metadados.filter((p) => marcados.includes(p.id))}
          linhas={lista.data ?? []}
          onConcluido={aposConcluir}
        />
        {!!concluidos.length && (
          <AcoesAposSeparacao
            key={concluidos.map((p) => p.id).join(",")}
            pedidos={concluidos}
            onClose={() => setConcluidos([])}
          />
        )}

        <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
          {[
            { label: "Pedidos", value: String(pedidos.length) },
            { label: "Itens", value: String(rows.length) },
            { label: "Em falta", value: String(itensFalta) },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="truncate text-sm font-semibold">{k.value}</p>
            </div>
          ))}
        </div>

        {statusResumo.length > 0 ? (
          <div className="no-print flex flex-wrap gap-1.5">
            <button
              onClick={() => setF("status", "")}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                !filtros["status"]
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Todos ({pedidos.length})
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

        <div className="print-area space-y-4">
          <div className="print-only mb-2">
            <h2 className="text-base font-semibold">
              Lista de separação {modo === "onda" ? "(por onda)" : "(por pedido)"}
            </h2>
            <p className="text-xs">
              {resumoFiltro || "Todos os pedidos"} · Emitida em {new Date().toLocaleString("pt-BR")}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            {pedidos.length} pedido(s) · {rows.length} item(ns)
          </p>

          {cv.error ? (
            <p role="alert" className="rounded-lg border bg-card p-5 text-sm text-destructive">
              {cv.error.message}
            </p>
          ) : lista.isLoading || cv.isLoading ? (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : lista.isError ? (
            <p className="rounded-lg border border-border bg-card p-5 text-sm text-destructive">
              {(lista.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-border bg-card py-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhum pedido neste filtro.</p>
              <Button variant="link" onClick={() => setFiltros({})} className="text-xs">
                Limpar filtros
              </Button>
            </div>
          ) : modo === "onda" ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table className="mobile-cards w-full min-w-[720px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Código</th>
                    <th className="px-4 py-2 text-left font-medium">Produto</th>
                    <th className="px-4 py-2 text-right font-medium">Qtd. total</th>
                    <th className="px-4 py-2 text-left font-medium">Pedidos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {porProduto.map((p) => (
                    <tr key={p.id} className="hover:bg-accent/50">
                      <td data-label="Código" className="px-4 py-2.5">
                        {p.codigo}
                      </td>
                      <td data-label="Produto" className="px-4 py-2.5">
                        {p.produto}
                      </td>
                      <td data-label="Qtd. total" className="px-4 py-2.5 text-right font-semibold">
                        {p.quantidade}
                      </td>
                      <td
                        data-label="Pedidos"
                        className="px-4 py-2.5 text-xs text-muted-foreground"
                      >
                        {p.pedidos.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table className="mobile-cards w-full min-w-[860px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="no-print px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos os pedidos do filtro"
                        checked={!!pedidos.length && marcados.length === pedidos.length}
                        onChange={(e) => marcar(e.target.checked ? pedidos.map(([id]) => id) : [])}
                      />
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Nº</th>
                    <th className="px-4 py-2 text-left font-medium">Cliente</th>
                    <th className="px-4 py-2 text-left font-medium">Rota</th>
                    <th className="px-4 py-2 text-left font-medium">Sequência</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Expedição</th>
                    <th className="px-4 py-2 text-right font-medium">Itens</th>
                    <th className="no-print px-4 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pedidos.map(([id, p]) => {
                    const itens = rows.filter((r) => r["pedido_id"] === id);
                    const aberto = selected === id;
                    const falta = itens.some(
                      (r) => Number(r["estoque_atual"] ?? 0) < Number(r["quantidade"] ?? 0),
                    );
                    return (
                      <Fragment key={id}>
                        <tr
                          onClick={() => setSelected(aberto ? null : id)}
                          className={`cursor-pointer border-l-2 transition-colors ${
                            aberto
                              ? "border-l-primary bg-accent"
                              : "border-l-transparent hover:border-l-primary/40 hover:bg-accent/50"
                          }`}
                        >
                          <td
                            data-label="Selecionar"
                            className="no-print px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Selecionar pedido ${p.numero}`}
                              checked={marcados.includes(id)}
                              onChange={(e) =>
                                marcar(
                                  e.target.checked
                                    ? [...marcados, id]
                                    : marcados.filter((x) => x !== id),
                                )
                              }
                            />
                          </td>
                          <td data-label="Nº" className="px-4 py-2.5 font-semibold">
                            <ReferenciaRegistro tipo="pedido" id={id}>
                              #{p.numero}
                            </ReferenciaRegistro>
                          </td>
                          <td data-label="Cliente" className="max-w-[320px] truncate px-4 py-2.5">
                            <ReferenciaRegistro tipo="cliente" id={p.clienteId}>
                              {p.cliente}
                            </ReferenciaRegistro>
                            {p.intermediacao && (
                              <span className="mt-1 block w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                                Entrega direta • fábrica
                              </span>
                            )}
                          </td>
                          <td data-label="Rota" className="px-4 py-2.5">
                            {p.rota}
                          </td>
                          <td
                            data-label="Sequência"
                            className="px-4 py-2.5 text-xs text-muted-foreground"
                          >
                            {p.seq || "—"}
                          </td>
                          <td data-label="Status" className="px-4 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone(p.status)}`}
                            >
                              {p.status.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td
                            data-label="Expedição"
                            className="px-4 py-2.5 text-xs text-muted-foreground"
                          >
                            {p.romaneio}
                          </td>
                          <td data-label="Itens" className="px-4 py-2.5 text-right">
                            {itens.length}
                            {falta ? (
                              <span className="ml-1 text-[11px] font-medium text-destructive">
                                falta
                              </span>
                            ) : null}
                          </td>
                          <td
                            data-label="Ações"
                            className="no-print space-x-2 px-4 py-2.5 text-right"
                          >
                            <ImprimirPedidos pedidoIds={[id]} compact />
                            <EmitirBoletosPedido pedidoId={id} centroId={p.centroId} compact />
                            {p.status === "confirmado" ? (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rpc.mutate({
                                    fn: "iniciar_separacao",
                                    params: { _pedido_id: id },
                                  });
                                }}
                              >
                                Iniciar separação
                              </Button>
                            ) : null}
                            {["separacao", "separado"].includes(p.status) ? (
                              <ConcluirSeparacaoPratica
                                pedidoId={id}
                                numero={p.numero}
                                onConcluido={() => aposConcluir([{ id, ...p }])}
                              />
                            ) : null}
                            {p.status === "conferido" ? (
                              <span className="text-[11px] text-emerald-600">
                                Liberado para montar carga
                              </span>
                            ) : null}
                          </td>
                        </tr>
                        <tr className={aberto ? "" : "hidden print:table-row"}>
                          <td colSpan={9} className="bg-muted/20 px-4 py-3">
                            <Table className="mobile-cards">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Código</TableHead>
                                  <TableHead>Produto</TableHead>
                                  <TableHead className="text-right">Pedido</TableHead>
                                  <TableHead className="text-right">Estoque</TableHead>
                                  <TableHead className="w-28 text-right">Separado</TableHead>
                                  <TableHead className="text-right">Falta</TableHead>
                                  <TableHead>Situação</TableHead>
                                  <TableHead className="no-print w-44">
                                    Tratamento da divergência
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {itens.map((r) => {
                                  const itemId = String(r["item_id"] ?? "");
                                  const pedida = Number(r["quantidade"] ?? 0);
                                  const sep = r["quantidade_separada"];
                                  const separada =
                                    sep === null || sep === undefined ? null : Number(sep);
                                  const falta = separada === null ? null : pedida - separada;
                                  const editavel = p.status === "separacao";
                                  return (
                                    <TableRow key={itemId || String(r["produto_id"])}>
                                      <TableCell data-label="Código">
                                        {String(r["produto_codigo"] ?? "—")}
                                      </TableCell>
                                      <TableCell data-label="Produto">
                                        {String(r["produto"])}
                                      </TableCell>
                                      <TableCell data-label="Pedido" className="text-right">
                                        {pedida}
                                      </TableCell>
                                      <TableCell
                                        data-label="Estoque"
                                        className={`text-right ${
                                          Number(r["estoque_atual"] ?? 0) < pedida
                                            ? "text-destructive"
                                            : ""
                                        }`}
                                      >
                                        {String(r["estoque_atual"])}
                                      </TableCell>
                                      <TableCell data-label="Separado" className="text-right">
                                        {editavel ? (
                                          <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            defaultValue={separada ?? ""}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={(e) => {
                                              const v = e.target.value;
                                              if (v === "") return;
                                              if (Number(v) === separada) return;
                                              registrar.mutate({
                                                itemId,
                                                quantidade: Number(v),
                                                acao: String(r["divergencia_acao"] ?? "") || null,
                                              });
                                            }}
                                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm"
                                          />
                                        ) : (
                                          <span>{separada ?? "—"}</span>
                                        )}
                                      </TableCell>
                                      <TableCell
                                        data-label="Falta"
                                        className={`text-right ${falta ? "text-destructive" : ""}`}
                                      >
                                        {falta === null ? "—" : falta}
                                      </TableCell>
                                      <TableCell data-label="Situação" className="text-xs">
                                        {separada === null ? (
                                          <span className="text-muted-foreground">pendente</span>
                                        ) : falta === 0 ? (
                                          <span className="text-emerald-600">OK</span>
                                        ) : (
                                          <span className="font-medium text-destructive">
                                            divergência
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell
                                        data-label="Tratamento da divergência"
                                        className="no-print"
                                      >
                                        {editavel && separada !== null && falta !== 0 ? (
                                          <select
                                            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
                                            value={String(r["divergencia_acao"] ?? "")}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) =>
                                              registrar.mutate({
                                                itemId,
                                                quantidade: separada,
                                                acao: e.target.value || null,
                                              })
                                            }
                                          >
                                            <option value="">Definir…</option>
                                            <option value="aguardar">Aguardar produto</option>
                                            <option value="alterar_quantidade">
                                              Alterar quantidade
                                            </option>
                                            <option value="retirar_item">Retirar item</option>
                                            <option value="substituir">Substituir item</option>
                                            <option value="cancelar_item">Cancelar item</option>
                                            <option value="outro">Outra situação</option>
                                          </select>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">
                                            {String(r["divergencia_acao"] ?? "—").replace(
                                              /_/g,
                                              " ",
                                            )}
                                          </span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
