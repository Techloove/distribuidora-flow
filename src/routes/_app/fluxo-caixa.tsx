import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de caixa — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Fluxo de caixa mensal consolidado com entradas e saídas previstas e realizadas do contas a receber e a pagar.",
      },
      { property: "og:title", content: "Fluxo de caixa — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Previsto x realizado por mês, com saldo acumulado da distribuidora.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FluxoCaixaPage,
});

type Row = Record<string, unknown>;

type Periodo = {
  periodo: string;
  previstoEntrada: number;
  realizadoEntrada: number;
  previstoSaida: number;
  realizadoSaida: number;
};

function FluxoCaixaPage() {
  const { client } = useSupabase();

  const fluxo = useQuery({
    queryKey: ["vw_fluxo_caixa"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_fluxo_caixa").select("*");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const periodos: Periodo[] = (() => {
    const map = new Map<string, Periodo>();
    for (const row of fluxo.data ?? []) {
      const key = String(row["periodo"] ?? "");
      if (!key) continue;
      const item =
        map.get(key) ??
        {
          periodo: key,
          previstoEntrada: 0,
          realizadoEntrada: 0,
          previstoSaida: 0,
          realizadoSaida: 0,
        };
      item.previstoEntrada += Number(row["previsto_entrada"] ?? 0);
      item.realizadoEntrada += Number(row["realizado_entrada"] ?? 0);
      item.previstoSaida += Number(row["previsto_saida"] ?? 0);
      item.realizadoSaida += Number(row["realizado_saida"] ?? 0);
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  })();

  let acumulado = 0;
  const linhas = periodos.map((p) => {
    const saldo = p.previstoEntrada + p.realizadoEntrada - p.previstoSaida - p.realizadoSaida;
    acumulado += saldo;
    return { ...p, saldo, acumulado };
  });

  const totalEntradas = periodos.reduce((s, p) => s + p.previstoEntrada + p.realizadoEntrada, 0);
  const totalSaidas = periodos.reduce((s, p) => s + p.previstoSaida + p.realizadoSaida, 0);

  return (
    <ErpLayout
      title="Fluxo de caixa"
      description="Consolidação mensal por vencimento, somando o que já foi baixado e o que ainda está em aberto."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Entradas</p>
            <p className="mt-2 text-xl font-semibold">{brl(totalEntradas)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Saídas</p>
            <p className="mt-2 text-xl font-semibold">{brl(totalSaidas)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Saldo projetado</p>
            <p className="mt-2 text-xl font-semibold">{brl(totalEntradas - totalSaidas)}</p>
          </article>
        </div>

        <div className="rounded-lg border border-border bg-card">
          {fluxo.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : fluxo.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(fluxo.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase6_faturamento_fluxo_caixa.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : linhas.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum título lançado — o fluxo aparece após pedidos ou compras.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Entradas previstas</TableHead>
                  <TableHead className="text-right">Entradas realizadas</TableHead>
                  <TableHead className="text-right">Saídas previstas</TableHead>
                  <TableHead className="text-right">Saídas realizadas</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.periodo}>
                    <TableCell>{l.periodo}</TableCell>
                    <TableCell className="text-right">{brl(l.previstoEntrada)}</TableCell>
                    <TableCell className="text-right">{brl(l.realizadoEntrada)}</TableCell>
                    <TableCell className="text-right">{brl(l.previstoSaida)}</TableCell>
                    <TableCell className="text-right">{brl(l.realizadoSaida)}</TableCell>
                    <TableCell className="text-right">{brl(l.saldo)}</TableCell>
                    <TableCell className="text-right font-medium">{brl(l.acumulado)}</TableCell>
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
