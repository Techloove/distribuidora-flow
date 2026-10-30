import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
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
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/rota-despesas")({
  head: () => ({
    meta: [
      { title: "Custos e rentabilidade de rota — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Despesas de viagem por rota com combustível, alimentação, hotel e pedágio, custo por km e resultado real da rota.",
      },
      { property: "og:title", content: "Custos e rentabilidade de rota — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Faturamento, custo dos produtos, despesas da rota, lucro e margem real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RotaDespesasPage,
});

type Row = Record<string, unknown>;

const despesaFields: CrudField[] = [
  {
    name: "rota_id",
    label: "Rota",
    type: "ref",
    ref: { table: "rotas", labelField: "nome" },
    required: true,
    inTable: true,
  },
  { name: "data", label: "Data", type: "date", inTable: true, required: true },
  { name: "responsavel", label: "Responsável / motorista", inTable: true },
  {
    name: "representante_id",
    label: "Vendedor",
    type: "ref",
    ref: { table: "representantes", labelField: "nome" },
  },
  { name: "veiculo", label: "Veículo" },
  {
    name: "centro_id",
    label: "Centro de custo",
    type: "ref",
    ref: { table: "centros", labelField: "nome" },
  },
  { name: "km_inicial", label: "KM inicial", type: "number", step: "0.1" },
  { name: "km_final", label: "KM final", type: "number", step: "0.1" },
  {
    name: "combustivel",
    currency: true,
    label: "Combustível",
    type: "number",
    step: "0.01",
    inTable: true,
  },
  { name: "alimentacao", currency: true, label: "Alimentação", type: "number", step: "0.01" },
  { name: "hotel", currency: true, label: "Hotel", type: "number", step: "0.01" },
  { name: "pedagio", currency: true, label: "Pedágio", type: "number", step: "0.01" },
  { name: "estacionamento", currency: true, label: "Estacionamento", type: "number", step: "0.01" },
  { name: "outras", currency: true, label: "Outras despesas", type: "number", step: "0.01" },
  { name: "clientes_visitados", label: "Clientes visitados", type: "number" },
  { name: "observacoes", label: "Observações", span: 2 },
];

const parametroFields: CrudField[] = [
  {
    name: "centro_id",
    label: "Centro de custo (vazio = padrão geral)",
    type: "ref",
    ref: { table: "centros", labelField: "nome" },
    inTable: true,
  },
  {
    name: "preco_combustivel",
    currency: true,
    label: "Preço médio do combustível (R$/litro)",
    type: "number",
    step: "0.01",
    inTable: true,
  },
  {
    name: "consumo_km_l",
    label: "Consumo médio (km/l)",
    type: "number",
    step: "0.01",
    inTable: true,
  },
  {
    name: "custo_km_extra",
    currency: true,
    label: "Custo extra por km",
    type: "number",
    step: "0.01",
  },
  { name: "pedagio_padrao", currency: true, label: "Pedágio padrão", type: "number", step: "0.01" },
  {
    name: "alimentacao_dia",
    currency: true,
    label: "Alimentação por dia",
    type: "number",
    step: "0.01",
  },
  { name: "hotel_noite", currency: true, label: "Hotel por noite", type: "number", step: "0.01" },
];

function RotaDespesasPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();

  const resultado = useQuery({
    queryKey: ["vw_rota_resultado", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_rota_resultado").select("*").order("periodo", { ascending: false });
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  return (
    <ErpLayout
      title="Custos e rentabilidade de rota"
      description="Usa as rotas já cadastradas. Os parâmetros de combustível, alimentação e hotel são configuráveis e alimentam a estimativa de custo."
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Resultado por rota e mês</h2>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                exportarCsv(
                  "rentabilidade-rotas",
                  [
                    { key: "rota", label: "Rota" },
                    { key: "periodo", label: "Período" },
                    { key: "clientes", label: "Clientes" },
                    { key: "pedidos", label: "Pedidos" },
                    { key: "faturamento", label: "Faturamento" },
                    { key: "custo_produtos", label: "Custo dos produtos" },
                    { key: "despesas_rota", label: "Despesas da rota" },
                    { key: "resultado", label: "Resultado" },
                    { key: "margem_percentual", label: "Margem %" },
                  ],
                  resultado.data ?? [],
                )
              }
            >
              Exportar CSV
            </Button>
          </header>
          {resultado.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : resultado.isError ? (
            <p className="p-6 text-sm text-destructive">{(resultado.error as Error).message}</p>
          ) : (resultado.data ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma rota com pedidos ou despesas ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rota</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Custo produtos</TableHead>
                  <TableHead className="text-right">Despesas rota</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(resultado.data ?? []).map((r, idx) => (
                  <TableRow key={`${String(r["rota_id"])}-${String(r["periodo"])}-${idx}`}>
                    <TableCell>{String(r["rota"] ?? "—")}</TableCell>
                    <TableCell>{String(r["periodo"] ?? "—").slice(0, 7)}</TableCell>
                    <TableCell className="text-right">{String(r["clientes"])}</TableCell>
                    <TableCell className="text-right">{String(r["pedidos"])}</TableCell>
                    <TableCell className="text-right">{brl(r["faturamento"])}</TableCell>
                    <TableCell className="text-right">{brl(r["custo_produtos"])}</TableCell>
                    <TableCell className="text-right">{brl(r["despesas_rota"])}</TableCell>
                    <TableCell className="text-right font-medium">{brl(r["resultado"])}</TableCell>
                    <TableCell className="text-right">
                      {Number(r["margem_percentual"] ?? 0).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Despesas de viagem</h2>
          <CrudPage
            table="rota_despesas"
            fields={despesaFields}
            orderBy="data"
            emptyLabel="Nenhuma despesa de rota lançada."
            searchColumns={["responsavel", "veiculo", "observacoes"]}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Parâmetros de custo de rota</h2>
          <CrudPage
            table="rota_parametros"
            fields={parametroFields}
            orderBy="updated_at"
            emptyLabel="Nenhum parâmetro configurado."
            searchColumns={[]}
          />
        </section>
      </div>
    </ErpLayout>
  );
}
