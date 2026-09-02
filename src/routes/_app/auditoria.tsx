import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";

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
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Trilha de auditoria das operações críticas: confirmação de pedidos, recebimento de NF e baixas financeiras.",
      },
      { property: "og:title", content: "Auditoria — ERP Distribuidora" },
      { property: "og:description", content: "Histórico das operações sensíveis do ERP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditoriaPage,
});

type Row = Record<string, unknown>;

function AuditoriaPage() {
  const { client, canManage } = useSupabase();
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const logs = useQuery({
    queryKey: ["auditoria"],
    enabled: !!client && canManage,
    queryFn: async () => {
      const { data, error } = await client!
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const opcoes = useMemo(() => {
    const list = logs.data ?? [];
    const uniq = (key: string) =>
      [...new Set(list.map((r) => String(r[key] ?? "")).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v }));
    return { tabelas: uniq("tabela"), acoes: uniq("acao") };
  }, [logs.data]);

  const rows = useMemo(() => {
    let list = logs.data ?? [];
    const f = filtros;
    if (f["tabela"]) list = list.filter((r) => String(r["tabela"]) === f["tabela"]);
    if (f["acao"]) list = list.filter((r) => String(r["acao"]) === f["acao"]);
    if (f["de"]) list = list.filter((r) => String(r["created_at"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((r) => String(r["created_at"] ?? "") <= `${f["ate"]}T23:59:59`);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (r) =>
          String(r["tabela"] ?? "").toLowerCase().includes(termo) ||
          JSON.stringify(r["detalhe"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [logs.data, filtros]);

  return (
    <ErpLayout
      title="Auditoria"
      description="Registro imutável das ações críticas do sistema. Visível apenas para admin e gestor."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      {!canManage ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para consultar a auditoria.
        </p>
      ) : (
        <div className="space-y-4">
          <FilterBar onClear={() => setFiltros({})}>
            <FilterText
              label="Buscar (tabela/detalhe)"
              value={filtros["busca"] ?? ""}
              onChange={(v) => setF("busca", v)}
            />
            <FilterSelect
              label="Tabela"
              value={filtros["tabela"] ?? ""}
              onChange={(v) => setF("tabela", v)}
              options={opcoes.tabelas}
            />
            <FilterSelect
              label="Ação"
              value={filtros["acao"] ?? ""}
              onChange={(v) => setF("acao", v)}
              options={opcoes.acoes}
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

          <div className="print-area rounded-lg border border-border bg-card">
            {logs.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : logs.isError ? (
              <p className="p-6 text-sm text-destructive">{(logs.error as Error).message}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum evento neste filtro.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tabela</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Detalhe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={String(l["id"])}>
                      <TableCell>
                        {new Date(String(l["created_at"])).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>{String(l["tabela"])}</TableCell>
                      <TableCell>{String(l["acao"])}</TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs text-muted-foreground">
                        {l["detalhe"] ? JSON.stringify(l["detalhe"]) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </ErpLayout>
  );
}
