import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
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
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/separacao")({
  head: () => ({
    meta: [
      { title: "Separação de pedidos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Lista de separação dos pedidos aprovados, por pedido ou por onda, com filtros por rota, cliente e status e impressão do romaneio de picking.",
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
  const { client } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<"pedido" | "onda">("pedido");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const lista = useQuery({
    queryKey: ["vw_separacao"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_separacao").select("*").order("numero");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
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
    };
  }, [lista.data]);

  const rows = useMemo(() => {
    let list = lista.data ?? [];
    if (centro) list = list.filter((r) => r["centro_id"] === centro);
    const f = filtros;
    if (f["rota"]) list = list.filter((r) => String(r["rota"] ?? "") === f["rota"]);
    if (f["status"]) list = list.filter((r) => String(r["status"]) === f["status"]);
    if (f["cliente"]) list = list.filter((r) => String(r["cliente"] ?? "") === f["cliente"]);
    if (f["centro"]) list = list.filter((r) => String(r["centro"] ?? "") === f["centro"]);
    if (f["pedido"]) list = list.filter((r) => String(r["numero"] ?? "").includes(f["pedido"]!));
    const termo = (f["produto"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (r) =>
          String(r["produto"] ?? "").toLowerCase().includes(termo) ||
          String(r["produto_codigo"] ?? "").toLowerCase().includes(termo),
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

  const avancar = useMutation({
    mutationFn: async (args: { pedidoId: string; status: string }) => {
      const { error } = await client!.rpc("avancar_pedido", {
        _pedido_id: args.pedidoId,
        _novo_status: args.status,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      queryClient.invalidateQueries();
    },
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
      { numero: string; cliente: string; status: string; rota: string; seq: string }
    >();
    for (const r of rows) {
      const rotaSeq = r["rota_sequencia"];
      const cliSeq = r["sequencia_entrega"];
      map.set(String(r["pedido_id"]), {
        numero: String(r["numero"]),
        cliente: String(r["cliente"] ?? "—"),
        status: String(r["status"]),
        rota: String(r["rota"] ?? "—"),
        seq: [
          rotaSeq ? `Sequência da rota: ${rotaSeq}` : null,
          cliSeq ? `Parada: ${cliSeq}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return [...map.entries()];
  }, [rows]);

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
    if (["separado", "em_rota", "entregue", "faturado"].includes(v))
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
      description="Pedidos aprovados aguardando picking. Filtre por rota, cliente ou status e imprima a lista de separação."
      actions={
        <div className="flex gap-2">
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
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
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
            label="Centro de custo"
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
        </FilterBar>

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
              {resumoFiltro || "Todos os pedidos"} · Emitida em{" "}
              {new Date().toLocaleString("pt-BR")}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            {pedidos.length} pedido(s) · {rows.length} item(ns)
          </p>

          {lista.isLoading ? (
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
              <table className="w-full min-w-[720px] text-sm">
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
                      <td className="px-4 py-2.5">{p.codigo}</td>
                      <td className="px-4 py-2.5">{p.produto}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{p.quantidade}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {p.pedidos.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nº</th>
                    <th className="px-4 py-2 text-left font-medium">Cliente</th>
                    <th className="px-4 py-2 text-left font-medium">Rota</th>
                    <th className="px-4 py-2 text-left font-medium">Sequência</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
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
                          <td className="px-4 py-2.5 font-semibold">#{p.numero}</td>
                          <td className="max-w-[320px] truncate px-4 py-2.5">{p.cliente}</td>
                          <td className="px-4 py-2.5">{p.rota}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {p.seq || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone(p.status)}`}
                            >
                              {p.status.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {itens.length}
                            {falta ? (
                              <span className="ml-1 text-[11px] font-medium text-destructive">
                                falta
                              </span>
                            ) : null}
                          </td>
                          <td className="no-print space-x-2 px-4 py-2.5 text-right">
                            {p.status === "aprovado" || p.status === "confirmado" ? (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  avancar.mutate({ pedidoId: id, status: "separacao" });
                                }}
                              >
                                Iniciar separação
                              </Button>
                            ) : null}
                            {p.status === "separacao" ? (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  avancar.mutate({ pedidoId: id, status: "separado" });
                                }}
                              >
                                Concluir separação
                              </Button>
                            ) : null}
                            {p.status === "separado" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  avancar.mutate({ pedidoId: id, status: "em_rota" });
                                }}
                              >
                                Enviar para rota
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                        <tr className={aberto ? "" : "hidden print:table-row"}>
                          <td colSpan={7} className="bg-muted/20 px-4 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Código</TableHead>
                                  <TableHead>Produto</TableHead>
                                  <TableHead className="text-right">Qtd.</TableHead>
                                  <TableHead className="text-right">Estoque</TableHead>
                                  <TableHead className="w-24">Separado</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {itens.map((r) => (
                                  <TableRow key={String(r["produto_id"])}>
                                    <TableCell>{String(r["produto_codigo"] ?? "—")}</TableCell>
                                    <TableCell>{String(r["produto"])}</TableCell>
                                    <TableCell className="text-right">
                                      {String(r["quantidade"])}
                                    </TableCell>
                                    <TableCell
                                      className={`text-right ${
                                        Number(r["estoque_atual"] ?? 0) <
                                        Number(r["quantidade"] ?? 0)
                                          ? "text-destructive"
                                          : ""
                                      }`}
                                    >
                                      {String(r["estoque_atual"])}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">______</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}

