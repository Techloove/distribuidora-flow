import { ReposicaoInteligente } from "@/components/rotinas-distribuidora";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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

export const Route = createFileRoute("/_app/planejamento-compras")({
  head: () => ({
    meta: [
      { title: "Planejamento de compras — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Sugestão de compra por produto com média de vendas de 30, 60 e 90 dias, pedidos pendentes e mercadoria em trânsito.",
      },
      { property: "og:title", content: "Planejamento de compras — ERP Distribuidora" },
      { property: "og:description", content: "Previsão de reposição de estoque." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanejamentoPage,
});

type Row = Record<string, unknown>;

function PlanejamentoPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const lista = useQuery({
    queryKey: ["vw_sugestao_compras_centro", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!
        .from("vw_sugestao_compras_centro")
        .select("*")
        .order("sugestao", { ascending: false });
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const grupos = useQuery({
    queryKey: ["produtos", "grupo-map"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("produtos").select("id, grupo, marca, categoria");
      if (error) throw new Error(error.message);
      const m = new Map<string, Row>();
      for (const r of (data ?? []) as Row[]) m.set(String(r["id"]), r);
      return m;
    },
  });
  const prod = useCallback(
    (r: Row, k: string) => String(grupos.data?.get(String(r["produto_id"]))?.[k] ?? ""),
    [grupos.data],
  );

  const opcoes = useMemo(() => {
    const list = (lista.data ?? []).map(
      (r) => ({ ...r, grupo: prod(r, "grupo"), marca: prod(r, "marca") }) as Row,
    );
    const uniq = (key: string) =>
      [...new Set(list.map((r) => String(r[key] ?? "")).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v }));
    return {
      fornecedores: uniq("fornecedor"),
      centros: uniq("centro"),
      grupos: uniq("grupo"),
      marcas: uniq("marca"),
    };
  }, [lista.data, prod]);

  const rows = useMemo(() => {
    let list = lista.data ?? [];

    const term = (filtros["busca"] ?? "").trim().toLowerCase();
    if (term) {
      list = list.filter((r) => `${r["codigo"]} ${r["descricao"]}`.toLowerCase().includes(term));
    }
    if (filtros["fornecedor"]) {
      list = list.filter((r) => String(r["fornecedor"] ?? "") === filtros["fornecedor"]);
    }
    if (filtros["grupo"]) list = list.filter((r) => prod(r, "grupo") === filtros["grupo"]);
    if (filtros["marca"]) list = list.filter((r) => prod(r, "marca") === filtros["marca"]);
    if (filtros["centro"]) {
      list = list.filter((r) => String(r["centro"] ?? "") === filtros["centro"]);
    }
    if (filtros["somenteAbaixo"] === "1") {
      list = list.filter((r) => Number(r["estoque_atual"] ?? 0) < Number(r["estoque_minimo"] ?? 0));
    }
    return list;
  }, [lista.data, filtros, prod]);

  return (
    <ErpLayout
      title="Planejamento de compras"
      description="Sugestão calculada a partir da média de vendas, estoque atual, estoque mínimo/máximo, pedidos pendentes e mercadoria em trânsito."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-4">
        <ReposicaoInteligente />
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar produto"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder="Código ou descrição..."
          />
          {opcoes.fornecedores.length > 0 && (
            <FilterSelect
              label="Fornecedor"
              value={filtros["fornecedor"] ?? ""}
              onChange={(v) => setF("fornecedor", v)}
              options={opcoes.fornecedores}
            />
          )}
          <FilterSelect
            label="Grupo"
            value={filtros["grupo"] ?? ""}
            onChange={(v) => setF("grupo", v)}
            options={opcoes.grupos}
          />
          <FilterSelect
            label="Marca"
            value={filtros["marca"] ?? ""}
            onChange={(v) => setF("marca", v)}
            options={opcoes.marcas}
          />
          <FilterSelect
            label="Estoque"
            value={filtros["somenteAbaixo"] ?? ""}
            onChange={(v) => setF("somenteAbaixo", v)}
            options={[{ value: "1", label: "Somente abaixo do mínimo" }]}
            allLabel="Todos os itens"
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={opcoes.centros}
          />
        </FilterBar>

        <div className="print-area rounded-lg border border-border bg-card">
          {lista.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : lista.isError ? (
            <p className="p-5 text-sm text-destructive">{(lista.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">Sem produtos ativos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Mín.</TableHead>
                  <TableHead className="text-right">30d</TableHead>
                  <TableHead className="text-right">60d</TableHead>
                  <TableHead className="text-right">90d</TableHead>
                  <TableHead className="text-right">Média mês</TableHead>
                  <TableHead className="text-right">Pendentes</TableHead>
                  <TableHead className="text-right">Em trânsito</TableHead>
                  <TableHead className="text-right">Sugestão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r["centro_id"]}-${r["produto_id"]}`}>
                    <TableCell className="max-w-[16rem] truncate">
                      {String(r["codigo"])} · {String(r["descricao"])}
                    </TableCell>
                    <TableCell className="text-right">{String(r["estoque_atual"])}</TableCell>
                    <TableCell className="text-right">{String(r["estoque_minimo"])}</TableCell>
                    <TableCell className="text-right">{String(r["venda_30"])}</TableCell>
                    <TableCell className="text-right">{String(r["venda_60"])}</TableCell>
                    <TableCell className="text-right">{String(r["venda_90"])}</TableCell>
                    <TableCell className="text-right">{String(r["media_mensal"])}</TableCell>
                    <TableCell className="text-right">{String(r["pedidos_pendentes"])}</TableCell>
                    <TableCell className="text-right">{String(r["em_transito"])}</TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        Number(r["sugestao"]) > 0 ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {String(r["sugestao"])}
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
