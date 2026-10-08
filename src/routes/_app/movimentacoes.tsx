import { ConciliacaoExtrato } from "@/components/conciliacao-extrato";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Undo2 } from "lucide-react";
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
import { useCentro } from "@/lib/centro-store";
import { exportarCsv } from "@/lib/exportar";
import { usePermissoesFin } from "@/lib/permissoes-financeiras";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações financeiras — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Conciliação das movimentações de caixa e bancos com origem, categoria, centro de custo e estorno auditável.",
      },
      { property: "og:title", content: "Movimentações financeiras — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Entradas, saídas, transferências e estornos de todas as contas financeiras.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MovimentacoesPage,
});

type Row = Record<string, unknown>;

function MovimentacoesPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const perm = usePermissoesFin();
  const queryClient = useQueryClient();
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({
    conta_id: "",
    tipo: "entrada",
    valor: "",
    data: new Date().toISOString().slice(0, 10),
    categoria_id: "",
    descricao: "",
    documento: "",
  });

  const movimentos = useQuery({
    queryKey: ["vw_extrato_conta", "todos", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!
        .from("vw_extrato_conta")
        .select("*")
        .order("data", { ascending: false })
        .limit(500);
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const contas = useQuery({
    queryKey: ["contas_financeiras", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_financeiras")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const categorias = useQuery({
    queryKey: ["categorias_financeiras", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("categorias_financeiras")
        .select("id, nome, parent_id, ativo")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const lancar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("lancar_movimento", {
        _conta_id: form.conta_id,
        _tipo: form.tipo,
        _valor: Number(form.valor),
        _data: form.data,
        _categoria_id: form.categoria_id || null,
        _centro_id: centro || null,
        _descricao: form.descricao || null,
        _documento: form.documento || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Movimento lançado");
      setNovo(false);
      setForm((f) => ({ ...f, valor: "", descricao: "", documento: "" }));
      queryClient.invalidateQueries({ queryKey: ["vw_extrato_conta"] });
      queryClient.invalidateQueries({ queryKey: ["vw_conta_saldo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const estornar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.rpc("estornar_movimento_financeiro", {
        _movimento_id: id,
        _motivo: "Estorno manual",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Movimento estornado");
      queryClient.invalidateQueries({ queryKey: ["vw_extrato_conta"] });
      queryClient.invalidateQueries({ queryKey: ["vw_conta_saldo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    let list = movimentos.data ?? [];
    if (filtros["conta"]) list = list.filter((r) => r["conta_id"] === filtros["conta"]);
    if (filtros["tipo"]) list = list.filter((r) => r["tipo"] === filtros["tipo"]);
    if (filtros["origem"]) list = list.filter((r) => r["origem"] === filtros["origem"]);
    if (filtros["de"]) list = list.filter((r) => String(r["data"]) >= filtros["de"]!);
    if (filtros["ate"]) list = list.filter((r) => String(r["data"]) <= filtros["ate"]!);
    if (filtros["busca"]) {
      const t = String(filtros["busca"]).toLowerCase();
      list = list.filter((r) =>
        [r["descricao"], r["documento"], r["categoria_nome"], r["conta_nome"]]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(t)),
      );
    }
    return list;
  }, [movimentos.data, filtros]);

  const entradas = rows
    .filter((r) => r["tipo"] === "entrada" && r["status"] === "ativo")
    .reduce((s, r) => s + Number(r["valor"] ?? 0), 0);
  const saidas = rows
    .filter((r) => r["tipo"] === "saida" && r["status"] === "ativo")
    .reduce((s, r) => s + Number(r["valor"] ?? 0), 0);

  return (
    <ErpLayout
      title="Conciliação e movimentações"
      description="Toda movimentação tem origem (recebimento, pagamento, transferência ou ajuste) e pode ser estornada, nunca apagada."
    >
      <div className="space-y-4">
        <ConciliacaoExtrato />
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Entradas no filtro</p>
            <p className="mt-2 text-xl font-semibold">{brl(entradas)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Saídas no filtro</p>
            <p className="mt-2 text-xl font-semibold text-destructive">{brl(saidas)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Resultado</p>
            <p className="mt-2 text-xl font-semibold">{brl(entradas - saidas)}</p>
          </article>
        </div>

        <FilterBar
          onClear={() => setFiltros({})}
          extra={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  exportarCsv(
                    "movimentacoes",
                    [
                      { key: "data", label: "Data" },
                      { key: "conta_nome", label: "Conta" },
                      { key: "tipo", label: "Tipo" },
                      { key: "origem", label: "Origem" },
                      { key: "categoria_nome", label: "Categoria" },
                      { key: "descricao", label: "Histórico" },
                      { key: "valor_assinado", label: "Valor" },
                      { key: "status", label: "Status" },
                    ],
                    rows,
                  )
                }
              >
                Exportar CSV
              </Button>
              <Button size="sm" disabled={!perm.pode("bancos_ver")} onClick={() => setNovo(true)}>
                <Plus className="size-3.5" /> Lançar
              </Button>
            </div>
          }
        >
          <FilterText
            label="Buscar"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder="Histórico, documento ou categoria"
          />
          <FilterSelect
            label="Conta"
            value={filtros["conta"] ?? ""}
            onChange={(v) => setF("conta", v)}
            options={(contas.data ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["nome"]),
            }))}
          />
          <FilterSelect
            label="Tipo"
            value={filtros["tipo"] ?? ""}
            onChange={(v) => setF("tipo", v)}
            options={[
              { value: "entrada", label: "Entrada" },
              { value: "saida", label: "Saída" },
            ]}
          />
          <FilterSelect
            label="Origem"
            value={filtros["origem"] ?? ""}
            onChange={(v) => setF("origem", v)}
            options={[
              { value: "recebimento", label: "Recebimento" },
              { value: "pagamento", label: "Pagamento" },
              { value: "transferencia", label: "Transferência" },
              { value: "ajuste", label: "Ajuste" },
            ]}
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

        <div className="rounded-lg border border-border bg-card">
          {movimentos.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : movimentos.isError ? (
            <p className="p-6 text-sm text-destructive">{(movimentos.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma movimentação neste filtro.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={String(m["id"])}>
                    <TableCell>{String(m["data"])}</TableCell>
                    <TableCell>{String(m["conta_nome"] ?? "—")}</TableCell>
                    <TableCell>{String(m["origem"])}</TableCell>
                    <TableCell>
                      {String(m["categoria_pai"] ?? m["categoria_nome"] ?? "—")}
                      {m["categoria_pai"] && m["categoria_nome"] ? (
                        <span className="block text-xs text-muted-foreground">
                          {String(m["categoria_nome"])}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{String(m["descricao"] ?? "—")}</TableCell>
                    <TableCell
                      className={`text-right ${
                        Number(m["valor_assinado"]) < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {brl(m["valor_assinado"])}
                    </TableCell>
                    <TableCell>{String(m["status"])}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          m["status"] !== "ativo" || !perm.pode("bancos_ver") || estornar.isPending
                        }
                        onClick={() => estornar.mutate(String(m["id"]))}
                      >
                        <Undo2 className="size-3.5" /> Estornar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar movimento</DialogTitle>
            <DialogDescription>
              Use para ajustes e lançamentos avulsos de caixa ou banco.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Conta</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.conta_id}
                onChange={(e) => setForm((f) => ({ ...f, conta_id: e.target.value }))}
              >
                <option value="">Selecione</option>
                {(contas.data ?? []).map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={form.data}
                onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Categoria</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.categoria_id}
                onChange={(e) => setForm((f) => ({ ...f, categoria_id: e.target.value }))}
              >
                <option value="">Sem categoria</option>
                {(categorias.data ?? []).map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {c["parent_id"] ? `— ${String(c["nome"])}` : String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Histórico</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Documento</Label>
              <Input
                value={form.documento}
                onChange={(e) => setForm((f) => ({ ...f, documento: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => lancar.mutate()}
              disabled={lancar.isPending || !form.conta_id || Number(form.valor) <= 0}
            >
              {lancar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
