import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { brl } from "@/lib/formatacao";

type Previa = {
  status: string;
  total: number;
  recebimentos: boolean;
  financeiro_especial: boolean;
  boletos_aguardando_baixa: number;
  devolucoes: number;
  itens: {
    produto_id: string;
    descricao: string;
    quantidade: number;
    disponivel: number;
    valor_unitario: number;
  }[];
};
export function AcoesCancelamentoPedido({ pedido, status }: { pedido: string; status: string }) {
  const { client, user, roles } = useSupabase();
  const qc = useQueryClient();
  const [modo, setModo] = useState<"cancelar" | "devolver" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [recebido, setRecebido] = useState(false);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [condicoes, setCondicoes] = useState<Record<string, string>>({});
  const [chave, setChave] = useState("");
  const admin = roles.includes("admin");
  const abrir = (value: "cancelar" | "devolver") => {
    setModo(value);
    setMotivo("");
    setRecebido(false);
    setQuantidades({});
    setCondicoes({});
    setChave(crypto.randomUUID());
  };
  const q = useQuery({
    queryKey: ["acao-pedido-admin", user?.id, pedido, modo],
    enabled: !!client && admin && !!modo,
    staleTime: 0,
    queryFn: async () => {
      const r = await client!.rpc("acao_pedido_admin_285", { _pedido: pedido });
      if (r.error) throw new Error(r.error.message);
      return r.data as Previa;
    },
  });
  const executar = useMutation({
    mutationFn: async () => {
      const args =
        modo === "cancelar"
          ? { _pedido: pedido, _motivo: motivo }
          : {
              _pedido: pedido,
              _motivo: motivo,
              _chave: chave,
              _recebido: recebido,
              _itens: (q.data?.itens ?? [])
                .filter((i) => Number(quantidades[i.produto_id] ?? 0) > 0)
                .map((i) => ({
                  produto_id: i.produto_id,
                  quantidade: Number(quantidades[i.produto_id]),
                  condicao: condicoes[i.produto_id] ?? "revenda",
                })),
            };
      const r = await client!.rpc(
        modo === "cancelar" ? "cancelar_pedido_admin_285" : "devolver_pedido_admin_285",
        args,
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success(
        modo === "cancelar"
          ? "Pedido cancelado. Confira os boletos que precisam de baixa bancária."
          : "Devolução registrada: estoque e financeiro ajustados proporcionalmente. Confira os boletos anteriores.",
      );
      setModo(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!admin) return null;
  const encerrado = ["cancelado", "devolvido"].includes(status);
  const avancado = ["em_rota", "entregue", "parcial", "nao_entregue"].includes(status);
  const valor = (q.data?.itens ?? []).reduce(
    (s, i) => s + Number(quantidades[i.produto_id] ?? 0) * Number(i.valor_unitario),
    0,
  );
  const invalidas = (q.data?.itens ?? []).some((i) => {
    const quantidade = Number(quantidades[i.produto_id] ?? 0);
    return (
      !Number.isFinite(quantidade) ||
      quantidade < 0 ||
      quantidade > Number(i.disponivel) ||
      Math.abs(quantidade * 1000 - Math.round(quantidade * 1000)) > 0.000001
    );
  });
  return (
    <>
      {!encerrado && !avancado && (
        <Button variant="outline" onClick={() => abrir("cancelar")}>
          Cancelar pedido · administrador
        </Button>
      )}
      {!encerrado &&
        !["rascunho", "digitacao", "aguardando_aprovacao", "recusado", "aprovado"].includes(
          status,
        ) && (
          <Button variant="outline" onClick={() => abrir("devolver")}>
            Devolver itens e ajustar financeiro
          </Button>
        )}
      <Dialog
        open={!!modo}
        onOpenChange={(v) => {
          if (!v && !executar.isPending) setModo(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {modo === "cancelar"
                ? "Cancelar pedido antes da saída"
                : "Devolver itens recebidos e ajustar a cobrança"}
            </DialogTitle>
            <DialogDescription>
              {modo === "cancelar"
                ? "Permitido até a montagem da carga. Somente saídas de estoque registradas serão revertidas. Títulos sem vínculos podem ser excluídos nas etapas iniciais; títulos vinculados a boletos serão preservados como cancelados."
                : "Informe apenas as quantidades que voltaram fisicamente. A devolução parcial mantém a cobrança do restante; a integral encerra o pedido como devolvido. Os títulos afetados ficam cancelados no histórico."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Esta ação não cancela nota fiscal. NF-e autorizada exige o tratamento fiscal próprio.
          </p>
          {q.isPending && <p role="status">Conferindo estoque, títulos e boletos…</p>}
          {q.error && (
            <p role="alert" className="text-sm text-destructive">
              {q.error.message}
            </p>
          )}
          {q.data &&
          (q.data.recebimentos || (modo === "devolver" && q.data.financeiro_especial)) ? (
            <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                Há recebimentos, encargos ou ajustes anteriores. Nenhum pagamento será apagado. Use
                a devolução com crédito e conciliação financeira específica.
              </p>
              <Button asChild variant="outline">
                <Link to="/devolucoes" search={{ pedido }}>
                  Abrir Devoluções
                </Link>
              </Button>
            </div>
          ) : null}
          {modo === "devolver" && q.data && (
            <div className="space-y-3">
              {q.data.itens.map((i) => (
                <div
                  key={i.produto_id}
                  className="grid gap-2 border-b pb-3 sm:grid-cols-[1fr_7rem_9rem]"
                >
                  <div>
                    <p className="text-sm font-medium">{i.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      Saldo ainda não devolvido: {i.disponivel}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor={`devolver-${i.produto_id}`}>Quantidade</Label>
                    <Input
                      id={`devolver-${i.produto_id}`}
                      type="number"
                      min="0"
                      max={i.disponivel}
                      step="0.001"
                      value={quantidades[i.produto_id] ?? ""}
                      disabled={executar.isPending}
                      onChange={(e) =>
                        setQuantidades((v) => ({ ...v, [i.produto_id]: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`condicao-${i.produto_id}`}>Condição</Label>
                    <select
                      id={`condicao-${i.produto_id}`}
                      className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                      value={condicoes[i.produto_id] ?? "revenda"}
                      disabled={executar.isPending}
                      onChange={(e) =>
                        setCondicoes((v) => ({ ...v, [i.produto_id]: e.target.value }))
                      }
                    >
                      <option value="revenda">Volta ao estoque</option>
                      <option value="avaria">Avariado</option>
                    </select>
                  </div>
                </div>
              ))}
              <p className="text-sm">
                Valor proporcional estimado: <strong>{brl(valor)}</strong>. O servidor confere o
                saldo e o arredondamento final. Descontos e frete do pedido entram proporcionalmente
                no valor.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recebido}
                  disabled={executar.isPending}
                  onChange={(e) => setRecebido(e.target.checked)}
                />
                Confirmo que os itens informados foram fisicamente recebidos.
              </label>
            </div>
          )}
          {!!q.data?.boletos_aguardando_baixa && (
            <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
              Há {q.data.boletos_aguardando_baixa} boleto(s) registrado(s). O ajuste local não dá
              baixa no banco. Em Boletos, o administrador deve solicitar a baixa com motivo e
              aguardar confirmação.
            </p>
          )}
          <Label htmlFor={`motivo-pedido-${pedido}`}>Motivo obrigatório</Label>
          <Textarea
            id={`motivo-pedido-${pedido}`}
            minLength={10}
            maxLength={2000}
            value={motivo}
            disabled={executar.isPending}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Descreva por que esta operação está sendo realizada"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={executar.isPending} onClick={() => setModo(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={
                executar.isPending ||
                !q.data ||
                q.isError ||
                q.data.recebimentos ||
                (modo === "devolver" && q.data.financeiro_especial) ||
                motivo.trim().length < 10 ||
                (modo === "devolver" && (!recebido || valor <= 0 || invalidas))
              }
              onClick={() => executar.mutate()}
            >
              {executar.isPending
                ? "Processando…"
                : modo === "cancelar"
                  ? "Confirmar cancelamento"
                  : "Confirmar devolução e ajuste"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
