import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
export function LiberacaoFaznotas({ loja }: { loja: string }) {
  const { client, roles } = useSupabase();
  const qc = useQueryClient();
  const [ambiente, setAmbiente] = useState<string | null>(null);
  const [liberado, setLiberado] = useState<boolean | null>(null);
  const estado = useQuery({
    queryKey: ["nfe-liberacao", loja],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("estado_liberacao_nfe_259", { _loja: loja });
      if (error) throw new Error(error.message);
      return data as { ambiente: string; liberado: boolean; atual: boolean } | null;
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("liberar_faznotas_259", {
        _loja: loja,
        _ambiente: ambiente ?? estado.data?.ambiente ?? "",
        _liberado: liberado ?? (estado.data?.atual === true && estado.data.liberado),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["nfe-liberacao", loja] });
      setAmbiente(null);
      setLiberado(null);
      toast.success("Liberação de emissão atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const admin = roles.includes("admin");
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <h3 className="font-semibold">Liberação de emissão FAZNOTAS</h3>
      <p className="text-sm text-muted-foreground">
        Informe o ambiente que o provedor confirmou na sua conta. Esta seleção registra a
        confirmação local; ela não muda o ambiente remoto. Confirme também certificado, CNPJ e série
        no painel FAZNOTAS antes de liberar.
      </p>
      {estado.error && (
        <p role="alert" className="text-destructive">
          {estado.error.message}. Confira a fase259.
        </p>
      )}
      {estado.data?.liberado && !estado.data.atual && (
        <p role="alert" className="text-destructive">
          A configuração da loja mudou. Confira os dados e confirme novamente a liberação.
        </p>
      )}
      <Label htmlFor="nfe-ambiente">Ambiente habilitado na conta FAZNOTAS</Label>
      <select
        id="nfe-ambiente"
        className="h-10 rounded-md border bg-background px-3"
        value={ambiente ?? estado.data?.ambiente ?? ""}
        disabled={!admin || salvar.isPending}
        onChange={(e) => {
          setAmbiente(e.target.value);
          setLiberado(false);
        }}
      >
        <option value="">Selecione após confirmar com o provedor</option>
        <option value="homologacao">Homologação</option>
        <option value="producao">Produção</option>
      </select>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={liberado ?? (estado.data?.atual === true && estado.data.liberado)}
          disabled={!admin || salvar.isPending}
          onChange={(e) => setLiberado(e.target.checked)}
        />
        Confirmo a configuração desta empresa no provedor e libero o envio de NF-e pela loja.
      </label>
      <Button
        disabled={!admin || estado.isLoading || !!estado.error || salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        Salvar liberação
      </Button>
    </section>
  );
}
