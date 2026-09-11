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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const num = (v: unknown) => Number(v ?? 0);

/**
 * Histórico correlacionado do cliente: pedidos de compra e títulos financeiros
 * gerados por eles. Aceita o id do cadastro unificado (pessoa) e/ou do cliente.
 */
export function HistoricoCliente({
  pessoaId,
  clienteId,
}: {
  pessoaId?: string | null;
  clienteId?: string | null;
}) {
  const { client } = useSupabase();
  const chave = clienteId ? { coluna: "cliente_id", valor: clienteId } : pessoaId ? { coluna: "pessoa_id", valor: pessoaId } : null;

  const hist = useQuery({
    queryKey: ["vw_historico_cliente", chave?.coluna, chave?.valor],
    enabled: !!client && !!chave,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_historico_cliente")
        .select("*")
        .eq(chave!.coluna, chave!.valor)
        .order("data_pedido", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const titulos = useQuery({
    queryKey: ["vw_cliente_titulos", chave?.coluna, chave?.valor],
    enabled: !!client && !!chave,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_cliente_titulos")
        .select("*")
        .eq(chave!.coluna, chave!.valor)
        .order("vencimento", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (!chave) {
    return (
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        Histórico de compras aparece depois de salvar o cadastro.
      </section>
    );
  }

  const linhas = hist.data ?? [];
  const totalValor = linhas.reduce((s, r) => s + num(r["total_liquido"]), 0);
  const totalQtd = linhas.reduce((s, r) => s + num(r["quantidade_total"]), 0);

  const fin = titulos.data ?? [];
  const aberto = fin
    .filter((t) => !["pago", "cancelado"].includes(String(t["status_efetivo"])))
    .reduce((s, t) => s + num(t["saldo"]), 0);
  const vencido = fin
    .filter((t) => String(t["status_efetivo"]) === "vencido")
    .reduce((s, t) => s + num(t["saldo"]), 0);
  const pago = fin.reduce((s, t) => s + num(t["valor_pago"]), 0);

  return (
    <section className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Histórico do cliente</h3>
        <p className="text-xs text-muted-foreground">
          {linhas.length} pedido(s) · {totalQtd.toLocaleString("pt-BR")} un ·{" "}
          <span className="font-medium text-foreground">{brl(totalValor)}</span> · em aberto{" "}
          <span className="font-medium text-foreground">{brl(aberto)}</span>
          {vencido > 0 ? <span className="text-destructive"> · vencido {brl(vencido)}</span> : null}
        </p>
      </header>

      <Tabs defaultValue="pedidos" className="p-3">
        <TabsList>
          <TabsTrigger value="pedidos">Pedidos ({linhas.length})</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro ({fin.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pedidos">
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
                      <TableCell className="font-medium">
                        {String(r["pedido_numero"] ?? "")}
                      </TableCell>
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
        </TabsContent>

        <TabsContent value="financeiro">
          <p className="px-1 pb-2 text-xs text-muted-foreground">
            Títulos gerados pelos pedidos e lançamentos manuais · pago {brl(pago)} · em aberto{" "}
            {brl(aberto)}
          </p>
          {titulos.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : titulos.isError ? (
            <p className="p-4 text-sm text-destructive">{(titulos.error as Error).message}</p>
          ) : fin.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum título financeiro para este cliente.
            </p>
          ) : (
            <div className="max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fin.map((t) => (
                    <TableRow key={String(t["titulo_id"])}>
                      <TableCell className="font-medium">
                        {String(t["pedido_numero"] ?? "—")}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {String(t["documento"] ?? t["descricao"] ?? "—")}
                      </TableCell>
                      <TableCell>{String(t["parcela"] ?? "—")}</TableCell>
                      <TableCell>{fmtDate(t["vencimento"])}</TableCell>
                      <TableCell className="capitalize">
                        {String(t["status_efetivo"] ?? "").replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-right">{brl(t["valor"])}</TableCell>
                      <TableCell className="text-right">{brl(t["valor_pago"])}</TableCell>
                      <TableCell className="text-right">{brl(t["saldo"])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
