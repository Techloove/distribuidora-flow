import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useSupabase } from "@/lib/supabase-provider";
import { brl, dataBr } from "@/lib/formatacao";
import { nomeStatusPedido } from "@/lib/status-pedido";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "./ui/table";
type Historico = {
  cliente: string;
  loja: string;
  limite: number;
  pedidos: {
    id: string;
    numero: number;
    data_pedido: string;
    data_aprovacao: string | null;
    status: string;
    responsavel_frete_intermediacao: string | null;
    itens: {
      produto_id: string;
      produto: string;
      quantidade: number;
      frete_saco: number | null;
      margem_saco: number | null;
    }[];
  }[];
};
export function HistoricoIntermediacaoCliente({
  doc,
  autorizado,
}: {
  doc: Record<string, unknown>;
  autorizado: boolean;
}) {
  const { client, user } = useSupabase();
  const [aberto, setAberto] = useState(false);
  const disponivel =
    autorizado &&
    doc["modalidade_venda"] === "intermediacao" &&
    !!doc["id"] &&
    !!doc["cliente_id"] &&
    !!doc["centro_id"];
  const historico = useQuery({
    queryKey: [
      "historico-intermediacao-cliente",
      user?.id,
      doc["id"],
      doc["cliente_id"],
      doc["centro_id"],
    ],
    enabled: !!client && aberto && disponivel,
    queryFn: async () => {
      const r = await client!.rpc("historico_intermediacao_cliente_310", {
        _pedido_atual: doc["id"],
        _limite: 10,
      });
      if (r.error) throw Error(r.error.message);
      return r.data as Historico;
    },
  });
  if (doc["modalidade_venda"] !== "intermediacao") return null;
  return (
    <>
      <Button
        variant="outline"
        className="h-11 w-full sm:w-auto"
        disabled={!disponivel}
        onClick={() => setAberto(true)}
      >
        <History className="size-4" />
        Histórico de frete e margem
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Histórico de frete e margem</DialogTitle>
            <DialogDescription>
              Negociações por saco dos últimos pedidos aprovados de Vendas Intermediação deste
              cliente, nesta loja. O pedido atual não entra na consulta.
            </DialogDescription>
          </DialogHeader>
          {historico.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando negociações…</p>
          ) : historico.error ? (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive">{historico.error.message}</p>
              <Button variant="outline" onClick={() => void historico.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            historico.data && (
              <>
                <div className="rounded-xl border bg-primary/5 p-3 text-sm">
                  <p className="font-medium break-words">{historico.data.cliente}</p>
                  <p className="text-xs text-muted-foreground">
                    {historico.data.loja} · até {historico.data.limite} pedidos · consulta dos
                    valores negociados
                  </p>
                </div>
                <div className="max-h-[58dvh] space-y-4 overflow-y-auto pr-1">
                  {!historico.data.pedidos.length ? (
                    <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                      Ainda não há outros pedidos aprovados de intermediação para este cliente nesta
                      loja.
                    </p>
                  ) : (
                    historico.data.pedidos.map((p) => (
                      <section key={p.id} className="rounded-xl border bg-card p-3">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold">Pedido #{p.numero}</h3>
                            <p className="text-xs text-muted-foreground">
                              Pedido de {dataBr(p.data_pedido)}
                              {p.data_aprovacao
                                ? ` · aprovação em ${dataBr(p.data_aprovacao)}`
                                : ""}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Frete por conta de:{" "}
                              {p.responsavel_frete_intermediacao === "loja"
                                ? "Loja vendedora"
                                : p.responsavel_frete_intermediacao === "cliente"
                                  ? "Cliente"
                                  : "Não informado"}
                            </p>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs">
                            {nomeStatusPedido(p.status)}
                          </span>
                        </div>
                        <Table className="mobile-cards" columnPreferences={false}>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Produto</TableHead>
                              <TableHead>Sacos</TableHead>
                              <TableHead>Frete / saco</TableHead>
                              <TableHead>Margem / saco</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {p.itens.map((i, n) => (
                              <TableRow key={`${i.produto_id}-${n}`}>
                                <TableCell
                                  data-label="Produto"
                                  className="min-w-0 whitespace-normal font-medium"
                                >
                                  {i.produto}
                                </TableCell>
                                <TableCell data-label="Sacos" className="whitespace-nowrap">
                                  {Number(i.quantidade).toLocaleString("pt-BR")}
                                </TableCell>
                                <TableCell data-label="Frete / saco" className="whitespace-nowrap">
                                  {i.frete_saco === null ? "—" : brl(i.frete_saco)}
                                </TableCell>
                                <TableCell data-label="Margem / saco" className="whitespace-nowrap">
                                  {i.margem_saco === null ? "—" : brl(i.margem_saco)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {!p.itens.length && (
                          <p className="text-xs text-muted-foreground">
                            Itens não disponíveis para consulta.
                          </p>
                        )}
                      </section>
                    ))
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Frete e margem podem variar por produto e por pedido. Use o histórico como
                  referência para a nova negociação.
                </p>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
