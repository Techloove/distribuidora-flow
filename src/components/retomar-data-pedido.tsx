import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { dataBr } from "@/lib/formatacao";
type Row = Record<string, unknown>;
export function RetomarDataPedido({
  doc,
  onChange,
  onSair,
}: {
  doc: Row;
  onChange: () => void;
  onSair: () => void;
}) {
  const { client } = useSupabase();
  const [diaAbertura] = useState(hojeSaoPaulo),
    [decidido, setDecidido] = useState(false);
  const data = String(doc["data_pedido"] ?? "").slice(0, 10);
  const atualizar = useMutation({
    mutationFn: async () => {
      const r = await client!.rpc("retomar_data_pedido_302", {
        _pedido: doc["id"],
        _data_esperada: data,
        _hoje_esperado: diaAbertura,
      });
      if (r.error) throw Error(r.error.message);
      return r.data as Row;
    },
    onSuccess: (r) => {
      setDecidido(true);
      onChange();
      toast.success(`Data do pedido atualizada para ${dataBr(r["data_pedido"])}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const perguntar =
    !decidido &&
    doc["tipo_documento"] !== "orcamento" &&
    ["rascunho", "digitacao"].includes(String(doc["status"])) &&
    !!data &&
    data !== diaAbertura;
  return (
    <Dialog
      open={perguntar}
      onOpenChange={(v) => {
        if (!v && !atualizar.isPending) onSair();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarClock className="size-5" />
            Retomar pedido #{String(doc["numero"] ?? "")}
          </div>
          <DialogTitle>Qual data deseja usar neste pedido?</DialogTitle>
          <DialogDescription>
            Este pedido está em digitação e foi registrado em {dataBr(data)}. Hoje é{" "}
            {dataBr(diaAbertura)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-xl border bg-primary/5 p-4 text-sm">
          <p>
            A data define o período de apuração da venda e das comissões quando o pedido for
            aprovado, inclusive na virada do mês.
          </p>
          <p className="text-muted-foreground">
            Os itens e os preços gravados serão preservados. Nenhum recebimento ou pagamento será
            gerado por esta escolha.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={atualizar.isPending}
            onClick={() => setDecidido(true)}
          >
            Manter {dataBr(data)}
          </Button>
          <Button disabled={atualizar.isPending} onClick={() => atualizar.mutate()}>
            {atualizar.isPending && <Loader2 className="size-4 animate-spin" />}Atualizar para{" "}
            {dataBr(diaAbertura)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
