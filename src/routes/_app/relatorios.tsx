import { ComparativoCentros } from "@/components/comparativo-centros";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { RelatorioRotas } from "@/components/relatorio-rotas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios gerenciais — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Relatórios de vendas por mês, produtos e clientes mais vendidos e comissões por representante.",
      },
      { property: "og:title", content: "Relatórios gerenciais — ERP Distribuidora" },
      { property: "og:description", content: "Vendas, ranking de produtos e comissões." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatoriosPage,
});

type Row = Record<string, unknown>;

function useView(view: string, limit?: number) {
  const { client } = useSupabase();
  return useQuery({
    queryKey: ["view", view],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from(view).select("*");
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });
}

function RelatoriosPage() {
  const vendas = useView("vw_vendas_mensal", 12);
  const produtos = useView("vw_top_produtos", 10);
  const clientes = useView("vw_top_clientes", 10);
  const comissoes = useView("vw_comissoes_representante", 20);

  return (
    <ErpLayout
      title="Relatórios"
      description="Consolidados de vendas, ranking de produtos e clientes e comissões por representante."
    >
      <RelatorioRotas />

      <ComparativoCentros />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel
          title="Vendas por mês"
          query={vendas}
          columns={["Mês", "Pedidos", "Total", "Comissão"]}
          render={(r) => [
            String(r["mes"]),
            String(r["pedidos"]),
            brl(r["total"]),
            brl(r["comissao"]),
          ]}
          keyOf={(r) => String(r["mes"])}
        />
        <Panel
          title="Produtos mais vendidos"
          query={produtos}
          columns={["Produto", "Qtd.", "Total"]}
          render={(r) => [String(r["descricao"]), String(r["quantidade"]), brl(r["total"])]}
          keyOf={(r) => String(r["produto_id"])}
        />
        <Panel
          title="Maiores clientes"
          query={clientes}
          columns={["Cliente", "Pedidos", "Total"]}
          render={(r) => [String(r["razao_social"]), String(r["pedidos"]), brl(r["total"])]}
          keyOf={(r) => String(r["cliente_id"])}
        />
        <Panel
          title="Comissões por representante"
          query={comissoes}
          columns={["Representante", "A pagar", "Pago"]}
          render={(r) => [String(r["nome"]), brl(r["a_pagar"]), brl(r["pago"])]}
          keyOf={(r) => String(r["representante_id"])}
        />
      </div>
    </ErpLayout>
  );
}

function Panel({
  title,
  query,
  columns,
  render,
  keyOf,
}: {
  title: string;
  query: ReturnType<typeof useView>;
  columns: string[];
  render: (row: Row) => string[];
  keyOf: (row: Row) => string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-5 py-4 text-sm font-semibold text-foreground">
        {title}
      </h2>
      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : query.isError ? (
        <div className="p-5 text-sm text-destructive">
          {(query.error as Error).message}
          <p className="mt-2 text-xs text-muted-foreground">
            Rode <code>db/fase4_logistica_relatorios.sql</code> no SQL Editor do Supabase.
          </p>
        </div>
      ) : (query.data ?? []).length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead key={c} className={i === 0 ? "" : "text-right"}>
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).map((r) => (
              <TableRow key={keyOf(r)}>
                {render(r).map((v, i) => (
                  <TableCell key={i} className={i === 0 ? "max-w-[14rem] truncate" : "text-right"}>
                    {v}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
