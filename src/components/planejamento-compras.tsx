import { ReposicaoInteligente } from "@/components/rotinas-distribuidora";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { lerPaginas } from "@/lib/paginacao";

type Row = Record<string, unknown>;

export function PlanejamentoCompras() {
  const { client, user, roles } = useSupabase();
  const perm = usePermissoesRotinas();
  const escopo = roles.slice().sort().join(",");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const lista = useQuery({
    queryKey: ["vw_sugestao_compras_centro", user?.id, escopo, "por-loja"],
    enabled: !!client && perm.pode("compras_planejar"),
    queryFn: async () => {
      return lerPaginas<Row>((inicio, fim) =>
        client!
          .from("vw_sugestao_compras_centro")
          .select("*")
          .order("sugestao", { ascending: false })
          .order("produto_id")
          .range(inicio, fim),
      );
    },
  });

  const grupos = useQuery({
    queryKey: ["produtos", "grupo-map", user?.id, escopo],
    enabled: !!client && perm.pode("compras_planejar"),
    queryFn: async () => {
      const data = await lerPaginas<Row>((inicio, fim) =>
        client!
          .from("produtos")
          .select("id, grupo, marca, categoria")
          .order("id")
          .range(inicio, fim),
      );
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

  if (!perm.pode("compras_planejar"))
    return <p role="status">Planejamento de compras não liberado para seu perfil.</p>;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Planejamento e reposição</h2>
          <p className="text-sm text-muted-foreground">
            Reposição por loja, considerando seu estoque, suas vendas, seus pedidos pendentes e suas
            compras.
          </p>
        </div>
        <Button className="no-print" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir planejamento
        </Button>
      </div>
      <div className="space-y-4">
        <ReposicaoInteligente />
        {grupos.error && (
          <p role="alert" className="text-sm text-destructive">
            {grupos.error.message}
          </p>
        )}
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
    </section>
  );
}
