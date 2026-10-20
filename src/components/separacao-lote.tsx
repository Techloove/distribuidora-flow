import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ImprimirPedidos } from "@/components/imprimir-pedidos";
import { EmitirBoletosPedido } from "@/components/emitir-boletos-pedido";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { gerarRelatorioSeparacao, type LinhaSeparacao } from "@/lib/separacao-relatorio";
export type PedidoSeparacaoLote = {
  id: string;
  numero: string;
  cliente: string;
  centroId: string;
  status: string;
};
export function SeparacaoLote({
  pedidos,
  linhas,
  onConcluido,
}: {
  pedidos: PedidoSeparacaoLote[];
  linhas: LinhaSeparacao[];
  onConcluido: (p: PedidoSeparacaoLote[]) => void;
}) {
  const { client } = useSupabase();
  const perm = usePermissoesRotinas();
  const qc = useQueryClient();
  const [html, setHtml] = useState("");
  const [pronto, setPronto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [conferido, setConferido] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [lote, setLote] = useState<PedidoSeparacaoLote[]>([]);
  const concluir = useMutation({
    mutationFn: async (snapshot: PedidoSeparacaoLote[]) => {
      const { error } = await client!.rpc("concluir_separacao_lote_248", {
        _pedidos: snapshot.map((p) => p.id),
        _confirmar_completa: conferido,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_, snapshot) => {
      setConfirmar(false);
      toast.success(`${snapshot.length} pedido(s) separado(s) e conferido(s).`);
      onConcluido(snapshot);
      await Promise.all(
        [
          "pedidos",
          "pedido_itens",
          "vw_separacao",
          "pedido_separacoes",
          "vw_pedidos_para_carga",
          "expedicoes",
          "vw_expedicoes",
          "acompanhamento_pedido_235",
          "pendencias",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  function imprimir(modo: "consolidado" | "cliente") {
    try {
      setHtml(
        gerarRelatorioSeparacao(
          linhas,
          pedidos.map((p) => p.id),
          modo,
        ),
      );
      setPronto(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const aptos =
    pedidos.length > 0 &&
    pedidos.length <= 100 &&
    pedidos.every((p) => ["separacao", "separado", "conferido"].includes(p.status));
  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3 no-print">
        <h2 className="font-semibold">Trabalhar com pedidos selecionados</h2>
        <p className="text-sm text-muted-foreground">
          {pedidos.length} pedido(s) selecionado(s). Os relatórios incluem todos os itens de cada
          pedido selecionado, mesmo quando o filtro busca um produto específico.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!pedidos.length}
            onClick={() => imprimir("consolidado")}
          >
            Imprimir itens consolidados
          </Button>
          <Button variant="outline" disabled={!pedidos.length} onClick={() => imprimir("cliente")}>
            Imprimir separação por cliente
          </Button>
          <ImprimirPedidos
            pedidoIds={pedidos.map((p) => p.id)}
            label="Imprimir cópias dos selecionados"
          />
          {perm.pode("separacao_concluir") && (
            <Button
              disabled={!aptos || concluir.isPending}
              onClick={() => {
                setLote(pedidos.map((p) => ({ ...p })));
                setConferido(false);
                concluir.reset();
                setConfirmar(true);
              }}
            >
              Concluir separação dos selecionados
            </Button>
          )}
        </div>
        {pedidos.length > 0 && !aptos && (
          <p className="text-xs text-muted-foreground">
            Para concluir em lote, selecione até 100 pedidos em separação, separados ou já
            conferidos. Pedidos aprovados precisam iniciar a separação primeiro.
          </p>
        )}
      </div>
      <Dialog
        open={!!html}
        onOpenChange={(v) => {
          if (!v) setHtml("");
        }}
      >
        <DialogContent className="max-w-[95vw] w-[1100px]">
          <DialogHeader>
            <DialogTitle>Prévia da separação e conferência</DialogTitle>
            <DialogDescription>Confira as quantidades e escolha a impressora.</DialogDescription>
          </DialogHeader>
          <iframe
            title="Relatório de separação"
            srcDoc={html}
            ref={frame}
            onLoad={() => setPronto(true)}
            className="h-[65vh] w-full border rounded"
            sandbox="allow-same-origin allow-modals"
          />
          <Button disabled={!pronto} onClick={() => frame.current?.contentWindow?.print()}>
            Imprimir relatório
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmar}
        onOpenChange={(v) => {
          if (!concluir.isPending) setConfirmar(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Concluir {lote.length} pedido(s)</DialogTitle>
            <DialogDescription>
              Confirme somente depois da separação física e conferência de todos os itens. Uma
              divergência impede a conclusão do lote inteiro.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-auto text-sm">
            {lote.map((p) => (
              <p key={p.id}>
                #{p.numero} · {p.cliente}
              </p>
            ))}
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={conferido}
              disabled={concluir.isPending}
              onChange={(e) => setConferido(e.target.checked)}
            />
            Conferi todos os itens e quantidades dos pedidos selecionados.
          </label>
          {concluir.error && (
            <p role="alert" className="text-destructive">
              {concluir.error.message}
            </p>
          )}
          <Button disabled={!conferido || concluir.isPending} onClick={() => concluir.mutate(lote)}>
            {concluir.isPending ? "Concluindo…" : "Confirmar conclusão do lote"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function AcoesAposSeparacao({
  pedidos,
  onClose,
}: {
  pedidos: PedidoSeparacaoLote[];
  onClose: () => void;
}) {
  const [boletos, setBoletos] = useState(false);
  const { roles } = useSupabase();
  const financeiro = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Separação concluída</DialogTitle>
          <DialogDescription>
            Deseja imprimir a cópia dos pedidos ou emitir os boletos? Os pedidos estão liberados
            para montagem da carga.
          </DialogDescription>
        </DialogHeader>
        <ImprimirPedidos
          pedidoIds={pedidos.map((p) => p.id)}
          label="Imprimir cópias dos pedidos concluídos"
        />
        {financeiro && (
          <Button variant="outline" onClick={() => setBoletos((v) => !v)}>
            Escolher boletos para emitir ou reimprimir
          </Button>
        )}
        {boletos && (
          <div className="max-h-72 overflow-auto space-y-3">
            {pedidos.map((p) => (
              <div key={p.id} className="rounded border p-3">
                <p className="text-sm mb-2">
                  Pedido #{p.numero} · {p.cliente}
                </p>
                <EmitirBoletosPedido pedidoId={p.id} centroId={p.centroId} />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          A emissão exige acesso financeiro e parcelas aptas para cobrança. Nenhum boleto é emitido
          ao concluir a separação.
        </p>
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
