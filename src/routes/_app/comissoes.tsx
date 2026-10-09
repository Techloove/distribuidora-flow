import { ComissaoProporcional } from "@/components/financeiro-novas-rotinas";
import { AjustesComissao } from "@/components/rotinas-distribuidora";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/comissoes")({
  head: () => ({
    meta: [
      { title: "Comissões — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Central de comissões dos representantes: apuração por pedido, metas, liberação e pagamento gerando contas a pagar.",
      },
      { property: "og:title", content: "Comissões — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Apuração, metas, liberação e pagamento de comissões integrados ao financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComissoesPage,
});

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const hoje = new Date();
const inicioAno = new Date(hoje.getFullYear(), 0, 1).toISOString().slice(0, 10);

function ComissoesPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");

  const [filtros, setFiltros] = useState<Record<string, string>>({
    de: inicioAno,
    ate: hoje.toISOString().slice(0, 10),
  });
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [pagarAberto, setPagarAberto] = useState(false);
  const [pagamento, setPagamento] = useState<Record<string, string>>({
    vencimento: hoje.toISOString().slice(0, 10),
  });

  const centroFiltro = filtros["centro"] || centro || "";

  const opcoes = useQuery({
    queryKey: ["comissoes", "opcoes"],
    enabled: !!client,
    queryFn: async () => {
      // allSettled: quem não pode ver uma das listas (ex. contas de banco)
      // continua com as demais opções de filtro disponíveis.
      const consultas = await Promise.allSettled([
        client!.from("representantes").select("id, nome").order("nome"),
        client!.from("centros").select("id, nome").order("nome"),
        client!.from("categorias_financeiras").select("id, nome").order("nome"),
        client!.from("contas_financeiras").select("id, nome").order("nome"),
        client!.from("formas_pagamento").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      const lista = (r: (typeof consultas)[number]): Row[] =>
        r.status === "fulfilled" ? ((r.value.data ?? []) as Row[]) : [];
      return {
        representantes: lista(consultas[0]!),
        centros: lista(consultas[1]!),
        categorias: lista(consultas[2]!),
        contas: lista(consultas[3]!),
        formas: lista(consultas[4]!),
      };
    },
  });

  const comissoes = useQuery({
    queryKey: ["vw_comissoes_detalhe", filtros, centroFiltro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_comissoes_detalhe").select("*");
      if (filtros["de"]) q = q.gte("data_pedido", filtros["de"]);
      if (filtros["ate"]) q = q.lte("data_pedido", filtros["ate"]);
      if (filtros["mes"]) q = q.eq("mes", filtros["mes"]);
      if (filtros["representante"]) q = q.eq("representante_id", filtros["representante"]);
      if (filtros["status"]) q = q.eq("status", filtros["status"]);
      if (centroFiltro) q = q.eq("centro_id", centroFiltro);
      const { data, error } = await q.order("data_pedido", { ascending: false }).limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const resumo = useQuery({
    queryKey: ["vw_comissoes_resumo", filtros["representante"] ?? ""],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_comissoes_resumo").select("*");
      if (filtros["representante"]) q = q.eq("representante_id", filtros["representante"]);
      const { data, error } = await q
        .order("ano", { ascending: false })
        .order("mes_numero", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const lotes = useQuery({
    queryKey: ["comissao_pagamentos", filtros["representante"] ?? ""],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("comissao_pagamentos").select("*");
      if (filtros["representante"]) q = q.eq("representante_id", filtros["representante"]);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["vw_comissoes_detalhe"] });
    queryClient.invalidateQueries({ queryKey: ["vw_comissoes_resumo"] });
    queryClient.invalidateQueries({ queryKey: ["comissao_pagamentos"] });
    queryClient.invalidateQueries({ queryKey: ["comissoes"] });
    setSelecionadas(new Set());
  };

  const liberar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await client!.rpc("liberar_comissoes", { _ids: ids });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      toast.success(`${n} comissão(ões) liberada(s)`);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pagar = useMutation({
    mutationFn: async () => {
      const ids = [...selecionadas];
      const reps = new Set(
        linhas
          .filter((l) => selecionadas.has(String(l["comissao_id"])))
          .map((l) => String(l["representante_id"])),
      );
      if (reps.size !== 1) {
        throw new Error("Selecione comissões de um único representante para gerar o pagamento.");
      }
      const { data, error } = await client!.rpc("pagar_comissoes", {
        _representante_id: [...reps][0],
        _comissao_ids: ids,
        _vencimento: pagamento["vencimento"] || null,
        _categoria_id: pagamento["categoria"] || null,
        _conta_id: pagamento["conta"] || null,
        _forma_id: pagamento["forma"] || null,
        _observacao: pagamento["observacao"] || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado e conta a pagar gerada");
      setPagarAberto(false);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelarLote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("cancelar_pagamento_comissao", {
        _pagamento_id: id,
        _motivo: "estorno manual",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Pagamento cancelado e comissões devolvidas para liberadas");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linhas = useMemo(() => {
    let lista = comissoes.data ?? [];
    const termo = (filtros["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      lista = lista.filter(
        (r) =>
          String(r["representante"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(r["cliente"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(r["pedido_numero"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    return lista;
  }, [comissoes.data, filtros]);

  const totais = useMemo(() => {
    const por = (st: string) =>
      linhas.filter((r) => String(r["status"]) === st).reduce((s, r) => s + num(r["valor"]), 0);
    return {
      prevista: por("prevista"),
      liberada: por("liberada"),
      paga: por("paga"),
      base: linhas
        .filter((r) => String(r["status"]) !== "cancelada")
        .reduce((s, r) => s + num(r["base_calculo"]), 0),
      total: linhas
        .filter((r) => String(r["status"]) !== "cancelada")
        .reduce((s, r) => s + num(r["valor"]), 0),
    };
  }, [linhas]);

  const selecionadasValor = linhas
    .filter((l) => selecionadas.has(String(l["comissao_id"])))
    .reduce((s, l) => s + num(l["valor"]), 0);

  const mesesDisponiveis = useMemo(() => {
    const set = new Set((comissoes.data ?? []).map((r) => String(r["mes"] ?? "")).filter(Boolean));
    return [...set].sort().reverse();
  }, [comissoes.data]);

  const alternar = (id: string) =>
    setSelecionadas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const selecionaveis = linhas.filter((l) =>
    ["prevista", "liberada"].includes(String(l["status"])),
  );

  const repNome = (id: unknown) =>
    String(opcoes.data?.representantes.find((r) => r["id"] === id)?.["nome"] ?? "—");

  return (
    <ErpLayout
      title="Comissões"
      description="Apuração por pedido, metas, liberação e pagamento de comissões gerando contas a pagar."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-4">
        <ComissaoProporcional />
        <AjustesComissao />
        <FilterBar
          onClear={() => {
            setFiltros({ de: inicioAno, ate: hoje.toISOString().slice(0, 10) });
            setSelecionadas(new Set());
          }}
        >
          <FilterText
            label="Buscar (representante/cliente/pedido)"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={(opcoes.data?.representantes ?? []).map((r) => ({
              value: String(r["id"]),
              label: String(r["nome"]),
            }))}
          />
          <FilterSelect
            label="Situação da comissão"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={[
              { value: "prevista", label: "Prevista" },
              { value: "liberada", label: "Liberada" },
              { value: "paga", label: "Paga" },
              { value: "cancelada", label: "Cancelada" },
            ]}
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={(opcoes.data?.centros ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["nome"]),
            }))}
          />
          <FilterSelect
            label="Mês"
            value={filtros["mes"] ?? ""}
            onChange={(v) => setF("mes", v)}
            options={mesesDisponiveis.map((m) => ({ value: m, label: m }))}
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

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Card label="Base de cálculo" value={brl(totais.base)} />
          <Card label="Previstas" value={brl(totais.prevista)} />
          <Card label="Liberadas" value={brl(totais.liberada)} />
          <Card label="Pagas" value={brl(totais.paga)} />
          <Card label="Total do filtro" value={brl(totais.total)} destaque />
        </div>

        <Tabs defaultValue="apuracao">
          <TabsList>
            <TabsTrigger value="apuracao">Apuração por pedido</TabsTrigger>
            <TabsTrigger value="metas">Metas e atingimento</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos gerados</TabsTrigger>
          </TabsList>

          <TabsContent value="apuracao" className="space-y-3">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">
                {selecionadas.size} selecionada(s) ·{" "}
                <span className="font-medium text-foreground">{brl(selecionadasValor)}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelecionadas(new Set(selecionaveis.map((l) => String(l["comissao_id"]))))
                  }
                >
                  Selecionar todas elegíveis
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canFinance || selecionadas.size === 0 || liberar.isPending}
                  onClick={() => liberar.mutate([...selecionadas])}
                >
                  Liberar selecionadas
                </Button>
                <Button
                  size="sm"
                  disabled={!canFinance || selecionadas.size === 0}
                  onClick={() => setPagarAberto(true)}
                >
                  Pagar e gerar conta a pagar
                </Button>
              </div>
            </div>

            <div className="print-area rounded-lg border border-border bg-card">
              {comissoes.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando...
                </div>
              ) : comissoes.isError ? (
                <div className="p-6 text-sm text-destructive">
                  {(comissoes.error as Error).message}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Rode <code>db/fase45_comissoes_relatorio_vendas.sql</code> no banco.
                  </p>
                </div>
              ) : linhas.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Nenhuma comissão neste filtro.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="no-print w-10"></TableHead>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Representante</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Centro</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead className="text-right">Comissão</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.map((r) => {
                        const id = String(r["comissao_id"]);
                        const elegivel = ["prevista", "liberada"].includes(String(r["status"]));
                        return (
                          <TableRow key={id}>
                            <TableCell className="no-print">
                              <Checkbox
                                checked={selecionadas.has(id)}
                                disabled={!elegivel}
                                onCheckedChange={() => alternar(id)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {String(r["pedido_numero"] ?? "—")}
                            </TableCell>
                            <TableCell>{fmtDate(r["data_pedido"])}</TableCell>
                            <TableCell className="max-w-[12rem] truncate">
                              {String(r["representante"] ?? "—")}
                            </TableCell>
                            <TableCell className="max-w-[14rem] truncate">
                              {String(r["cliente"] ?? "—")}
                            </TableCell>
                            <TableCell>{String(r["centro"] ?? "—")}</TableCell>
                            <TableCell className="text-right">{brl(r["base_calculo"])}</TableCell>
                            <TableCell className="text-right">
                              {num(r["percentual"]).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">{brl(r["valor"])}</TableCell>
                            <TableCell className="capitalize">{String(r["status"])}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="metas">
            <section className="rounded-lg border border-border bg-card">
              <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">
                Metas, vendas realizadas e comissões por mês
              </h2>
              {resumo.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando...
                </div>
              ) : resumo.isError ? (
                <p className="p-5 text-sm text-destructive">{(resumo.error as Error).message}</p>
              ) : (resumo.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Sem comissões apuradas.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Representante</TableHead>
                        <TableHead>Mês</TableHead>
                        <TableHead className="text-right">Pedidos</TableHead>
                        <TableHead className="text-right">Meta</TableHead>
                        <TableHead className="text-right">Realizado</TableHead>
                        <TableHead className="text-right">Atingimento</TableHead>
                        <TableHead className="text-right">A pagar</TableHead>
                        <TableHead className="text-right">Pago</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(resumo.data ?? []).map((r) => (
                        <TableRow key={`${String(r["representante_id"])}-${String(r["mes"])}`}>
                          <TableCell className="max-w-[14rem] truncate">
                            {String(r["representante"] ?? "—")}
                          </TableCell>
                          <TableCell>{String(r["mes"])}</TableCell>
                          <TableCell className="text-right">{num(r["pedidos"])}</TableCell>
                          <TableCell className="text-right">{brl(r["valor_meta"])}</TableCell>
                          <TableCell className="text-right">{brl(r["realizado"])}</TableCell>
                          <TableCell className="text-right">
                            {num(r["atingimento_percentual"]).toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right">{brl(r["a_pagar"])}</TableCell>
                          <TableCell className="text-right">{brl(r["paga"])}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="pagamentos">
            <section className="rounded-lg border border-border bg-card">
              <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">
                Pagamentos de comissão e contas a pagar geradas
              </h2>
              {lotes.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando...
                </div>
              ) : lotes.isError ? (
                <p className="p-5 text-sm text-destructive">{(lotes.error as Error).message}</p>
              ) : (lotes.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum pagamento de comissão gerado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Representante</TableHead>
                        <TableHead>Competência</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead className="text-right">Comissões</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead className="no-print text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(lotes.data ?? []).map((l) => (
                        <TableRow key={String(l["id"])}>
                          <TableCell className="max-w-[14rem] truncate">
                            {repNome(l["representante_id"])}
                          </TableCell>
                          <TableCell>{String(l["competencia"] ?? "—")}</TableCell>
                          <TableCell>
                            {fmtDate(l["periodo_inicio"])} a {fmtDate(l["periodo_fim"])}
                          </TableCell>
                          <TableCell className="text-right">{num(l["quantidade"])}</TableCell>
                          <TableCell className="text-right">{brl(l["valor_total"])}</TableCell>
                          <TableCell>{fmtDate(l["vencimento"])}</TableCell>
                          <TableCell className="capitalize">{String(l["status"])}</TableCell>
                          <TableCell className="no-print text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !canFinance ||
                                String(l["status"]) === "cancelado" ||
                                cancelarLote.isPending
                              }
                              onClick={() => cancelarLote.mutate(String(l["id"]))}
                            >
                              Cancelar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={pagarAberto} onOpenChange={setPagarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar comissões</DialogTitle>
            <DialogDescription>
              Gera uma conta a pagar de {brl(selecionadasValor)} com as {selecionadas.size}{" "}
              comissões selecionadas e marca cada uma como paga.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="venc">Vencimento</Label>
              <Input
                id="venc"
                type="date"
                value={pagamento["vencimento"] ?? ""}
                onChange={(e) => setPagamento((p) => ({ ...p, vencimento: e.target.value }))}
              />
            </div>
            <Campo
              label="Categoria financeira"
              value={pagamento["categoria"] ?? ""}
              onChange={(v) => setPagamento((p) => ({ ...p, categoria: v }))}
              options={opcoes.data?.categorias ?? []}
            />
            <Campo
              label="Conta / caixa"
              value={pagamento["conta"] ?? ""}
              onChange={(v) => setPagamento((p) => ({ ...p, conta: v }))}
              options={opcoes.data?.contas ?? []}
            />
            <Campo
              label="Forma de pagamento"
              value={pagamento["forma"] ?? ""}
              onChange={(v) => setPagamento((p) => ({ ...p, forma: v }))}
              options={opcoes.data?.formas ?? []}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="obs">Observação</Label>
              <Textarea
                id="obs"
                value={pagamento["observacao"] ?? ""}
                onChange={(e) => setPagamento((p) => ({ ...p, observacao: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagarAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => pagar.mutate()} disabled={pagar.isPending}>
              {pagar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

function Campo({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Row[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={String(o["id"])} value={String(o["id"])}>
              {String(o["nome"])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Card({ label, value, destaque }: { label: string; value: string; destaque?: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold ${destaque ? "text-xl text-primary" : "text-lg"}`}>
        {value}
      </p>
    </article>
  );
}
