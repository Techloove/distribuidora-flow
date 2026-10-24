import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { forecastPreviaHomologacao } from "@/lib/forecast-previa.functions";
import { useSupabase } from "@/lib/supabase-provider";
import { ForecastEnvioHml } from "./forecast-envio-hml";

export function ForecastPrevia({ nota, onClose }: { nota: string; onClose: () => void }) {
  const { session } = useSupabase();
  const conferir = useServerFn(forecastPreviaHomologacao);
  const q = useQuery({
    queryKey: ["forecast-previa", nota, session?.user.id],
    enabled: !!session,
    retry: false,
    staleTime: 0,
    queryFn: () => conferir({ data: { nota, accessToken: session!.access_token } }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Forecast · Homologação NF-e</DialogTitle>
          <DialogDescription>
            Confira a prévia e acompanhe o teste de homologação. O envio depende de liberação da
            loja e confirmação explícita.
          </DialogDescription>
        </DialogHeader>
        {q.isFetching && <p role="status">Conferindo dados da nota e da loja...</p>}
        {q.error && (
          <p role="alert" className="text-destructive">
            {q.error.message}
          </p>
        )}
        {q.data && !q.isFetching && !q.error && (
          <div className="space-y-4 text-sm">
            <p>
              CNPJ da loja: <strong>{q.data.cnpj_loja}</strong> · Homologação
            </p>
            <p className="rounded-lg bg-muted p-3">{q.data.mensagem}</p>
            <h3 className="font-semibold">Conferência do cadastro e dos valores</h3>
            {q.data.pendencias.length ? (
              <ul className="list-disc pl-5 space-y-1">
                {q.data.pendencias.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p>
                Cadastros e valores passaram nesta conferência local. Produção continua bloqueada.
              </p>
            )}
            <h3 className="font-semibold">Confirmações necessárias antes da transmissão</h3>
            <ul className="list-disc pl-5 space-y-1">
              {q.data.confirmacoes_externas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {q.data.payload_proposto && (
              <details>
                <summary className="cursor-pointer font-medium">
                  Ver rascunho dos campos NF-e
                </summary>
                <p className="mt-2">
                  Rascunho parcial para revisão; faltam confirmações tributárias e do contrato. Não
                  é uma nota autorizada ou pronta para envio.
                </p>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(q.data.payload_proposto, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
        <Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>
          Conferir novamente
        </Button>
        {session && (
          <ForecastEnvioHml
            key={nota}
            nota={nota}
            cadastroOk={!!q.data?.cadastro_conferido && !q.isFetching && !q.error}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
