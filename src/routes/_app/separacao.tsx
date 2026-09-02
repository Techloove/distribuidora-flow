import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/separacao")({
  head: () => ({
    meta: [
      { title: "Separação de pedidos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Lista de separação dos pedidos aprovados, por pedido ou por onda, com quantidade a separar e estoque disponível.",
      },
      { property: "og:title", content: "Separação de pedidos — ERP Distribuidora" },
      { property: "og:description", content: "Picking por pedido ou por onda de separação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SeparacaoPage,
});

type Row = Record<string, unknown>;

function SeparacaoPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<"pedido" | "onda">("pedido");

  const lista = useQuery({
    queryKey: ["vw_separacao"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("vw_separacao").select("*").order("numero");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(() => {
    const list = lista.data ?? [];
    return centro ? list.filter((r) => r["centro_id"] === centro) : list;
  }, [lista.data, centro]);

  const avancar = useMutation({
    mutationFn: async (args: { pedidoId: string; status: string }) => {
      const { error } = await client!.rpc("avancar_pedido", {
        _pedido_id: args.pedidoId,
        _novo_status: args.status,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Agrupamento por onda: soma a quantidade do mesmo produto em vários pedidos. */
  const porProduto = useMemo(() => {
    const map = new Map<string, { produto: string; codigo: string; quantidade: number; pedidos: string[] }>();
    for (const r of rows) {
      const key = String(r["produto_id"]);
      const atual = map.get(key) ?? {
        produto: String(r["produto"]),
        codigo: String(r["produto_codigo"] ?? ""),
        quantidade: 0,
        pedidos: [],
      };
      atual.quantidade += Number(r["quantidade"] ?? 0);
      atual.pedidos.push(String(r["numero"]));
      map.set(key, atual);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [rows]);

  const pedidos = useMemo(() => {
    const map = new Map<string, { numero: string; cliente: string; status: string; rota: string }>();
    for (const r of rows) {
      map.set(String(r["pedido_id"]), {
        numero: String(r["numero"]),
        cliente: String(r["cliente"] ?? "—"),
        status: String(r["status"]),
        rota: String(r["rota"] ?? "—"),
      });
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <ErpLayout
      title="Separação"
      description="Pedidos aprovados aguardando picking. Use a separação por onda para agrupar o mesmo produto de vários pedidos."
      actions={
        <div className="flex gap-2">
          <Button variant={modo === "pedido" ? "default" : "outline"} onClick={() => setModo("pedido")}>
            Por pedido
          </Button>
          <Button variant={modo === "onda" ? "default" : "outline"} onClick={() => setModo("onda")}>
            Por onda
          </Button>
        </div>
      }
    >
      {lista.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : lista.isError ? (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-destructive">
          {(lista.error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card py-14 text-center text-sm text-muted-foreground">
          Nenhum pedido aguardando separação.
        </p>
      ) : modo === "onda" ? (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd. total</TableHead>
                <TableHead>Pedidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porProduto.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.codigo}</TableCell>
                  <TableCell>{p.produto}</TableCell>
                  <TableCell className="text-right font-medium">{p.quantidade}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.pedidos.join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-4">
          {pedidos.map(([id, p]) => (
            <section key={id} className="rounded-lg border border-border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                <div>
                  <p className="text-sm font-semibold">
                    Pedido #{p.numero} · {p.cliente}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Status: {p.status} · Rota: {p.rota}
                  </p>
                </div>
                <div className="flex gap-2">
                  {p.status === "aprovado" || p.status === "confirmado" ? (
                    <Button size="sm" onClick={() => avancar.mutate({ pedidoId: id, status: "separacao" })}>
                      Iniciar separação
                    </Button>
                  ) : null}
                  {p.status === "separacao" ? (
                    <Button size="sm" onClick={() => avancar.mutate({ pedidoId: id, status: "separado" })}>
                      Concluir separação
                    </Button>
                  ) : null}
                  {p.status === "separado" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => avancar.mutate({ pedidoId: id, status: "em_rota" })}
                    >
                      Enviar para rota
                    </Button>
                  ) : null}
                </div>
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .filter((r) => r["pedido_id"] === id)
                    .map((r) => (
                      <TableRow key={String(r["produto_id"])}>
                        <TableCell>{String(r["produto"])}</TableCell>
                        <TableCell className="text-right">{String(r["quantidade"])}</TableCell>
                        <TableCell className="text-right">{String(r["estoque_atual"])}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </ErpLayout>
  );
}
