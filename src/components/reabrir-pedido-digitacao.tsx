import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";

type Previa = { status: string; titulos_anteriores: number; boletos_encerrados: number };
export function ReabrirPedidoDigitacao({ pedido, status }: { pedido: string; status: string }) {
  const { client, user, roles } = useSupabase();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false),
    [motivo, setMotivo] = useState(""),
    [confirmado, setConfirmado] = useState(false),
    [chave, setChave] = useState("");
  const admin = roles.includes("admin");
  const q = useQuery({
    queryKey: ["reabertura-pedido-289", user?.id, pedido, status],
    enabled: open && admin && !!client,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("previa_reabertura_pedido_289", {
        _pedido: pedido,
      });
      if (error) throw new Error(error.message);
      return data as Previa;
    },
  });
  const executar = useMutation({
    retry: false,
    mutationFn: async () => {
      const { error } = await client!.rpc("reabrir_pedido_digitacao_289", {
        _pedido: pedido,
        _motivo: motivo.trim(),
        _chave: chave,
        _status_esperado: status,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setOpen(false);
      toast.success(
        "Pedido em digitação. Altere e salve a forma de pagamento; confirme novamente para gerar as novas parcelas.",
      );
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (
    !admin ||
    ![
      "aguardando_aprovacao",
      "aprovado",
      "recusado",
      "confirmado",
      "separacao",
      "separado",
      "conferido",
      "faturado",
      "nf_emitida",
      "em_carga",
      "cancelado",
    ].includes(status)
  )
    return null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setMotivo("");
          setConfirmado(false);
          setChave(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <RotateCcw className="size-4" />
        Voltar para digitação · administrador
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!executar.isPending) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Voltar pedido para digitação</DialogTitle>
            <DialogDescription>
              Somente administrador. Boletos emitidos precisam estar cancelados ou com baixa
              confirmada pelo banco.
            </DialogDescription>
          </DialogHeader>
          {q.isFetching && <p role="status">Conferindo boletos, financeiro e logística…</p>}
          {q.isError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{q.error.message}</p>
              <Button variant="outline" onClick={() => void q.refetch()}>
                Verificar novamente
              </Button>
            </div>
          )}
          {q.isSuccess && !q.isFetching && (
            <div className="space-y-3 text-sm">
              <p>
                {q.data.titulos_anteriores} título(s) anterior(es) serão preservados como
                cancelados. {q.data.boletos_encerrados} boleto(s) encerrado(s) permanecerão no
                histórico.
              </p>
              <p>
                O ciclo anterior será encerrado, com liberação das reservas e reversão das saídas de
                estoque registradas. A separação precisará ser feita novamente.
              </p>
              <p>
                Em seguida, altere e salve a forma de pagamento. Ao aprovar e confirmar novamente,
                serão geradas novas parcelas conforme a condição escolhida. Novos boletos serão
                emitidos sobre essas parcelas, após a nova conferência.
              </p>
            </div>
          )}
          <label className="space-y-1 text-sm">
            Motivo da reabertura
            <Textarea
              aria-label="Motivo da reabertura"
              minLength={10}
              maxLength={2000}
              disabled={executar.isPending}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setConfirmado(false);
              }}
              placeholder="Descreva por que o pedido precisa de uma nova condição de pagamento."
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmado}
              disabled={executar.isPending || !q.isSuccess || q.isFetching}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Confirmo o retorno para digitação e a necessidade de confirmar o pedido novamente para
            gerar as novas parcelas.
          </label>
          <DialogFooter>
            <Button variant="outline" disabled={executar.isPending} onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              disabled={
                executar.isPending ||
                !q.isSuccess ||
                q.isFetching ||
                !confirmado ||
                motivo.trim().length < 10 ||
                motivo.length > 2000
              }
              onClick={() => executar.mutate()}
            >
              {executar.isPending ? "Retornando…" : "Confirmar retorno para digitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
