import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Printer, Trash2 } from "lucide-react";
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
  const [filtros, setFiltros] = useState<Record<string, string>>({});
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
      title="Tabelas de preço"
      description="A tabela mais específica vence: cliente, depois UF, depois prioridade. Sem tabela vigente, vale o preço do produto."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="mb-4">
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar tabela"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder="Nome da tabela..."
          />
          <FilterSelect
            label="Status"
            value={filtros["ativo"] ?? ""}
            onChange={(v) => setF("ativo", v)}
            options={[
              { value: "true", label: "Ativa" },
              { value: "false", label: "Inativa" },
            ]}
          />
        </FilterBar>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="space-y-4">
          {canManage && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Nova tabela</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Nome</Label>
                  <Input
                    value={head["nome"] ?? ""}
                    onChange={(e) => setHead((f) => ({ ...f, nome: e.target.value }))}
                    placeholder="Tabela padrão 2026"
                  />
                </div>
                <div>
                  <Label>Cliente (opcional)</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={head["cliente_id"] ?? ""}
                    onChange={(e) => setHead((f) => ({ ...f, cliente_id: e.target.value }))}
                  >
                    <option value="">Todos os clientes</option>
                    {(clientes.data ?? []).map((c) => (
                      <option key={String(c["id"])} value={String(c["id"])}>
                        {String(c["razao_social"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>UF (opcional)</Label>
                  <Input
                    value={head["uf"] ?? ""}
                    maxLength={2}
                    onChange={(e) => setHead((f) => ({ ...f, uf: e.target.value }))}
                    placeholder="SP"
                  />
                </div>
                <div>
                  <Label>Vigência início</Label>
                  <Input
                    type="date"
                    value={head["vigencia_inicio"] ?? ""}
                    onChange={(e) => setHead((f) => ({ ...f, vigencia_inicio: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Vigência fim</Label>
                  <Input
                    type="date"
                    value={head["vigencia_fim"] ?? ""}
                    onChange={(e) => setHead((f) => ({ ...f, vigencia_fim: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Input
                    type="number"
                    value={head["prioridade"] ?? ""}
                    onChange={(e) => setHead((f) => ({ ...f, prioridade: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={criar.isPending}
                    onClick={() => criar.mutate()}
                  >
                    <Plus className="size-4" /> Criar tabela
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="print-area rounded-lg border border-border bg-card">
            {tabelas.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : tabelas.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(tabelas.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase7_precos_devolucoes_metas_config.sql</code> no SQL Editor do
                  Supabase.
                </p>
              </div>
            ) : tabelasFiltradas.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma tabela de preço encontrada.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead className="text-right">Prior.</TableHead>
                    <TableHead>Ativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tabelasFiltradas.map((t) => (
                    <TableRow
                      key={String(t["id"])}
                      onClick={() => setSelected(String(t["id"]))}
                      className={`cursor-pointer ${selected === t["id"] ? "bg-muted/60" : ""}`}
                    >
                      <TableCell className="font-medium">{String(t["nome"])}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t["cliente_id"]
                          ? String(
                              clientes.data?.find((c) => c["id"] === t["cliente_id"])?.[
                                "razao_social"
                              ] ?? "cliente",
                            )
                          : t["uf"]
                            ? `UF ${String(t["uf"])}`
                            : "Geral"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(t["vigencia_inicio"])} → {String(t["vigencia_fim"] ?? "—")}
                      </TableCell>
                      <TableCell className="text-right">{String(t["prioridade"])}</TableCell>
                      <TableCell className="no-print">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAtivo.mutate(t);
                          }}
                        >
                          {t["ativo"] ? "Sim" : "Não"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">
              {selected ? "Preços da tabela selecionada" : "Selecione uma tabela"}
            </h2>
            {selected && canManage && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                        preco: String(p?.["preco_venda"] ?? f.preco),
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
                  <Label>Preço</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.preco}
                    onChange={(e) => setItem((f) => ({ ...f, preco: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Desconto máx. (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.desconto_maximo}
                    onChange={(e) => setItem((f) => ({ ...f, desconto_maximo: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    className="w-full"
                    disabled={addItem.isPending}
                    onClick={() => addItem.mutate()}
                  >
                    <Plus className="size-4" /> Salvar preço
                  </Button>
                </div>
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded-lg border border-border bg-card">
              {itens.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando...
                </div>
              ) : (itens.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum produto nesta tabela.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Desc. máx.</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.data!.map((i) => (
                      <TableRow key={String(i["id"])}>
                        <TableCell>{nomeProduto(i["produto_id"])}</TableCell>
                        <TableCell className="text-right">{brl(i["preco"])}</TableCell>
                        <TableCell className="text-right">
                          {Number(i["desconto_maximo"] ?? 0)}%
                        </TableCell>
                        <TableCell className="no-print text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={!canManage}
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
          )}
        </section>
      </div>
    </ErpLayout>
  );
}
