import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { brl } from "@/lib/formatacao";
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

export function HistoricoProduto({ produtoId }: { produtoId: string | null }) {
  const { client } = useSupabase();
  const [pagina, setPagina] = useState(0);
  const [tipo, setTipo] = useState<"todos" | "compra" | "venda">("todos");

  const hist = useQuery({
    queryKey: ["vw_historico_produto", produtoId],
    enabled: !!client && !!produtoId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_historico_produto")
        .select("*")
        .eq("produto_id", produtoId!)
        .order("data", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (!produtoId) {
    return (
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        O histórico de compras e saídas aparece depois de salvar o produto.
      </section>
    );
  }

  const todas = hist.data ?? [];
  const linhas = tipo === "todos" ? todas : todas.filter((r) => r["tipo"] === tipo);

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / 4));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = linhas.slice(paginaAtual * 4, paginaAtual * 4 + 4);

  const soma = (t: string, campo: string) =>
    todas.filter((r) => r["tipo"] === t).reduce((s, r) => s + num(r[campo]), 0);

  const compradoQtd = soma("compra", "quantidade");
  const compradoValor = soma("compra", "total");
  const vendidoQtd = soma("venda", "quantidade");
  const vendidoValor = soma("venda", "total");

  return (
    <section className="min-w-0 rounded-lg border border-border">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Histórico de compras e saídas</h3>
        <div className="flex flex-wrap gap-1">
          {(["todos", "compra", "venda"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t);
                setPagina(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                tipo === t
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {t === "todos" ? "Tudo" : t === "compra" ? "Compras" : "Vendas"}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
        <article className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Comprado (entradas)</p>
          <p className="mt-1 text-sm font-semibold">
            {compradoQtd.toLocaleString("pt-BR")} un · {brl(compradoValor)}
          </p>
        </article>
        <article className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Vendido (saídas)</p>
          <p className="mt-1 text-sm font-semibold">
            {vendidoQtd.toLocaleString("pt-BR")} un · {brl(vendidoValor)}
          </p>
        </article>
      </div>

      {hist.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : hist.isError ? (
        <p className="p-4 text-sm text-destructive">{(hist.error as Error).message}</p>
      ) : linhas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma movimentação registrada para este produto.
        </p>
      ) : (
        <div className="min-w-0">
          <Table className="table-fixed text-xs [&_th]:whitespace-normal [&_td]:whitespace-normal [&_td]:break-words [&_th]:p-2 [&_td]:p-2">
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente / Fornecedor</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="text-right">Unitário</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((r, i) => (
                <TableRow key={`${String(r["tipo"])}-${String(r["documento_id"])}-${i}`}>
                  <TableCell className="capitalize">{String(r["tipo"] ?? "")}</TableCell>
                  <TableCell className="font-medium">
                    {String(r["documento_numero"] ?? "")}
                  </TableCell>
                  <TableCell>{fmtDate(r["data"])}</TableCell>
                  <TableCell>{String(r["parceiro"] ?? "")}</TableCell>
                  <TableCell className="text-right">
                    {num(r["quantidade"]).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">{brl(num(r["valor_unitario"]))}</TableCell>
                  <TableCell className="text-right">{brl(num(r["total"]))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-xs">
            <span>
              {linhas.length} movimentação(ões) · Página {paginaAtual + 1} de {totalPaginas}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                disabled={paginaAtual === 0}
                onClick={() => setPagina(paginaAtual - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                disabled={paginaAtual + 1 >= totalPaginas}
                onClick={() => setPagina(paginaAtual + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
