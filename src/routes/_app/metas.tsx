import { getModalidade } from "@/lib/modalidade-store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Printer } from "lucide-react";
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
import { useCentro } from "@/lib/centro-store";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/metas")({
  head: () => ({
    meta: [
      { title: "Metas de vendas — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Defina metas mensais por representante e acompanhe o realizado e o percentual de atingimento.",
      },
      { property: "og:title", content: "Metas de vendas — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Metas mensais por representante com previsto x realizado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MetasPage,
});

type Row = Record<string, unknown>;
const hoje = new Date();

function MetasPage() {
  const { client, canManage } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    representante_id: "",
    ano: String(hoje.getFullYear()),
    mes: String(hoje.getMonth() + 1),
    valor_meta: "0",
  });
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const representantes = useQuery({
    queryKey: [...["representantes", "options"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("representantes").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const metas = useQuery({
    queryKey: [...["vw_metas_acompanhamento"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_metas_acompanhamento")
        .select("*")
        .order("ano", { ascending: false })
        .order("mes", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const opcoes = useMemo(() => {
    const list = metas.data ?? [];
    const uniq = (key: string) =>
      [...new Set(list.map((r) => String(r[key] ?? "")).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v }));
    return {
      representantes: uniq("representante"),
      centros: uniq("centro"),
    };
  }, [metas.data]);

  const rows = useMemo(() => {
    let list = metas.data ?? [];
    if (centro) list = list.filter((r) => !r["centro_id"] || r["centro_id"] === centro);
    const termo = (filtros["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((r) =>
        String(r["representante"] ?? "")
          .toLowerCase()
          .includes(termo),
      );
    }
    if (filtros["representante"]) {
      list = list.filter((r) => String(r["representante"] ?? "") === filtros["representante"]);
    }
    if (filtros["periodo"]) {
      const [ano, mes] = filtros["periodo"]!.split("-");
      list = list.filter(
        (r) => String(r["ano"]) === ano && String(r["mes"]).padStart(2, "0") === mes,
      );
    }
    if (filtros["centro"]) {
      list = list.filter((r) => String(r["centro"] ?? "") === filtros["centro"]);
    }
    return list;
  }, [metas.data, centro, filtros]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.representante_id) throw new Error("Selecione o representante");
      const { error } = await client!.from("metas_vendas").upsert(
        {
          representante_id: form.representante_id,
          ano: Number(form.ano),
          mes: Number(form.mes),
          valor_meta: Number(form.valor_meta || 0),
        },
        { onConflict: "representante_id,ano,mes" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Meta salva");
      queryClient.invalidateQueries({ queryKey: ["vw_metas_acompanhamento"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from("metas_vendas").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vw_metas_acompanhamento"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const totalMeta = rows.reduce((s, m) => s + Number(m["valor_meta"] ?? 0), 0);
  const totalReal = rows.reduce((s, m) => s + Number(m["realizado"] ?? 0), 0);

  return (
    <ErpLayout
      title="Metas de vendas"
      description="Realizado considera pedidos confirmados e faturados do mês, por representante."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Meta total</p>
            <p className="mt-2 text-2xl font-semibold">{brl(totalMeta)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Realizado</p>
            <p className="mt-2 text-2xl font-semibold">{brl(totalReal)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Atingimento</p>
            <p className="mt-2 text-2xl font-semibold">
              {totalMeta > 0 ? ((totalReal / totalMeta) * 100).toFixed(1) : "0.0"}%
            </p>
          </article>
        </div>

        {canManage && (
          <div className="no-print rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Definir meta</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              <div className="sm:col-span-2">
                <Label>Representante</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.representante_id}
                  onChange={(e) => setForm((f) => ({ ...f, representante_id: e.target.value }))}
                >
                  <option value="">Selecione...</option>
                  {(representantes.data ?? []).map((r) => (
                    <option key={String(r["id"])} value={String(r["id"])}>
                      {String(r["nome"])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Ano</Label>
                <Input
                  type="number"
                  value={form.ano}
                  onChange={(e) => setForm((f) => ({ ...f, ano: e.target.value }))}
                />
              </div>
              <div>
                <Label>Mês</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={form.mes}
                  onChange={(e) => setForm((f) => ({ ...f, mes: e.target.value }))}
                />
              </div>
              <div>
                <Label>Meta (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valor_meta}
                  onChange={(e) => setForm((f) => ({ ...f, valor_meta: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-5">
                <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                  <Plus className="size-4" /> Salvar meta
                </Button>
              </div>
            </div>
          </div>
        )}

        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar representante"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterText
            label="Período"
            type="month"
            value={filtros["periodo"] ?? ""}
            onChange={(v) => setF("periodo", v)}
          />
          <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={opcoes.representantes}
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={opcoes.centros}
          />
        </FilterBar>

        <div className="print-area rounded-lg border border-border bg-card">
          {metas.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : metas.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(metas.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase7_precos_devolucoes_metas_config.sql</code> no SQL Editor do
                Supabase.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma meta definida ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Representante</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Meta</TableHead>
                  <TableHead className="text-right">Realizado</TableHead>
                  <TableHead className="text-right">Atingimento</TableHead>
                  <TableHead className="no-print" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const pct = Number(m["atingimento_percentual"] ?? 0);
                  return (
                    <TableRow key={String(m["id"])}>
                      <TableCell>{String(m["representante"] ?? "—")}</TableCell>
                      <TableCell>
                        {String(m["mes"]).padStart(2, "0")}/{String(m["ano"])}
                      </TableCell>
                      <TableCell className="text-right">{brl(m["valor_meta"])}</TableCell>
                      <TableCell className="text-right">{brl(m["realizado"])}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${pct >= 100 ? "text-primary" : ""}`}
                      >
                        {pct.toFixed(1)}%
                      </TableCell>
                      <TableCell className="no-print text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={() => excluir.mutate(String(m["id"]))}
                        >
                          Excluir
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
