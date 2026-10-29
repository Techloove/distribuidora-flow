import { ReferenciaRegistro } from "@/components/referencia-registro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";

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
import { useCentro } from "@/lib/centro-store";
import { exportarCsv } from "@/lib/exportar";
import { usePermissoesFin } from "@/lib/permissoes-financeiras";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/relatorios-financeiros")({
  head: () => ({
    meta: [
      { title: "Relatórios financeiros e rentabilidade — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Rentabilidade por produto, cliente, vendedor e rota com faturamento, custo, lucro, margem e comissão exportáveis.",
      },
      { property: "og:title", content: "Relatórios financeiros — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Rankings de vendas, lucro e margem, exportação em CSV e PDF.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatoriosFinanceirosPage,
});

type Row = Record<string, unknown>;

type Agrupamento = "produto" | "cliente" | "representante" | "rota" | "pedido";

const chaves: Record<Agrupamento, { id: string; nome: string; label: string }> = {
  produto: { id: "produto_id", nome: "produto", label: "Produto" },
  cliente: { id: "cliente_id", nome: "cliente", label: "Cliente" },
  representante: { id: "representante_id", nome: "representante", label: "Vendedor" },
  rota: { id: "rota_id", nome: "rota", label: "Rota" },
  pedido: { id: "pedido_id", nome: "pedido_numero", label: "Pedido" },
};

function RelatoriosFinanceirosPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const perm = usePermissoesFin();
  const [agrupar, setAgrupar] = useState<Agrupamento>("produto");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [ordem, setOrdem] = useState("lucro");

  const itens = useQuery({
    queryKey: ["vw_rentabilidade_item", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_rentabilidade_item").select("*").limit(5000);
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const linhas = useMemo(() => {
    const k = chaves[agrupar];
    const map = new Map<string, Row>();
    for (const r of itens.data ?? []) {
      const dt = String(r["data_pedido"] ?? "");
      if (de && dt < de) continue;
      if (ate && dt > ate) continue;
      const id = String(r[k.id] ?? "sem");
      const item =
        map.get(id) ??
        ({
          chave: String(r[k.nome] ?? "—"),
          referencia_id: r[k.id],
          quantidade: 0,
          receita: 0,
          custo: 0,
          desconto: 0,
          comissao: 0,
          lucro: 0,
          pedidos: new Set<string>(),
        } as Row);
      item["quantidade"] = Number(item["quantidade"]) + Number(r["quantidade"] ?? 0);
      item["receita"] = Number(item["receita"]) + Number(r["receita"] ?? 0);
      item["custo"] = Number(item["custo"]) + Number(r["custo_total"] ?? 0);
      item["desconto"] = Number(item["desconto"]) + Number(r["desconto"] ?? 0);
      item["comissao"] = Number(item["comissao"]) + Number(r["comissao"] ?? 0);
      item["lucro"] = Number(item["lucro"]) + Number(r["lucro_bruto"] ?? 0);
      (item["pedidos"] as Set<string>).add(String(r["pedido_id"]));
      map.set(id, item);
    }
    const lista = [...map.values()].map((r) => {
      const receita = Number(r["receita"]);
      const pedidos = (r["pedidos"] as Set<string>).size;
      return {
        chave: String(r["chave"]),
        referencia_id: r["referencia_id"],
        quantidade: Number(r["quantidade"]),
        receita,
        custo: Number(r["custo"]),
        desconto: Number(r["desconto"]),
        comissao: Number(r["comissao"]),
        lucro: Number(r["lucro"]),
        margem: receita > 0 ? (Number(r["lucro"]) / receita) * 100 : 0,
        pedidos,
        ticket: pedidos > 0 ? receita / pedidos : 0,
      };
    });
    const campo =
      ordem === "faturamento"
        ? "receita"
        : ordem === "quantidade"
          ? "quantidade"
          : ordem === "margem"
            ? "margem"
            : "lucro";
    return lista.sort(
      (a, b) => Number(b[campo as keyof typeof b]) - Number(a[campo as keyof typeof a]),
    );
  }, [itens.data, agrupar, de, ate, ordem]);

  const totais = linhas.reduce(
    (s, l) => ({
      receita: s.receita + l.receita,
      custo: s.custo + l.custo,
      lucro: s.lucro + l.lucro,
      comissao: s.comissao + l.comissao,
    }),
    { receita: 0, custo: 0, lucro: 0, comissao: 0 },
  );

  if (!perm.carregando && !perm.pode("financeiro_ver")) {
    return (
      <ErpLayout title="Relatórios financeiros" description="Acesso restrito.">
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para visualizar estes relatórios.
        </p>
      </ErpLayout>
    );
  }

  const mostraCusto = perm.pode("custos_ver");
  const mostraMargem = perm.pode("margens_ver");

  return (
    <ErpLayout
      title="Relatórios financeiros e rentabilidade"
      description="Análise das vendas já existentes: receita, custo do produto, lucro bruto, margem, desconto e comissão, com ranking e exportação."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Kpi label="Faturamento" value={brl(totais.receita)} />
          {mostraCusto ? <Kpi label="Custo dos produtos" value={brl(totais.custo)} /> : null}
          {mostraMargem ? <Kpi label="Lucro bruto" value={brl(totais.lucro)} /> : null}
          <Kpi label="Comissões" value={brl(totais.comissao)} />
        </div>

        <FilterBar
          onClear={() => {
            setDe("");
            setAte("");
            setAgrupar("produto");
            setOrdem("lucro");
          }}
          extra={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  exportarCsv(
                    `rentabilidade-${agrupar}`,
                    [
                      { key: "chave", label: chaves[agrupar].label },
                      { key: "quantidade", label: "Quantidade" },
                      { key: "receita", label: "Faturamento" },
                      { key: "custo", label: "Custo" },
                      { key: "lucro", label: "Lucro" },
                      { key: "margem", label: "Margem %" },
                      { key: "desconto", label: "Desconto" },
                      { key: "comissao", label: "Comissão" },
                      { key: "ticket", label: "Ticket médio" },
                    ],
                    linhas as unknown as Row[],
                  )
                }
              >
                Exportar CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="size-3.5" /> PDF
              </Button>
            </div>
          }
        >
          <FilterSelect
            label="Analisar por"
            value={agrupar}
            onChange={(v) => setAgrupar(v as Agrupamento)}
            options={[
              { value: "produto", label: "Produto" },
              { value: "cliente", label: "Cliente" },
              { value: "representante", label: "Vendedor" },
              { value: "rota", label: "Rota" },
              { value: "pedido", label: "Pedido" },
            ]}
          />
          <FilterSelect
            label="Ordenar por"
            value={ordem}
            onChange={setOrdem}
            options={[
              { value: "lucro", label: "Maior lucro" },
              { value: "faturamento", label: "Maior faturamento" },
              { value: "quantidade", label: "Mais vendidos" },
              { value: "margem", label: "Maior margem" },
            ]}
          />
          <FilterText label="De" type="date" value={de} onChange={setDe} />
          <FilterText label="Até" type="date" value={ate} onChange={setAte} />
        </FilterBar>

        <div className="print-area rounded-lg border border-border bg-card">
          {itens.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : itens.isError ? (
            <p className="p-6 text-sm text-destructive">{(itens.error as Error).message}</p>
          ) : linhas.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma venda no período selecionado.
            </p>
          ) : (
            <Table className="mobile-cards">
              <TableHeader>
                <TableRow>
                  <TableHead>{chaves[agrupar].label}</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  {mostraCusto ? <TableHead className="text-right">Custo</TableHead> : null}
                  {mostraMargem ? <TableHead className="text-right">Lucro</TableHead> : null}
                  {mostraMargem ? <TableHead className="text-right">Margem</TableHead> : null}
                  <TableHead className="text-right">Desconto</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.slice(0, 200).map((l) => (
                  <TableRow key={l.chave}>
                    <TableCell data-label={chaves[agrupar].label}>
                      {agrupar === "cliente" || agrupar === "pedido" ? (
                        <ReferenciaRegistro tipo={agrupar} id={l.referencia_id}>
                          {l.chave}
                        </ReferenciaRegistro>
                      ) : (
                        l.chave
                      )}
                    </TableCell>
                    <TableCell data-label="Qtd." className="text-right">
                      {l.quantidade.toFixed(2)}
                    </TableCell>
                    <TableCell data-label="Faturamento" className="text-right">
                      {brl(l.receita)}
                    </TableCell>
                    {mostraCusto ? (
                      <TableCell data-label="Custo" className="text-right">
                        {brl(l.custo)}
                      </TableCell>
                    ) : null}
                    {mostraMargem ? (
                      <TableCell data-label="Lucro" className="text-right">
                        {brl(l.lucro)}
                      </TableCell>
                    ) : null}
                    {mostraMargem ? (
                      <TableCell data-label="Margem" className="text-right">
                        {l.margem.toFixed(1)}%
                      </TableCell>
                    ) : null}
                    <TableCell data-label="Desconto" className="text-right">
                      {brl(l.desconto)}
                    </TableCell>
                    <TableCell data-label="Comissão" className="text-right">
                      {brl(l.comissao)}
                    </TableCell>
                    <TableCell data-label="Ticket médio" className="text-right">
                      {brl(l.ticket)}
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-lg font-semibold">{value}</p>
    </article>
  );
}
