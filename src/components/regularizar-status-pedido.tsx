import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSupabase } from "@/lib/supabase-provider";
import { destinosRegularizacao } from "@/lib/regularizacao-pedido";
import { nomeStatusPedido } from "@/lib/status-pedido";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
export function RegularizarStatusPedido({
  pedido,
  status,
  dataPedido,
}: {
  pedido: string;
  status: string;
  dataPedido: string;
}) {
  const { client, roles } = useSupabase(),
    qc = useQueryClient();
  const [aberto, setAberto] = useState(false),
    [destino, setDestino] = useState(""),
    [motivo, setMotivo] = useState(""),
    [data, setData] = useState(hojeSaoPaulo()),
    [confirmado, setConfirmado] = useState(false);
  const opcoes = destinosRegularizacao(status);
  const m = useMutation({
    retry: false,
    mutationFn: async () => {
      const { error } = await client!.rpc("regularizar_status_pedido_269", {
        _pedido: pedido,
        _status_esperado: status,
        _novo_status: destino,
        _motivo: motivo.trim(),
        _data: data,
      });
      if (error)
        throw new Error(
          error.code === "PGRST202"
            ? "Aplique o SQL da fase269 para ativar a regularização administrativa."
            : error.message,
        );
    },
    onSuccess: () => {
      toast.success("Status regularizado e alteração registrada no histórico.");
      setAberto(false);
      setMotivo("");
      setDestino("");
      setConfirmado(false);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries(),
  });
  if (!roles.includes("admin") || !opcoes.length) return null;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Regularização administrativa</h3>
          <p className="text-sm text-muted-foreground">
            Atualize pedidos antigos que já avançaram fora do sistema.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={m.isPending}
          onClick={() => {
            setAberto(!aberto);
            setConfirmado(false);
          }}
        >
          {" "}
          {aberto ? "Fechar" : "Regularizar status"}
        </Button>
      </div>
      {aberto && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmado && opcoes.includes(destino)) m.mutate();
          }}
        >
          <p className="text-sm">
            O ajuste altera somente o pedido. Não gera nota fiscal, cobrança, comissão, baixa de
            estoque, carga ou comprovante de entrega. Romaneios e cargas existentes permanecem no
            fluxo operacional e precisam ser conferidos separadamente.
          </p>
          <div className="space-y-1">
            <Label htmlFor="regularizar-destino">Novo status</Label>
            <select
              id="regularizar-destino"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={destino}
              onChange={(e) => {
                setDestino(e.target.value);
                setConfirmado(false);
              }}
              required
              disabled={m.isPending}
            >
              <option value="">Selecione uma etapa posterior</option>
              {opcoes.map((s) => (
                <option key={s} value={s}>
                  {nomeStatusPedido(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="regularizar-data">Data em que a etapa ocorreu</Label>
            <Input
              id="regularizar-data"
              type="date"
              min={dataPedido.slice(0, 10)}
              max={hojeSaoPaulo()}
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setConfirmado(false);
              }}
              required
              disabled={m.isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="regularizar-motivo">Motivo e contexto do ajuste</Label>
            <Textarea
              id="regularizar-motivo"
              minLength={10}
              maxLength={1000}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setConfirmado(false);
              }}
              placeholder="Ex.: pedido entregue antes da implantação completa; conferido com o responsável pela entrega."
              required
              disabled={m.isPending}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              disabled={m.isPending}
            />
            Confirmo que esta etapa já ocorreu e que os registros financeiros, fiscais e de estoque
            foram conferidos. O avanço ficará registrado com meu usuário.
          </label>
          <Button
            type="submit"
            disabled={
              m.isPending ||
              !confirmado ||
              !opcoes.includes(destino) ||
              motivo.trim().length < 10 ||
              !data
            }
          >
            {m.isPending
              ? "Registrando..."
              : `Confirmar avanço${destino ? " para " + nomeStatusPedido(destino) : ""}`}
          </Button>
        </form>
      )}
    </section>
  );
}
