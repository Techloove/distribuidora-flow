import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ObservacoesPedido({
  doc,
  editavel,
  onPendente,
}: {
  doc: Record<string, unknown>;
  editavel: boolean;
  onPendente: (pendente: boolean) => void;
}) {
  const { client } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const qc = useQueryClient();
  const [edicao, setEdicao] = useState<{ texto: string; original: string } | null>(null);
  const gravado = String(doc["observacoes"] ?? "");
  const texto = edicao?.texto ?? gravado;
  const mudou = edicao !== null && texto !== edicao.original;
  const pode = editavel && permissoes.pode("pedidos_acompanhar");
  const salvar = useMutation({
    mutationFn: async () => {
      if (!client || !pode) throw new Error("Pedido sem permissão de edição.");
      const { error } = await client.rpc("salvar_observacoes_pedido_274", {
        _pedido: String(doc["id"]),
        _observacoes: texto,
        _anterior: edicao?.original ?? gravado,
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["pedidos"] });
    },
    onSuccess: () => {
      setEdicao(null);
      toast.success("Observações salvas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    onPendente(mudou || salvar.isPending);
  }, [mudou, salvar.isPending, onPendente]);
  useEffect(() => () => onPendente(false), [onPendente]);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <Label htmlFor="observacoes-pedido">Observações do pedido</Label>
      <p className="text-xs text-muted-foreground">
        Este texto aparece na impressão. Salve antes de imprimir.
      </p>
      <Textarea
        id="observacoes-pedido"
        rows={4}
        maxLength={4000}
        value={texto}
        disabled={!pode || salvar.isPending}
        placeholder="Ex.: entregar pela entrada lateral; procurar o responsável."
        onChange={(e) =>
          setEdicao({ texto: e.target.value, original: edicao?.original ?? gravado })
        }
      />
      {pode ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!mudou || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar observações"}
          </Button>
          {mudou && (
            <Button variant="outline" disabled={salvar.isPending} onClick={() => setEdicao(null)}>
              Descartar alterações
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {texto.length}/4000{mudou ? " · Alterações não salvas" : ""}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Edição disponível durante a digitação do pedido, conforme suas permissões.
        </p>
      )}
    </section>
  );
}
