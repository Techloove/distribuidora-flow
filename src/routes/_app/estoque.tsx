import { SeletorProdutoEstoque } from "@/components/seletor-produto-estoque";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { setCentro } from "@/lib/centro-store";
import { lerPaginas } from "@/lib/paginacao";
import { DepositosInventario } from "@/components/depositos-inventario";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useCallback, useMemo, useState, useEffect } from "react";
import { toast } from "sonner";

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
import { useCentroValido } from "@/lib/centros-acesso";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque e movimentações — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Saldos por produto, alertas de estoque mínimo e lançamento de entradas, saídas e ajustes de inventário.",
      },
      { property: "og:title", content: "Estoque e movimentações — ERP Distribuidora" },
      { property: "og:description", content: "Saldos, alertas e histórico de movimentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstoquePage,
});

type Row = Record<string, unknown>;

function EstoquePage() {
  const { client, roles } = useSupabase();
  const {
    centro,
    lista: lojas,
    isLoading: centrosCarregando,
    error: centrosErro,
  } = useCentroValido();
  const [aba, setAba] = useState("movimentar");
  const [sentidoAjuste, setSentidoAjuste] = useState("acrescentar");
  const queryClient = useQueryClient();
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const [form, setForm] = useState({
    produto_id: "",
    tipo: "entrada",
    quantidade: "1",
    custo: "",
    observacao: "",
  });

  const canStock =
    roles.includes("admin") ||
    roles.includes("gestor") ||
    roles.includes("estoque") ||
    roles.includes("expedicao");

  const produtos = useQuery({
    queryKey: ["produtos", "estoque"],
    enabled: !!client,
    queryFn: async () => {
      return await lerPaginas<Row>((inicio, fim) =>
        client!
          .from("produtos")
          .select("id,codigo,descricao,unidade,estoque_atual,estoque_minimo,custo_medio")
          .order("id")
          .range(inicio, fim),
      );
    },
  });

  const disponibilidade = useQuery({
    queryKey: ["estoque_disponivel", "loja", centro],
    enabled: !!client && !!centro,
    queryFn: async () =>
      await lerPaginas<Row>((inicio, fim) =>
        client!
          .rpc("saldos_estoque_loja_271", { _centro: centro })
          .order("produto_id")
          .range(inicio, fim),
      ),
  });
  const produtosDaLoja = useMemo(() => {
    const ids = new Set((disponibilidade.data ?? []).map((r) => String(r["produto_id"])));
    return (produtos.data ?? []).filter((p) => ids.has(String(p["id"])));
  }, [produtos.data, disponibilidade.data]);
  useEffect(() => {
    setForm((f) => ({ ...f, produto_id: "", quantidade: "1", custo: "", observacao: "" }));
  }, [centro]);
  const reservadoProduto = (produto: unknown) =>
    disponibilidade.data
      ?.filter((r) => r["produto_id"] === produto)
      .reduce((s, r) => s + Number(r["reservado"]), 0);
  const movimentos = useQuery({
    queryKey: ["estoque_movimentos", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!
        .from("estoque_movimentos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const lancar = useMutation({
    mutationFn: async () => {
      if (!form.produto_id || !produtosDaLoja.some((p) => p["id"] === form.produto_id))
        throw new Error("Selecione um produto da loja atual");
      const qtd = Number(form.quantidade || 0);
      if (!Number.isFinite(qtd) || qtd <= 0)
        throw new Error("Informe uma quantidade maior que zero");
      if (
        form.tipo === "entrada" &&
        form.custo !== "" &&
        (!Number.isFinite(Number(form.custo)) || Number(form.custo) < 0)
      )
        throw new Error("Informe um custo válido");
      if (!centro) throw new Error("Selecione um centro para movimentar o estoque");
      const { error } = await client!.rpc("lancar_movimento_estoque", {
        _produto_id: form.produto_id,
        _centro_id: centro,
        _tipo: form.tipo,
        _quantidade: form.tipo === "ajuste" && sentidoAjuste === "retirar" ? -qtd : qtd,
        _custo_unitario: form.tipo !== "entrada" || form.custo === "" ? null : Number(form.custo),
        _origem: "manual",
        _documento_id: null,
        _observacao: form.observacao || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Movimento lançado");
      setForm((f) => ({ ...f, quantidade: "", custo: "", observacao: "" }));
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mapaSaldos = useMemo(
    () =>
      new Map(
        (disponibilidade.data ?? []).map((r) => [String(r["produto_id"]), Number(r["fisico"])]),
      ),
    [disponibilidade.data],
  );
  const saldoProduto = useCallback((id: unknown) => mapaSaldos.get(String(id)) ?? 0, [mapaSaldos]);

  const produtoName = useCallback(
    (id: unknown) => String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? "—"),
    [produtos.data],
  );

  const produtosFiltrados = useMemo(() => {
    let list = produtosDaLoja;
    const f = filtros;
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (p) =>
          String(p["descricao"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(p["codigo"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    if (f["somenteAbaixo"] === "1") {
      list = list.filter((p) => saldoProduto(p["id"]) <= Number(p["estoque_minimo"] ?? 0));
    }
    return list;
  }, [produtosDaLoja, filtros, saldoProduto]);

  const movimentosFiltrados = useMemo(() => {
    let list = movimentos.data ?? [];
    const f = filtros;
    if (f["tipo"]) list = list.filter((m) => String(m["tipo"]) === f["tipo"]);
    if (f["de"]) list = list.filter((m) => String(m["created_at"] ?? "").slice(0, 10) >= f["de"]!);
    if (f["ate"])
      list = list.filter((m) => String(m["created_at"] ?? "").slice(0, 10) <= f["ate"]!);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (m) =>
          produtoName(m["produto_id"]).toLowerCase().includes(termo) ||
          String(produtos.data?.find((p) => p["id"] === m["produto_id"])?.["codigo"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    return list;
  }, [movimentos.data, filtros, produtoName, produtos.data]);

  return (
    <ErpLayout
      title="Estoque"
      description="Cada loja movimenta o próprio estoque no depósito vinculado a ela."
      actions={
        aba === "saldos" || aba === "historico" ? (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" />
            {aba === "saldos" ? "Imprimir saldos" : "Imprimir histórico"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {disponibilidade.error && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível consultar o estoque da loja. Confira a fase271 no Supabase e atualize a
            página.
          </p>
        )}
        <Tabs value={aba} onValueChange={setAba} className="space-y-5">
          <TabsList
            className="h-auto w-full flex-wrap justify-start gap-1"
            aria-label="Opções de estoque"
          >
            <TabsTrigger value="movimentar">Movimentar</TabsTrigger>
            <TabsTrigger value="saldos">Consultar saldos</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="depositos">Depósitos e inventário</TabsTrigger>
          </TabsList>
          <TabsContent value="movimentar" className="space-y-4">
            {!centro && (
              <p className="rounded-lg border p-3 text-sm">
                Selecione a loja para consultar e movimentar o estoque dela.
              </p>
            )}
            <form
              className="mx-auto max-w-3xl space-y-5 rounded-xl border bg-card p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!lancar.isPending) lancar.mutate();
              }}
            >
              <div>
                <h2 className="text-lg font-semibold">Movimentar estoque</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escolha a operação, o produto e a quantidade.
                </p>
              </div>
              <fieldset disabled={!canStock || lancar.isPending} className="space-y-5">
                <div className="space-y-2">
                  <Label>O que deseja fazer?</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { tipo: "entrada", nome: "Entrada" },
                      { tipo: "saida", nome: "Saída" },
                      { tipo: "ajuste", nome: "Ajuste" },
                    ].map((t) => (
                      <Button
                        key={t.tipo}
                        type="button"
                        variant={form.tipo === t.tipo ? "default" : "outline"}
                        aria-pressed={form.tipo === t.tipo}
                        onClick={() => setForm((f) => ({ ...f, tipo: t.tipo }))}
                      >
                        {t.nome}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {form.tipo === "entrada"
                      ? "Acrescenta produtos ao saldo físico."
                      : form.tipo === "saida"
                        ? "Retira produtos do saldo físico. Pedidos confirmados já baixam estoque; não lance a mesma saída novamente."
                        : "Corrige uma diferença no saldo. Para conferir uma contagem completa, use Depósitos e inventário."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estoque-produto">Produto</Label>
                  <SeletorProdutoEstoque
                    id="estoque-produto"
                    produtos={produtosDaLoja}
                    value={form.produto_id}
                    onChange={(produto_id) => setForm((f) => ({ ...f, produto_id }))}
                    disabled={
                      !centro ||
                      disponibilidade.isPending ||
                      disponibilidade.isError ||
                      produtos.isPending ||
                      produtos.isError ||
                      lancar.isPending
                    }
                  />
                </div>
                {form.produto_id && (
                  <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                    {[
                      { nome: "Saldo físico", valor: saldoProduto(form.produto_id) },
                      { nome: "Reservado", valor: reservadoProduto(form.produto_id) ?? 0 },
                      {
                        nome: "Disponível",
                        valor:
                          saldoProduto(form.produto_id) - (reservadoProduto(form.produto_id) ?? 0),
                      },
                    ].map((s) => (
                      <div key={s.nome}>
                        <p className="text-xs text-muted-foreground">{s.nome}</p>
                        <p className="font-semibold">
                          {disponibilidade.isPending || disponibilidade.isError ? "—" : s.valor}{" "}
                          {String(
                            produtos.data?.find((p) => p["id"] === form.produto_id)?.["unidade"] ??
                              "",
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="estoque-quantidade">
                      Quantidade{" "}
                      {form.tipo === "entrada"
                        ? "a adicionar"
                        : form.tipo === "saida"
                          ? "a retirar"
                          : "da diferença"}
                    </Label>
                    <Input
                      id="estoque-quantidade"
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      value={form.quantidade}
                      onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))}
                    />
                  </div>
                  {form.tipo === "ajuste" && (
                    <div className="space-y-2">
                      <Label htmlFor="estoque-sentido">Como corrigir?</Label>
                      <select
                        id="estoque-sentido"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={sentidoAjuste}
                        onChange={(e) => setSentidoAjuste(e.target.value)}
                      >
                        <option value="acrescentar">Acrescentar ao saldo</option>
                        <option value="retirar">Retirar do saldo</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estoque-loja">Loja do lançamento</Label>
                  <select
                    id="estoque-loja"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={centro}
                    onChange={(e) => setCentro(e.target.value)}
                    required
                    disabled={centrosCarregando}
                  >
                    <option value="">Selecione a loja</option>
                    {lojas.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Entradas e saídas usam somente o depósito desta loja.
                  </p>
                </div>
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {form.tipo === "entrada"
                      ? "Custo e observação (opcional)"
                      : "Adicionar observação (opcional)"}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {form.tipo === "entrada" && (
                      <div className="space-y-1">
                        <Label htmlFor="estoque-custo">Custo por unidade (R$)</Label>
                        <Input
                          id="estoque-custo"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.custo}
                          onChange={(e) => setForm((f) => ({ ...f, custo: e.target.value }))}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor="estoque-observacao">Observação</Label>
                      <Textarea
                        id="estoque-observacao"
                        value={form.observacao}
                        onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
                        placeholder="Ex.: reposição recebida, avaria ou correção de saldo"
                      />
                    </div>
                  </div>
                </details>
                <Button
                  className="w-full sm:w-auto"
                  type="submit"
                  disabled={
                    !canStock ||
                    !centro ||
                    !form.produto_id ||
                    !Number.isFinite(Number(form.quantidade)) ||
                    Number(form.quantidade) <= 0 ||
                    lancar.isPending ||
                    centrosCarregando ||
                    disponibilidade.isError ||
                    !disponibilidade.data
                  }
                >
                  {lancar.isPending && <Loader2 className="size-4 animate-spin" />}
                  {lancar.isPending
                    ? "Registrando..."
                    : form.tipo === "entrada"
                      ? "Registrar entrada"
                      : form.tipo === "saida"
                        ? "Registrar saída"
                        : "Registrar ajuste"}
                </Button>
                {(!Number.isFinite(Number(form.quantidade)) || Number(form.quantidade) <= 0) && (
                  <p role="status" className="text-xs text-destructive">
                    Informe uma quantidade maior que zero para registrar.
                  </p>
                )}
                {!form.produto_id && (
                  <p className="text-xs text-muted-foreground">
                    Selecione um produto para continuar.
                  </p>
                )}
              </fieldset>
              {!canStock && (
                <p className="text-sm text-muted-foreground">
                  Seu perfil permite consultar o estoque. Lançamentos exigem permissão de estoque,
                  expedição, gestor ou administrador.
                </p>
              )}
              {(produtos.error || centrosErro) && (
                <p role="alert" className="text-sm text-destructive">
                  {(produtos.error ?? centrosErro)?.message}
                </p>
              )}
            </form>
          </TabsContent>
          <TabsContent value="saldos" className="space-y-4">
            <FilterBar onClear={() => setFiltros({})}>
              <FilterText
                label="Buscar produto"
                value={filtros["busca"] ?? ""}
                onChange={(v) => setF("busca", v)}
              />
              <FilterSelect
                label="Estoque"
                value={filtros["somenteAbaixo"] ?? ""}
                onChange={(v) => setF("somenteAbaixo", v)}
                options={[{ value: "1", label: "Abaixo do mínimo" }]}
                allLabel="Todos os produtos"
              />
            </FilterBar>{" "}
            <div className="print-area">
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                Estoque da loja por produto
              </h2>
              <div className="rounded-lg border border-border bg-card">
                {produtos.isLoading || disponibilidade.isLoading || centrosCarregando ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Carregando...
                  </div>
                ) : produtos.isError || disponibilidade.isError || centrosErro ? (
                  <p role="alert" className="p-6 text-sm text-destructive">
                    {(produtos.error ?? disponibilidade.error ?? centrosErro)?.message}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Un.</TableHead>
                        <TableHead className="text-right">Físico</TableHead>
                        <TableHead className="text-right">Reservado</TableHead>
                        <TableHead className="text-right">Disponível</TableHead>
                        <TableHead className="text-right">Mínimo</TableHead>
                        <TableHead>Situação</TableHead>
                        {canStock && (
                          <TableHead>
                            <span className="sr-only">Ações</span>
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtosFiltrados.map((p) => {
                        const saldo = saldoProduto(p["id"]);
                        const baixo = saldo <= Number(p["estoque_minimo"] ?? 0);
                        return (
                          <TableRow key={String(p["id"])}>
                            <TableCell>{String(p["descricao"])}</TableCell>
                            <TableCell>{String(p["unidade"] ?? "UN")}</TableCell>
                            <TableCell className="text-right">{saldoProduto(p["id"])}</TableCell>
                            <TableCell className="text-right">
                              {disponibilidade.isError
                                ? "Indisponível"
                                : (reservadoProduto(p["id"]) ?? "…")}
                            </TableCell>
                            <TableCell className="text-right">
                              {disponibilidade.isError
                                ? "Indisponível"
                                : disponibilidade.data
                                  ? saldo - (reservadoProduto(p["id"]) ?? 0)
                                  : "…"}
                            </TableCell>
                            <TableCell className="text-right">
                              {String(p["estoque_minimo"])}
                            </TableCell>
                            <TableCell
                              className={baixo ? "text-destructive" : "text-muted-foreground"}
                            >
                              {baixo ? "repor" : "ok"}
                            </TableCell>
                            {canStock && (
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setForm((f) => ({ ...f, produto_id: String(p["id"]) }));
                                    setAba("movimentar");
                                  }}
                                >
                                  Movimentar
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="historico" className="space-y-4">
            <FilterBar onClear={() => setFiltros({})}>
              <FilterText
                label="Busca (código ou descrição)"
                value={filtros["busca"] ?? ""}
                onChange={(v) => setF("busca", v)}
              />
              <FilterSelect
                label="Tipo de movimento"
                value={filtros["tipo"] ?? ""}
                onChange={(v) => setF("tipo", v)}
                options={[
                  { value: "entrada", label: "Entrada" },
                  { value: "saida", label: "Saída" },
                  { value: "ajuste", label: "Ajuste" },
                ]}
              />
              <FilterText
                label="Data de"
                type="date"
                value={filtros["de"] ?? ""}
                onChange={(v) => setF("de", v)}
              />
              <FilterText
                label="Data até"
                type="date"
                value={filtros["ate"] ?? ""}
                onChange={(v) => setF("ate", v)}
              />
            </FilterBar>
            <div className="print-area">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Últimos movimentos</h2>
              <div className="rounded-lg border border-border bg-card">
                {movimentos.isLoading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Carregando...
                  </div>
                ) : movimentos.isError ? (
                  <div className="p-6 text-sm text-destructive">
                    {(movimentos.error as Error).message}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tente atualizar a página. Se o problema continuar, solicite a conferência do
                      acesso e da versão do banco ao administrador.
                    </p>
                  </div>
                ) : movimentosFiltrados.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum movimento registrado.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead>Origem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movimentosFiltrados.map((m) => (
                        <TableRow key={String(m["id"])}>
                          <TableCell>
                            {new Date(String(m["created_at"])).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })}
                          </TableCell>
                          <TableCell>{produtoName(m["produto_id"])}</TableCell>
                          <TableCell>{String(m["tipo"])}</TableCell>
                          <TableCell className="text-right">{String(m["quantidade"])}</TableCell>
                          <TableCell>{String(m["origem"])}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="depositos">
            {centro && disponibilidade.isSuccess ? (
              <DepositosInventario key={centro} centro={centro} produtos={produtosDaLoja} />
            ) : (
              <p className="rounded-lg border p-4 text-sm">
                {!centro
                  ? "Selecione a loja para abrir o depósito correspondente."
                  : disponibilidade.isError
                    ? "Aplique a fase271 no Supabase e atualize a página para operar o depósito da loja."
                    : "Consultando o estoque da loja..."}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </ErpLayout>
  );
}
