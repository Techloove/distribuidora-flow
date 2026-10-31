import { getModalidade } from "@/lib/modalidade-store";
import { ReferenciaRegistro } from "@/components/referencia-registro";
import { idReferencia } from "@/lib/referencias-registros";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { TrocaDevolucao } from "@/components/rotinas-distribuidora";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/devolucoes")({
  validateSearch: (search: Record<string, unknown>): { pedido?: string | undefined } => ({
    pedido: idReferencia(search["pedido"]),
  }),
  head: () => ({
    meta: [
      { title: "Devoluções de venda — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Registre devoluções de clientes com retorno automático ao estoque e crédito no contas a receber.",
      },
      { property: "og:title", content: "Devoluções de venda — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Devoluções com retorno de estoque e crédito financeiro auditado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevolucoesPage,
});

type Row = Record<string, unknown>;

function DevolucoesPage() {
  const { pedido: pedidoReferencia } = Route.useSearch();
  const { client, canManage: gestao } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const canManage = gestao && permissoes.pode("devolucao_operar");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [head, setHead] = useState({
    cliente_id: "",
    pedido_id: "",
    centro_id: "",
    data_devolucao: new Date().toISOString().slice(0, 10),
    motivo: "",
  });
  const referenciaAplicada = useRef("");
  const origem = useQuery({
    queryKey: ["devolucao-origem", pedidoReferencia],
    enabled: !!client && !!pedidoReferencia,
    queryFn: async () => {
      const r = await client!
        .from("pedidos")
        .select("id,cliente_id,centro_id")
        .eq("id", pedidoReferencia!)
        .single();
      if (r.error) throw new Error("Pedido indisponível para devolução.");
      return r.data;
    },
  });
  useEffect(() => {
    if (origem.data && pedidoReferencia && referenciaAplicada.current !== pedidoReferencia) {
      referenciaAplicada.current = pedidoReferencia;
      setHead((f) => ({
        ...f,
        pedido_id: pedidoReferencia,
        cliente_id: String(origem.data.cliente_id),
        centro_id: String(origem.data.centro_id ?? ""),
      }));
    }
  }, [origem.data, pedidoReferencia]);
  const [item, setItem] = useState({
    produto_id: "",
    quantidade: "1",
    preco_unitario: "0",
    condicao: "revenda",
  });
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const devolucoes = useQuery({
    queryKey: [...["devolucoes"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("devolucoes")
        .select("*")
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clientes = useQuery({
    queryKey: [...["clientes", "options"], getModalidade()],
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

  const centros = useQuery({
    queryKey: [...["centros", "options", "devolucoes"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const pedidos = useQuery({
    queryKey: [...["pedidos", "faturados", head.cliente_id], getModalidade()],
    enabled: !!client && !!head.cliente_id,
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select("id, numero, total_liquido")
        .eq("cliente_id", head.cliente_id)
        .in("status", [
          "confirmado",
          "separacao",
          "separado",
          "conferido",
          "faturado",
          "nf_emitida",
          "em_carga",
          "em_rota",
          "entregue",
          "parcial",
          "nao_entregue",
          "devolvido",
        ])
        .order("numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const produtos = useQuery({
    queryKey: [...["produtos", "options", "devolucoes"], getModalidade()],
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
    queryKey: ["devolucao_itens", selected],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from("devolucao_itens")
        .select("*")
        .eq("devolucao_id", selected!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const doc = devolucoes.data?.find((d) => d["id"] === selected) ?? null;
  const nomeProduto = (id: unknown) => {
    const p = produtos.data?.find((x) => x["id"] === id);
    return p ? `${String(p["codigo"] ?? "")} ${String(p["descricao"])}`.trim() : "—";
  };
  const cliName = useCallback(
    (id: unknown) => String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—"),
    [clientes.data],
  );
  const centroName = (id: unknown) =>
    String(centros.data?.find((c) => c["id"] === id)?.["nome"] ?? "—");

  const rows = useMemo(() => {
    let list = devolucoes.data ?? [];
    const f = filtros;
    if (f["status"]) list = list.filter((d) => String(d["status"]) === f["status"]);
    if (f["centro"]) list = list.filter((d) => d["centro_id"] === f["centro"]);
    if (f["de"]) list = list.filter((d) => String(d["data_devolucao"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((d) => String(d["data_devolucao"] ?? "") <= f["ate"]!);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (d) =>
          String(d["numero"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          cliName(d["cliente_id"]).toLowerCase().includes(termo) ||
          String(d["motivo"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    return list;
  }, [devolucoes.data, filtros, cliName]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["devolucoes"] });
    queryClient.invalidateQueries({ queryKey: ["devolucao_itens", selected] });
    queryClient.invalidateQueries({ queryKey: ["contas_receber"] });
    queryClient.invalidateQueries({ queryKey: ["produtos"] });
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!head.cliente_id) throw new Error("Selecione o cliente");
      const { data, error } = await client!
        .from("devolucoes")
        .insert({
          cliente_id: head.cliente_id,
          pedido_id: head.pedido_id || null,
          centro_id: head.centro_id || null,
          data_devolucao: head.data_devolucao,
          motivo: head.motivo.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
    onSuccess: (data) => {
      toast.success("Devolução criada");
      setSelected(String(data["id"]));
      setHead((f) => ({ ...f, pedido_id: "", motivo: "" }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione uma devolução");
      if (!item.produto_id) throw new Error("Selecione o produto");
      const { error } = await client!.from("devolucao_itens").insert({
        devolucao_id: selected,
        produto_id: item.produto_id,
        quantidade: Number(item.quantidade || 0),
        preco_unitario: Number(item.preco_unitario || 0),
        condicao: item.condicao,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setItem({ produto_id: "", quantidade: "1", preco_unitario: "0", condicao: "revenda" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from("devolucao_itens").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("confirmar_devolucao", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Devolução confirmada: estoque e crédito atualizados");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("cancelar_devolucao", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Devolução cancelada");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ErpLayout
      title="Devoluções de venda"
      description="Confirmar devolve os itens ao estoque e gera um crédito para o cliente."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="space-y-4">
          <FilterBar onClear={() => setFiltros({})}>
            <FilterText
              label="Buscar (nº/cliente/motivo)"
              value={filtros["busca"] ?? ""}
              onChange={(v) => setF("busca", v)}
            />
            <FilterSelect
              label="Status"
              value={filtros["status"] ?? ""}
              onChange={(v) => setF("status", v)}
              options={[
                { value: "rascunho", label: "Rascunho" },
                { value: "confirmada", label: "Confirmada" },
                { value: "cancelada", label: "Cancelada" },
              ]}
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
            <FilterText
              label="De"
              type="date"
              value={filtros["de"] ?? ""}
              onChange={(v) => setF("de", v)}
            />
            <FilterText
              label="Até"
              type="date"
              value={filtros["ate"] ?? ""}
              onChange={(v) => setF("ate", v)}
            />
          </FilterBar>

          {canManage && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Nova devolução</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Cliente</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={head.cliente_id}
                    onChange={(e) =>
                      setHead((f) => ({ ...f, cliente_id: e.target.value, pedido_id: "" }))
                    }
                  >
                    <option value="">Selecione...</option>
                    {(clientes.data ?? []).map((c) => (
                      <option key={String(c["id"])} value={String(c["id"])}>
                        {String(c["razao_social"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Pedido de origem (opcional)</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={head.pedido_id}
                    onChange={(e) => setHead((f) => ({ ...f, pedido_id: e.target.value }))}
                  >
                    <option value="">Sem pedido</option>
                    {(pedidos.data ?? []).map((p) => (
                      <option key={String(p["id"])} value={String(p["id"])}>
                        #{String(p["numero"])} — {brl(p["total_liquido"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Centro</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={head.centro_id}
                    onChange={(e) => setHead((f) => ({ ...f, centro_id: e.target.value }))}
                  >
                    <option value="">Sem centro</option>
                    {(centros.data ?? []).map((c) => (
                      <option key={String(c["id"])} value={String(c["id"])}>
                        {String(c["nome"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={head.data_devolucao}
                    onChange={(e) => setHead((f) => ({ ...f, data_devolucao: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Motivo</Label>
                  <Input
                    value={head.motivo}
                    onChange={(e) => setHead((f) => ({ ...f, motivo: e.target.value }))}
                    placeholder="Avaria no transporte"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    className="w-full"
                    disabled={criar.isPending}
                    onClick={() => criar.mutate()}
                  >
                    <Plus className="size-4" /> Criar devolução
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="print-area rounded-lg border border-border bg-card">
            {devolucoes.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : devolucoes.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(devolucoes.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase7_precos_devolucoes_metas_config.sql</code> no SQL Editor do
                  Supabase.
                </p>
              </div>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma devolução neste filtro.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow
                      key={String(d["id"])}
                      onClick={() => setSelected(String(d["id"]))}
                      className={`cursor-pointer ${selected === d["id"] ? "bg-muted/60" : ""}`}
                    >
                      <TableCell>#{String(d["numero"])}</TableCell>
                      <TableCell>
                        <ReferenciaRegistro tipo="cliente" id={d["cliente_id"]}>
                          {cliName(d["cliente_id"])}
                        </ReferenciaRegistro>
                      </TableCell>
                      <TableCell>{String(d["data_devolucao"])}</TableCell>
                      <TableCell className="text-right">{brl(d["valor_total"])}</TableCell>
                      <TableCell>{String(d["status"])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        <section className="space-y-4">
          {!doc ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Selecione uma devolução para lançar itens.
            </p>
          ) : (
            <>
              <TrocaDevolucao key={String(doc["id"])} devolucao={doc} />
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Devolução #{String(doc["numero"])}</p>
                    <p className="text-xs text-muted-foreground">
                      <ReferenciaRegistro tipo="cliente" id={doc["cliente_id"]}>
                        {cliName(doc["cliente_id"])}
                      </ReferenciaRegistro>{" "}
                      · {String(doc["status"])}
                    </p>
                  </div>
                  <p className="text-lg font-semibold">{brl(doc["valor_total"])}</p>
                </div>

                {doc["status"] === "rascunho" && canManage && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label>Produto</Label>
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={item.produto_id}
                        onChange={(e) => {
                          const p = produtos.data?.find((x) => x["id"] === e.target.value);
                          setItem((f) => ({
                            ...f,
                            produto_id: e.target.value,
                            preco_unitario: String(p?.["preco_venda"] ?? f.preco_unitario),
                          }));
                        }}
                      >
                        <option value="">Selecione...</option>
                        {(produtos.data ?? []).map((p) => (
                          <option key={String(p["id"])} value={String(p["id"])}>
                            {nomeProduto(p["id"])}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Quantidade</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={item.quantidade}
                        onChange={(e) => setItem((f) => ({ ...f, quantidade: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Preço unitário</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.preco_unitario}
                        onChange={(e) => setItem((f) => ({ ...f, preco_unitario: e.target.value }))}
                      />
                    </div>
                    <label className="block text-sm sm:col-span-2">
                      Condição do produto
                      <select
                        className="mt-1 w-full rounded border bg-background p-2"
                        aria-label="Condição do produto"
                        value={item.condicao}
                        onChange={(e) => setItem((i) => ({ ...i, condicao: e.target.value }))}
                      >
                        <option value="revenda">Apto para revenda: retorna ao estoque</option>
                        <option value="avaria">
                          Avariado: crédito sem retornar ao estoque disponível
                        </option>
                      </select>
                    </label>
                    <div className="sm:col-span-2 flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={addItem.isPending}
                        onClick={() => addItem.mutate()}
                      >
                        <Plus className="size-4" /> Adicionar item
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={confirmar.isPending}
                        onClick={() => confirmar.mutate(String(doc["id"]))}
                      >
                        Confirmar devolução
                      </Button>
                    </div>
                  </div>
                )}

                {doc["status"] !== "cancelada" && canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate(String(doc["id"]))}
                  >
                    Cancelar devolução
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card">
                {itens.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Carregando...
                  </div>
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
                        <TableHead className="text-right">Preço</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.data!.map((i) => (
                        <TableRow key={String(i["id"])}>
                          <TableCell>
                            {nomeProduto(i["produto_id"])}
                            <p className="text-xs text-muted-foreground">
                              {i["condicao"] === "avaria"
                                ? "Avariado — fora do estoque disponível"
                                : "Apto para revenda"}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(i["quantidade"] ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">{brl(i["preco_unitario"])}</TableCell>
                          <TableCell className="text-right">{brl(i["total"])}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={!canManage || doc["status"] !== "rascunho"}
                              onClick={() => removeItem.mutate(String(i["id"]))}
                            >
                              <Trash2 className="size-4" />
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
      </div>
    </ErpLayout>
  );
}
