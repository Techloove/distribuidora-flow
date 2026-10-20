import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
type PedidoLote = { id: string; numero: string; cliente: string };
function mensagemErro(mensagem: string) {
  return /schema cache|does not exist|Could not find/.test(mensagem)
    ? "Aplique a fase233 no Supabase para utilizar o fluxo simplificado."
    : mensagem;
}
function useAtualizarLogistica() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [
        "pedidos",
        "pedido_itens",
        "vw_separacao",
        "pedido_separacoes",
        "vw_cargas",
        "vw_carga_pedidos",
        "vw_pedidos_para_carga",
        "expedicoes",
        "vw_expedicoes",
        "entregas_listar_232",
        "pendencias",
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
}
export function SelecionarPedidosLote({
  pedidos,
  cargaId,
}: {
  pedidos: PedidoLote[];
  cargaId?: string;
}) {
  const { client } = useSupabase(),
    perm = usePermissoesRotinas(),
    atualizar = useAtualizarLogistica();
  const [aberto, setAberto] = useState(false),
    [ids, setIds] = useState<string[]>([]);
  const carga = !!cargaId,
    pode = perm.pode(carga ? "cargas_operar" : "pedidos_enviar_separacao");
  const disponiveis = new Set(pedidos.map((p) => p.id)),
    marcados = ids.filter((id) => disponiveis.has(id));
  const rpc = useMutation({
    mutationFn: async () => {
      const resultado = carga
        ? await client!.rpc("incluir_pedidos_carga_233", { _carga: cargaId, _pedidos: marcados })
        : await client!.rpc("enviar_pedidos_separacao_233", { _pedidos: marcados });
      if (resultado.error) throw new Error(mensagemErro(resultado.error.message));
    },
    onSuccess: async () => {
      setAberto(false);
      setIds([]);
      toast.success(
        carga
          ? "Pedidos incluídos na carga. Despache quando estiver pronta."
          : "Pedidos enviados para separação.",
      );
      await atualizar();
    },
  });
  if (!pode) return null;
  return (
    <>
      <Button
        variant="secondary"
        disabled={!pedidos.length}
        onClick={() => {
          setAberto(true);
          setIds([]);
          rpc.reset();
        }}
      >
        {carga ? "Selecionar pedidos para a carga" : "Enviar pedidos para separação"}
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!rpc.isPending) setAberto(v);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {carga ? "Incluir pedidos na carga" : "Enviar pedidos para separação"}
            </DialogTitle>
            <DialogDescription>
              {carga
                ? "Selecione os pedidos liberados desta rota."
                : "Selecione os pedidos confirmados da lista filtrada. Pedidos em rascunho ou aguardando aprovação ficam fora."}{" "}
              Até 100 pedidos por operação.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {marcados.length} selecionados · {pedidos.length} disponíveis
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={rpc.isPending || pedidos.length > 100}
              onClick={() =>
                setIds(marcados.length === pedidos.length ? [] : pedidos.map((p) => p.id))
              }
            >
              {marcados.length === pedidos.length ? "Desmarcar todos" : "Selecionar todos"}
            </Button>
          </div>
          {pedidos.length > 100 && (
            <p className="text-xs text-muted-foreground">
              Refine os filtros ou marque até 100 pedidos individualmente.
            </p>
          )}
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {pedidos.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-3 rounded border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={marcados.includes(p.id)}
                  disabled={rpc.isPending || (!marcados.includes(p.id) && marcados.length >= 100)}
                  onChange={(e) =>
                    setIds((atual) =>
                      e.target.checked ? [...atual, p.id] : atual.filter((id) => id !== p.id),
                    )
                  }
                  aria-label={`Selecionar pedido ${p.numero}`}
                />
                <span>
                  <strong>Pedido #{p.numero}</strong>
                  <span className="block">{p.cliente}</span>
                </span>
              </label>
            ))}
          </div>
          {rpc.error && (
            <p role="alert" className="text-sm text-destructive">
              {rpc.error.message}
            </p>
          )}
          <Button disabled={!marcados.length || rpc.isPending} onClick={() => rpc.mutate()}>
            {rpc.isPending
              ? "Processando…"
              : carga
                ? "Incluir selecionados na carga"
                : "Enviar selecionados para separação"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ConcluirSeparacaoPratica({
  pedidoId,
  numero,
  onConcluido,
}: {
  pedidoId: string;
  numero: string;
  onConcluido?: () => void;
}) {
  const { client } = useSupabase(),
    perm = usePermissoesRotinas(),
    atualizar = useAtualizarLogistica();
  const [aberto, setAberto] = useState(false),
    [conferido, setConferido] = useState(false);
  const rpc = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("concluir_separacao_pratica_233", {
        _pedido: pedidoId,
        _confirmar_completa: conferido,
      });
      if (error) throw new Error(mensagemErro(error.message));
    },
    onSuccess: async () => {
      setAberto(false);
      toast.success("Separação concluída. Pedido liberado para montagem da carga.");
      onConcluido?.();
      await atualizar();
    },
  });
  if (!perm.pode("separacao_concluir")) return null;
  return (
    <>
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
          setConferido(false);
          rpc.reset();
        }}
      >
        Concluir separação
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!rpc.isPending) setAberto(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Concluir separação — pedido #{numero}</DialogTitle>
            <DialogDescription>
              Confira fisicamente os produtos e quantidades do pedido. A conclusão já registra a
              conferência e libera a montagem da carga.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 rounded border p-3 text-sm">
            <input
              type="checkbox"
              checked={conferido}
              disabled={rpc.isPending}
              onChange={(e) => setConferido(e.target.checked)}
              className="mt-1 size-4 shrink-0"
            />
            Confirmo que todos os produtos foram separados e conferidos nas quantidades do pedido.
          </label>
          <p className="text-xs text-muted-foreground">
            Quantidades ainda não preenchidas serão registradas como completas. Divergências já
            informadas bloqueiam a conclusão e precisam ser revisadas.
          </p>
          {rpc.error && (
            <p role="alert" className="text-sm text-destructive">
              {rpc.error.message}
            </p>
          )}
          <Button disabled={!conferido || rpc.isPending} onClick={() => rpc.mutate()}>
            {rpc.isPending ? "Concluindo…" : "Confirmar conclusão e liberar carga"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function DespacharCarga({
  carga,
  disabled = false,
}: {
  carga: Record<string, unknown>;
  disabled?: boolean;
}) {
  const { client } = useSupabase(),
    atualizar = useAtualizarLogistica();
  const [aberto, setAberto] = useState(false),
    [data, setData] = useState(hojeSaoPaulo);
  const rpc = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("despachar_carga_233", {
        _carga: carga["id"],
        _data: data,
      });
      if (error) throw new Error(mensagemErro(error.message));
    },
    onSuccess: async () => {
      setAberto(false);
      toast.success("Carga despachada. Os pedidos estão prontos para confirmação em Entregas.");
      await atualizar();
    },
  });
  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
          setData(hojeSaoPaulo());
          rpc.reset();
        }}
      >
        Despachar carga
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!rpc.isPending) setAberto(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Despachar carga #{String(carga["numero"])}</DialogTitle>
            <DialogDescription>
              Esta ação fecha a carga e coloca todos os pedidos vinculados em rota, sem despacho
              individual na Expedição.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Rota: {String(carga["rota"] ?? "—")} · Motorista:{" "}
            {String(carga["motorista"] || "Não informado")}
          </p>
          <label className="block text-sm">
            Data de saída
            <Input
              type="date"
              value={data}
              min={String(carga["data"] ?? "").slice(0, 10)}
              max={hojeSaoPaulo()}
              disabled={rpc.isPending}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Confira os pedidos, o veículo e a capacidade antes de confirmar a saída. A entrega de
            cada pedido será formalizada no menu Entregas.
          </p>
          {rpc.error && (
            <p role="alert" className="text-sm text-destructive">
              {rpc.error.message}
            </p>
          )}
          <Button
            disabled={
              rpc.isPending ||
              !data ||
              data > hojeSaoPaulo() ||
              data < String(carga["data"] ?? "").slice(0, 10)
            }
            onClick={() => rpc.mutate()}
          >
            {rpc.isPending ? "Despachando…" : "Confirmar saída da carga"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
