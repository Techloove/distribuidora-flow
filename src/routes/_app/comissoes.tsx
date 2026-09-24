import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
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

export const Route = createFileRoute("/_app/comissoes")({
  head: () => ({
    meta: [
      { title: "Comissões — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Comissões previstas por representante geradas na confirmação dos pedidos, com liberação e baixa de pagamento.",
      },
      { property: "og:title", content: "Comissões — ERP Distribuidora" },
      { property: "og:description", content: "Comissões flexíveis por pedido e representante." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComissoesPage,
});

type Row = Record<string, unknown>;

function ComissoesPage() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const comissoes = useQuery({
    queryKey: ["comissoes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("comissoes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const representantes = useQuery({
    queryKey: ["representantes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("representantes").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const centros = useQuery({
    queryKey: ["centros", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await client!.rpc("atualizar_status_comissao", {
        _comissao_id: id,
        _status: status,
      });
      toast.success("Comissão atualizada");
      queryClient.invalidateQueries({ queryKey: ["comissoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repName = (id: unknown) =>
    String(representantes.data?.find((r) => r["id"] === id)?.["nome"] ?? "—");
  const centroName = (id: unknown) =>
    String(centros.data?.find((c) => c["id"] === id)?.["nome"] ?? "—");

  const rows = useMemo(() => {
    let list = comissoes.data ?? [];
    const f = filtros;
    if (f["representante"]) list = list.filter((c) => c["representante_id"] === f["representante"]);
    if (f["status"]) list = list.filter((c) => String(c["status"]) === f["status"]);
    if (f["centro"]) list = list.filter((c) => c["centro_id"] === f["centro"]);
    if (f["de"]) list = list.filter((c) => String(c["created_at"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((c) => String(c["created_at"] ?? "") <= `${f["ate"]}T23:59:59`);
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (c) =>
          repName(c["representante_id"]).toLowerCase().includes(termo) ||
          String(c["pedido_id"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [comissoes.data, filtros, representantes.data]);

  const total = rows
    .filter((c) => c["status"] !== "cancelada")
    .reduce((s, c) => s + Number(c["valor"] ?? 0), 0);

  return (
    <ErpLayout
      title="Comissões"
      description="Geradas automaticamente ao confirmar pedidos, usando o percentual informado no documento."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-4">
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar (representante/pedido)"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={(representantes.data ?? []).map((r) => ({
              value: String(r["id"]),
              label: String(r["nome"]),
            }))}
          />
          <FilterSelect
            label="Status"
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

        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total de comissões ativas</p>
          <p className="mt-2 text-2xl font-semibold">{brl(total)}</p>
        </article>

        <div className="print-area rounded-lg border border-border bg-card">
          {comissoes.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : comissoes.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(comissoes.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase2_vendas_estoque_financeiro.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma comissão neste filtro.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Representante</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="no-print text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={String(c["id"])}>
                    <TableCell>{repName(c["representante_id"])}</TableCell>
                    <TableCell className="text-right">{brl(c["base_calculo"])}</TableCell>
                    <TableCell className="text-right">{String(c["percentual"])}</TableCell>
                    <TableCell className="text-right">{brl(c["valor"])}</TableCell>
                    <TableCell>{String(c["status"])}</TableCell>
                    <TableCell className="no-print text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canFinance || c["status"] !== "prevista"}
                          onClick={() =>
                            setStatus.mutate({ id: String(c["id"]), status: "liberada" })
                          }
                        >
                          Liberar
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canFinance || c["status"] === "paga" || c["status"] === "cancelada"}
                          onClick={() => setStatus.mutate({ id: String(c["id"]), status: "paga" })}
                        >
                          Pagar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
