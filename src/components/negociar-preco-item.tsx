import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { brl, dataHoraBr } from "@/lib/formatacao";
import { useSupabase } from "@/lib/supabase-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Row = Record<string, unknown>;
export function NegociarPrecoItem({
  item,
  produto,
  historico,
  editavel,
  confirmado = false,
  onChange,
}: {
  item: Row;
  produto: string;
  historico: Row[];
  editavel: boolean;
  confirmado?: boolean;
  onChange: () => void;
}) {
  const { client } = useSupabase();
  const [open, setOpen] = useState(false);
  const [anterior, setAnterior] = useState(0);
  const [quantidade, setQuantidade] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [preco, setPreco] = useState("");
  const [motivo, setMotivo] = useState("");
  const novo = Number(preco);
  const total = (p: number) => Math.round(quantidade * p * (1 - desconto / 100) * 100) / 100;
  const salvar = useMutation({
    mutationFn: async () => {
      if (!client) throw Error("Conexão indisponível");
      const { error } = await client.rpc("negociar_preco_item_381", {
        _item: item["id"],
        _preco_esperado: anterior,
        _quantidade_esperada: quantidade,
        _desconto_esperado: desconto,
        _novo_preco: novo,
        _motivo: motivo,
      });
      if (error) throw Error(error.message);
    },
    onSuccess: () => {
      toast.success("Preço negociado salvo no pedido.");
      setOpen(false);
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <span>{brl(item["preco_unitario"])}</span>
      {historico[0] && (
        <span className="text-xs text-muted-foreground">
          Antes: {brl(historico[0]["preco_anterior"])} · Novo: {brl(historico[0]["preco_novo"])}
        </span>
      )}
      {(editavel || historico.length > 0) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAnterior(
              Number(
                editavel
                  ? item["preco_unitario"]
                  : (historico[0]?.["preco_anterior"] ?? item["preco_unitario"]),
              ),
            );
            setQuantidade(Number(item["quantidade"]));
            setDesconto(Number(item["desconto_percentual"] ?? 0));
            setPreco(
              String(
                editavel
                  ? item["preco_unitario"]
                  : (historico[0]?.["preco_novo"] ?? item["preco_unitario"]),
              ),
            );
            setMotivo("");
            setOpen(true);
          }}
        >
          {editavel ? "Negociar preço" : "Ver negociação"}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!salvar.isPending) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editavel ? "Negociar preço do item" : "Histórico do preço do item"}
            </DialogTitle>
            <DialogDescription>
              {produto}. A alteração vale para este item do pedido.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
            <div>
              Preço anterior<strong className="block">{brl(anterior)}</strong>
            </div>
            <div>
              Novo preço
              <strong className="block">
                {preco !== "" && Number.isFinite(novo) ? brl(novo) : "—"}
              </strong>
            </div>
            {editavel && (
              <>
                <div>
                  Total anterior<strong className="block">{brl(total(anterior))}</strong>
                </div>
                <div>
                  Novo total do item
                  <strong className="block">
                    {preco !== "" && Number.isFinite(novo) ? brl(total(novo)) : "—"}
                  </strong>
                </div>
              </>
            )}
          </div>
          {confirmado && editavel && (
            <p className="rounded border p-3 text-sm">
              Pedido confirmado: a alteração exige ausência de boleto e de carga. As parcelas em
              aberto serão ajustadas nas mesmas proporções e vencimentos, e a comissão pendente será
              reapurada pelas regras vigentes. Recebimentos, créditos aplicados, comissão
              comprometida e documento fiscal impedem a negociação.
            </p>
          )}
          {editavel && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`negociacao-preco-${item["id"]}`}>Novo preço unitário</Label>
                <Input
                  id={`negociacao-preco-${item["id"]}`}
                  currency
                  type="number"
                  min="0"
                  step="0.01"
                  value={preco}
                  disabled={salvar.isPending}
                  onChange={(e) => setPreco(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`negociacao-motivo-${item["id"]}`}>Motivo (opcional)</Label>
                <Textarea
                  id={`negociacao-motivo-${item["id"]}`}
                  value={motivo}
                  maxLength={500}
                  disabled={salvar.isPending}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Quantidade e desconto percentual são preservados. O total do pedido será
                recalculado; o preço no cadastro de produtos permanece o mesmo.
              </p>
            </>
          )}
          {historico.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer">
                Histórico de negociações ({historico.length})
              </summary>
              <div className="mt-2 space-y-2">
                {historico.map((h) => (
                  <div className="rounded border p-2" key={String(h["id"])}>
                    {dataHoraBr(h["alterado_em"])} · {brl(h["preco_anterior"])} →{" "}
                    {brl(h["preco_novo"])}
                    {h["motivo"] ? (
                      <p className="text-muted-foreground">{String(h["motivo"])}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={salvar.isPending} onClick={() => setOpen(false)}>
              Fechar
            </Button>
            {editavel && (
              <Button
                disabled={
                  salvar.isPending ||
                  preco === "" ||
                  !Number.isFinite(novo) ||
                  novo < 0 ||
                  novo === anterior
                }
                onClick={() => salvar.mutate()}
              >
                {salvar.isPending ? "Salvando..." : "Aplicar novo preço"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
