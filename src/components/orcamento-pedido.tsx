import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { statusVisivelPedido } from "@/lib/status-pedido";
import { dataAgenda } from "@/lib/agenda-comercial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
export function OrcamentoPedido({
  doc,
  pendente,
}: {
  doc: Record<string, unknown>;
  pendente: boolean;
}) {
  const { client } = useSupabase(),
    perm = usePermissoesRotinas(),
    qc = useQueryClient();
  const [acao, setAcao] = useState<"aceitar" | "recusar" | "revisar" | null>(null),
    [validade, setValidade] = useState(""),
    [obs, setObs] = useState(""),
    [motivo, setMotivo] = useState("");
  const proposta = doc["tipo_documento"] === "orcamento",
    aberto = statusVisivelPedido(doc) === "orcamento",
    pode = perm.pode("pedidos_orcamentos");
  const salvar = useMutation({
    mutationFn: async () => {
      const { data, error } =
        acao === "revisar"
          ? await client!.rpc("revisar_orcamento_236", {
              _pedido: doc["id"],
              _validade: validade,
              _observacoes: obs,
            })
          : await client!.rpc("decidir_orcamento_236", {
              _pedido: doc["id"],
              _acao: acao,
              _motivo: motivo.trim() || null,
            });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown> | null;
    },
    onSuccess: (data) => {
      toast.success(
        acao === "aceitar"
          ? data?.["status"] === "aprovado"
            ? "Orçamento convertido em pedido e aprovado automaticamente."
            : "Orçamento convertido. Pedido aguardando aprovação; confira as restrições informadas."
          : acao === "recusar"
            ? "Não aprovação pelo cliente registrada."
            : "Proposta revisada e reaberta para negociação.",
      );
      setAcao(null);
      void qc.invalidateQueries({ queryKey: ["pedidos"] });
      void qc.invalidateQueries({ queryKey: ["acompanhamento_pedido_235"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!proposta)
    return doc["orcamento_aceito_em"] ? (
      <p className="rounded-lg border p-3 text-sm">
        Originado de orçamento aceito em{" "}
        {new Date(String(doc["orcamento_aceito_em"])).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })}
        .{" "}
        {doc["aprovacao_automatica_em"]
          ? "Aprovado automaticamente pelas regras comerciais."
          : "Confira a situação e eventuais restrições para aprovação."}
        {doc["status"] === "aguardando_aprovacao" &&
          Array.isArray(doc["aprovacao_automatica_motivos"]) &&
          doc["aprovacao_automatica_motivos"].length > 0 && (
            <span className="mt-2 block space-y-1">
              {doc["aprovacao_automatica_motivos"].map((v: { mensagem?: string }, i: number) => (
                <span key={i} className="block text-amber-800">
                  {v.mensagem ?? "Requer análise da gestão."}
                </span>
              ))}
            </span>
          )}
      </p>
    ) : null;
  return (
    <section aria-label="Proposta comercial" className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Proposta comercial</h2>
        <p className="text-sm">
          Validade: <strong>{dataAgenda(doc["orcamento_validade"])}</strong>
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Enquanto for orçamento, não há reserva ou baixa de estoque, contas a receber ou comissão a
        pagar. O aceite converte este documento em pedido e verifica automaticamente as regras de
        aprovação.
      </p>
      {doc["observacoes"] ? (
        <p className="whitespace-pre-wrap break-words text-sm">{String(doc["observacoes"])}</p>
      ) : null}
      {doc["orcamento_motivo"] ? (
        <p className="break-words text-sm">
          Motivo da não aprovação: {String(doc["orcamento_motivo"])}
        </p>
      ) : null}
      {pode && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!aberto || pendente || Number(doc["total_liquido"] ?? 0) <= 0}
            onClick={() => setAcao("aceitar")}
          >
            Cliente aceitou — converter em pedido
          </Button>
          <Button
            variant="outline"
            disabled={!aberto || pendente}
            onClick={() => {
              setMotivo("");
              setAcao("recusar");
            }}
          >
            Cliente não aprovou
          </Button>
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => {
              setValidade(String(doc["orcamento_validade"] ?? hojeSaoPaulo()));
              setObs(String(doc["observacoes"] ?? ""));
              setAcao("revisar");
            }}
          >
            Revisar validade e proposta
          </Button>
        </div>
      )}
      {!aberto && (
        <p className="text-sm text-amber-800">
          Orçamento encerrado ou vencido. Revise a validade e reabra a proposta para editar ou
          registrar aceite.
        </p>
      )}
      <Dialog
        open={!!acao}
        onOpenChange={(o) => {
          if (!o && !salvar.isPending) setAcao(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {acao === "aceitar"
                ? "Confirmar aceite do cliente"
                : acao === "recusar"
                  ? "Registrar não aprovação"
                  : "Revisar e reabrir proposta"}
            </DialogTitle>
            <DialogDescription>
              {acao === "aceitar"
                ? "O mesmo documento e seus itens serão convertidos em pedido. Sem bloqueios de crédito ou comerciais e com estoque disponível, ele será aprovado automaticamente; se houver restrições, aguardará aprovação da gestão. A data da venda passa a ser hoje, preservando a data original da proposta. A aprovação reserva mercadoria; a baixa de estoque e as parcelas ocorrem somente na confirmação da venda."
                : "As alterações ficam registradas no histórico do documento."}
            </DialogDescription>
          </DialogHeader>
          {acao === "revisar" && (
            <>
              <label className="text-sm">
                Validade do orçamento
                <Input
                  type="date"
                  min={hojeSaoPaulo()}
                  value={validade}
                  onChange={(e) => setValidade(e.target.value)}
                  disabled={salvar.isPending}
                />
              </label>
              <label className="text-sm">
                Observações da proposta
                <Textarea
                  maxLength={4000}
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  disabled={salvar.isPending}
                />
              </label>
            </>
          )}
          {acao === "recusar" && (
            <label className="text-sm">
              Motivo da não aprovação
              <Textarea
                maxLength={1000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={salvar.isPending}
              />
            </label>
          )}
          <Button
            disabled={
              salvar.isPending ||
              pendente ||
              (acao === "recusar" && !motivo.trim()) ||
              (acao === "revisar" && (!validade || validade < hojeSaoPaulo()))
            }
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending
              ? "Salvando…"
              : acao === "aceitar"
                ? "Confirmar aceite e converter em pedido"
                : acao === "recusar"
                  ? "Registrar decisão"
                  : "Salvar revisão e reabrir"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
