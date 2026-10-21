import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { brl } from "@/lib/formatacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Detalhe = {
  produto_id: string;
  codigo: string;
  produto: string;
  unidade: string;
  quantidade: number;
  cidade: string;
  uf: string;
  valor_unitario: number;
  total: number;
};
export function EncargosPedido({
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
  const [usar, setUsar] = useState<boolean | null>(null);
  const [despesas, setDespesas] = useState<string | null>(null);
  const habilitado = usar ?? doc["frete_volume_ativo"] === true;
  const valor = despesas ?? String(doc["outras_despesas"] ?? 0);
  const mudou =
    habilitado !== (doc["frete_volume_ativo"] === true) ||
    Number(valor) !== Number(doc["outras_despesas"] ?? 0);
  const detalhes = Array.isArray(doc["frete_volume_detalhes"])
    ? (doc["frete_volume_detalhes"] as Detalhe[])
    : [];
  const pode = editavel && permissoes.pode("pedidos_encargos_editar");
  const salvar = useMutation({
    mutationFn: async () => {
      if (!valor.trim() || !Number.isFinite(Number(valor)) || Number(valor) < 0)
        throw new Error("Informe outras despesas válidas.");
      const { error } = await client!.rpc("definir_encargos_pedido_250", {
        _pedido: String(doc["id"]),
        _usar_volume: habilitado,
        _outras_despesas: Number(valor),
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["pedidos"] });
      await qc.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
      await qc.invalidateQueries({ queryKey: ["margem-produtos"] });
      await qc.invalidateQueries({ queryKey: ["validar_pedido"] });
    },
    onSuccess: () => {
      setUsar(null);
      setDespesas(null);
      toast.success("Encargos atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    onPendente(mudou || salvar.isPending);
  }, [mudou, salvar.isPending, onPendente]);
  useEffect(() => () => onPendente(false), [onPendente]);
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Frete por volume e outras despesas</h3>
        <p className="text-sm text-muted-foreground">
          Frete calculado pela quantidade na unidade de venda do produto e pela cidade/UF do
          cliente, conforme as tarifas desta loja. O frete manual permanece separado.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={habilitado}
              disabled={!pode || salvar.isPending}
              onChange={(e) => setUsar(e.target.checked)}
            />
            Aplicar frete por volume
          </label>
          <p className="text-lg font-semibold">{brl(doc["frete_volume_valor"])}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pedido-outras-despesas">Outras despesas cobradas (R$)</Label>
          <Input
            id="pedido-outras-despesas"
            type="number"
            min="0"
            step="0.01"
            value={valor}
            disabled={!pode || salvar.isPending}
            onChange={(e) => setDespesas(e.target.value)}
          />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Frete total (manual + volume)</p>
          <p className="text-lg font-semibold">
            {brl(Number(doc["frete_valor"] ?? 0) + Number(doc["frete_volume_valor"] ?? 0))}
          </p>
        </div>
      </div>
      {detalhes.length > 0 ? (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-2">Produto / cidade</th>
                <th>Quantidade</th>
                <th>Frete/un.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {detalhes.map((d, index) => (
                <tr key={`${d.produto_id}-${index}`} className="border-t">
                  <td className="p-2">
                    {d.codigo} · {d.produto}
                    <span className="block text-xs text-muted-foreground">
                      {d.cidade} / {d.uf || "—"}
                    </span>
                  </td>
                  <td>
                    {Number(d.quantidade).toLocaleString("pt-BR")} {d.unidade || "un."}
                  </td>
                  <td>{brl(d.valor_unitario)}</td>
                  <td>{brl(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {doc["frete_volume_ativo"] === true
            ? "Nenhum item com tarifa ativa para a cidade/UF do cliente. O frete por volume está zerado."
            : "Frete por volume desativado neste documento."}
        </p>
      )}
      {pode && (
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !client}>
          {salvar.isPending ? "Atualizando…" : "Atualizar encargos"}
        </Button>
      )}
      {mudou && (
        <p className="text-sm text-amber-700">
          Atualize os encargos antes de confirmar ou aceitar o orçamento. Os totais exibem os
          valores salvos.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Produtos sem tarifa não recebem esta cobrança. O total é atualizado ao salvar itens; as
        tarifas ficam preservadas após a aprovação. Esses valores são cobranças ao cliente, não o
        custo interno da entrega.
      </p>
    </section>
  );
}
