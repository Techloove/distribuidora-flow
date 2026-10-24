import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import {
  forecastDocumentosHml,
  forecastBaixarDocumentoHml,
} from "@/lib/forecast-documentos.functions";

export function ForecastDocumentosHml({ nota }: { nota: string }) {
  const { session } = useSupabase(),
    qc = useQueryClient();
  const listar = useServerFn(forecastDocumentosHml),
    baixar = useServerFn(forecastBaixarDocumentoHml);
  const q = useQuery({
    queryKey: ["forecast-hml-documentos", nota, session?.user.id],
    enabled: !!session,
    retry: false,
    queryFn: () => listar({ data: { nota, accessToken: session!.access_token } }),
  });
  const m = useMutation({
    mutationFn: async (tipo: "xml" | "pdf") => {
      const a = await baixar({ data: { nota, tipo, accessToken: session!.access_token } });
      const s = atob(a.base64),
        bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== a.sha256)
        throw new Error("A integridade do arquivo recebido não foi confirmada.");
      const url = URL.createObjectURL(new Blob([bytes], { type: a.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = a.nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return tipo;
    },
    onSuccess: (tipo) =>
      toast.success(`${tipo === "xml" ? "XML" : "DANFE"} de homologação baixado.`),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["forecast-hml-documentos", nota] }),
  });
  return (
    <section className="space-y-3 rounded-lg border p-3 text-sm">
      <h3 className="font-semibold">Documentos de homologação · Sem valor fiscal</h3>
      <p>
        Os arquivos ficam separados da nota operacional. O XML passa por conferência de estrutura e
        identidade; a assinatura digital não é validada. O DANFE é conferido quanto ao formato.
      </p>
      {q.error && (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          <p>
            CNPJ da tentativa: {q.data.cnpj} · Referência: {q.data.ref}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!q.data.envio_iniciado || m.isPending || q.isFetching}
              onClick={() => m.mutate("xml")}
            >
              {m.isPending ? "Obtendo documento..." : "Baixar XML de homologação"}
            </Button>
            <Button
              variant="outline"
              disabled={!q.data.envio_iniciado || m.isPending || q.isFetching}
              onClick={() => m.mutate("pdf")}
            >
              Baixar DANFE de homologação
            </Button>
          </div>
          <p>
            O DANFE depende de um XML conferido para a mesma tentativa. Se o arquivo ainda não
            estiver disponível, consulte novamente a referência; esta ação não emite nem reenvia
            notas.
          </p>
          {!!q.data.documentos.length && (
            <ul className="space-y-2">
              {q.data.documentos.map((d) => (
                <li key={d.tipo} className="rounded bg-muted p-2">
                  <span className="font-medium">
                    {d.tipo === "xml" ? "XML conferido" : "DANFE armazenado"}
                  </span>{" "}
                  · {Math.ceil(d.bytes / 1024)} KB
                  <details>
                    <summary className="cursor-pointer">Ver integridade do arquivo</summary>
                    <p className="break-all">SHA-256: {d.sha256}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
