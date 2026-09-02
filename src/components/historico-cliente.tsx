import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { brl } from "@/components/documento-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const num = (v: unknown) => Number(v ?? 0);

export function HistoricoCliente({ pessoaId }: { pessoaId: string | null }) {
  const { client } = useSupabase();

  const hist = useQuery({
    queryKey: ["vw_historico_cliente", pessoaId],
    enabled: !!client && !!pessoaId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_historico_cliente")
        .select("*")
        .eq("pessoa_id", pessoaId!)
        .order("data_pedido", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (!pessoaId) {
    return (
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        Histórico de compras aparece depois de salvar o cadastro.
      </section>
    );
  }

  const linhas = hist.data ?? [];
  const totalValor = linhas.reduce((s, r) => s + num(r["total_liquido"]), 0);
  const totalQtd = linhas.reduce((s, r) => s + num(r["quantidade_total"]), 0);

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Histórico de compras do cliente</h3>
        <p className="text-xs text-muted-foreground">
          {linhas.length} pedido(s) · {totalQtd.toLocaleString("pt-BR")} un ·{" "}
          <span className="font-medium text-foreground">{brl(totalValor)}</span>
        </p>
      </header>
      {hist.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : hist.isError ? (
        <p className="p-4 text-sm text-destructive">{(hist.error as Error).message}</p>
      ) : linhas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum pedido registrado para este cliente.
        </p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((r) => (
                <TableRow key={String(r["pedido_id"])}>
                  <TableCell className="font-medium">{String(r["pedido_numero"] ?? "")}</TableCell>
                  <TableCell>{fmtDate(r["data_pedido"])}</TableCell>
                  <TableCell className="capitalize">
                    {String(r["status"] ?? "").replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-right">{num(r["qtd_itens"])}</TableCell>
                  <TableCell className="text-right">
                    {num(r["quantidade_total"]).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">{brl(num(r["total_liquido"]))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
