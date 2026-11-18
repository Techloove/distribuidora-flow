import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { Button } from "./ui/button";
import { SearchSelect } from "./ui/search-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Row = Record<string, unknown>;
export function AlterarRepresentantePedido({
  doc,
  representantes,
  onChange,
}: {
  doc: Row;
  representantes: Row[];
  onChange: () => void;
}) {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [destino, setDestino] = useState("");
  const alterar = useMutation({
    mutationFn: async () => {
      if (!client) throw Error("Conexão indisponível");
      const { error } = await client.rpc("alterar_representante_pedido_370", {
        _pedido: doc["id"],
        _representante: destino,
        _anterior: doc["representante_id"] ?? null,
      });
      if (error)
        throw Error(
          error.message.includes("schema cache")
            ? "Aplique a fase370 no Supabase para habilitar a troca."
            : error.message,
        );
    },
    onSuccess: () => {
      setOpen(false);
      onChange();
      void queryClient.invalidateQueries({
        predicate: (q) => /comiss|relatorio_vendas|auditoria/.test(String(q.queryKey[0])),
      });
      toast.success("Representante do pedido e da comissão atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (
    !roles.includes("admin") ||
    doc["tipo_documento"] === "orcamento" ||
    ["cancelado", "recusado"].includes(String(doc["status"]))
  )
    return null;
  return (
    <>
      <Button
        className="mt-2"
        variant="outline"
        size="sm"
        onClick={() => {
          setDestino("");
          setOpen(true);
        }}
      >
        Alterar vendedor / representante
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!alterar.isPending) setOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Alterar vendedor / representante</DialogTitle>
            <DialogDescription>
              Pedido #{String(doc["numero"])}. A comissão contratada é transferida ao novo
              representante, mantendo os valores e as regras gravadas no pedido.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Qualquer pagamento de comissão, inclusive parcial, impede a troca. Se houver agendamento
            ainda não pago, estorne o agendamento no módulo de comissões antes de continuar.
          </p>
          <label className="space-y-2 text-sm">
            Novo vendedor / representante
            <SearchSelect
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={alterar.isPending}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="">Selecione o representante</option>
              {representantes
                .filter(
                  (r) =>
                    r["ativo"] &&
                    r["id"] !== doc["representante_id"] &&
                    (!r["centro_id"] || r["centro_id"] === doc["centro_id"]),
                )
                .map((r) => (
                  <option key={String(r["id"])} value={String(r["id"])}>
                    {String(r["nome"])}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <DialogFooter>
            <Button variant="outline" disabled={alterar.isPending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={!destino || alterar.isPending} onClick={() => alterar.mutate()}>
              {alterar.isPending ? "Salvando…" : "Confirmar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
