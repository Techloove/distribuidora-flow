import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
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
    return list;
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
    const map = new Map<string, { numero: string; cliente: string; status: string; rota: string }>();
    for (const r of rows) {
      map.set(String(r["pedido_id"]), {
        numero: String(r["numero"]),
        cliente: String(r["cliente"] ?? "—"),
        status: String(r["status"]),
        rota: String(r["rota"] ?? "—"),
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
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : lista.isError ? (
            <p className="rounded-lg border border-border bg-card p-5 text-sm text-destructive">
              {(lista.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-border bg-card py-14 text-center text-sm text-muted-foreground">
              Nenhum pedido neste filtro.
            </p>
          ) : modo === "onda" ? (
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd. total</TableHead>
                    <TableHead>Pedidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porProduto.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.codigo}</TableCell>
                      <TableCell>{p.produto}</TableCell>
                      <TableCell className="text-right font-medium">{p.quantidade}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.pedidos.join(", ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-4">
              {pedidos.map(([id, p]) => (
                <section key={id} className="rounded-lg border border-border bg-card">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                    <div>
                      <p className="text-sm font-semibold">
                        Pedido #{p.numero} · {p.cliente}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Status: {p.status} · Rota: {p.rota}
                      </p>
                    </div>
                    <div className="no-print flex gap-2">
                      {p.status === "aprovado" || p.status === "confirmado" ? (
                        <Button
                          size="sm"
                          onClick={() => avancar.mutate({ pedidoId: id, status: "separacao" })}
                        >
                          Iniciar separação
                        </Button>
                      ) : null}
                      {p.status === "separacao" ? (
                        <Button
                          size="sm"
                          onClick={() => avancar.mutate({ pedidoId: id, status: "separado" })}
                        >
                          Concluir separação
                        </Button>
                      ) : null}
                      {p.status === "separado" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => avancar.mutate({ pedidoId: id, status: "em_rota" })}
                        >
                          Enviar para rota
                        </Button>
                      ) : null}
                    </div>
                  </header>
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
                      {rows
                        .filter((r) => r["pedido_id"] === id)
                        .map((r) => (
                          <TableRow key={String(r["produto_id"])}>
                            <TableCell>{String(r["produto_codigo"] ?? "—")}</TableCell>
                            <TableCell>{String(r["produto"])}</TableCell>
                            <TableCell className="text-right">{String(r["quantidade"])}</TableCell>
                            <TableCell
                              className={`text-right ${
                                Number(r["estoque_atual"] ?? 0) < Number(r["quantidade"] ?? 0)
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
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
