import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import {
  forecastHmlLiberacaoGet,
  forecastHmlLiberacaoSave,
} from "@/lib/forecast-homologacao.functions";

export function ForecastLiberacaoHml({ loja }: { loja: string }) {
  const { session, roles } = useSupabase(),
    qc = useQueryClient();
  const get = useServerFn(forecastHmlLiberacaoGet),
    save = useServerFn(forecastHmlLiberacaoSave);
  const [confirmado, setConfirmado] = useState(false);
  const q = useQuery({
    queryKey: ["forecast-hml-liberacao", loja, session?.user.id],
    enabled: !!session,
    retry: false,
    queryFn: () => get({ data: { loja, accessToken: session!.access_token } }),
  });
  const m = useMutation({
    mutationFn: (liberado: boolean) =>
      save({ data: { loja, accessToken: session!.access_token, liberado, confirmado } }),
    onSuccess: async () => {
      setConfirmado(false);
      await qc.invalidateQueries({ queryKey: ["forecast-hml-liberacao", loja] });
      await qc.invalidateQueries({ queryKey: ["forecast-hml-status"] });
      toast.success("Configuração de homologação atualizada. Produção continua bloqueada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <h4 className="font-medium">Envio de testes em homologação</h4>
      <p className="text-sm">
        Produção bloqueada. Alterar o token, CNPJ ou os dados fiscais invalida esta liberação.
      </p>
      {q.error && (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          <p className="text-sm">
            Envio de homologação:{" "}
            {q.data.liberado ? "habilitado para a configuração atual" : "bloqueado"}.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmado}
              disabled={!roles.includes("admin") || m.isPending}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Conferi com a Forecast o contrato de NF-e (valores, referência e pagamentos), o token de
            homologação deste CNPJ, o certificado, a série e as regras tributárias por NCM com o
            contador.
          </label>
          <div className="flex gap-2">
            <Button
              disabled={!roles.includes("admin") || !confirmado || m.isPending || q.isFetching}
              onClick={() => m.mutate(true)}
            >
              Habilitar homologação desta loja
            </Button>
            <Button
              variant="outline"
              disabled={!roles.includes("admin") || m.isPending || !q.data.liberado}
              onClick={() => m.mutate(false)}
            >
              Suspender testes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
