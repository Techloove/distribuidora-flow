import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import {
  faznotasProcessarNfe,
  faznotasStatusNfe,
  type StatusNfe,
} from "@/lib/faznotas-nfe.functions";

function linkFiscal(v: string | null) {
  try {
    const u = new URL(v ?? "");
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
const titulos: Record<string, string> = {
  preparando: "Preparação anterior sem recibo",
  enviando: "Tentativa anterior em envio",
  processando: "Aguardando retorno fiscal",
  autorizada: "NF-e autorizada",
  rejeitada: "Emissão recusada",
  incerta: "Retorno precisa de conferência",
  cancelada: "Documento cancelado no provedor",
};
export function FaznotasNfe({ nota, onClose }: { nota: string; onClose: () => void }) {
  const { client, session } = useSupabase();
  const qc = useQueryClient();
  const statusFn = useServerFn(faznotasStatusNfe);
  const processarFn = useServerFn(faznotasProcessarNfe);
  const args = { nota, accessToken: session?.access_token };
  const key = ["nfe-status", nota];
  const [consultado, setConsultado] = useState(false);
  const status = useQuery({
    queryKey: key,
    enabled: !!session,
    queryFn: () => statusFn({ data: args }),
    refetchOnWindowFocus: false,
  });
  const atualizar = useMutation({
    mutationFn: () => processarFn({ data: { ...args, recuperar: true } }),
    onSuccess: async (r: StatusNfe) => {
      setConsultado(true);
      qc.setQueryData(key, r);
      await qc.invalidateQueries({ queryKey: ["notas_saida"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      void status.refetch();
    },
  });
  const descartar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("abortar_preparacao_nfe_259", { _nota: nota });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notas_saida"] });
      await status.refetch();
      toast.success("Preparação descartada sem emissão de nova nota");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const r = status.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico fiscal · FAZNOTAS</DialogTitle>
          <DialogDescription>
            Novas emissões estão desativadas. Documentos anteriores mantêm o vínculo com o provedor
            original.
          </DialogDescription>
        </DialogHeader>
        {status.isLoading && <p>Carregando documento fiscal...</p>}
        {status.error && (
          <p role="alert" className="text-destructive">
            {status.error.message}
          </p>
        )}
        {r?.vinculada ? (
          <div className="space-y-4">
            <h3 className="font-semibold">{titulos[r.estado ?? ""] ?? "Documento anterior"}</h3>
            <p className="text-sm">
              Ambiente declarado: {r.ambiente === "producao" ? "Produção" : "Homologação"}
            </p>
            {r.mensagem && <p className="rounded-lg bg-muted p-3 text-sm">{r.mensagem}</p>}
            {r.recibo ? (
              <p className="break-all text-sm">Recibo: {r.recibo}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Esta tentativa não tem recibo salvo. Confira sua situação no painel FAZNOTAS antes
                de emitir em outro provedor. A aplicação não reenviará este documento.
              </p>
            )}
            {r.request_id && (
              <p className="text-xs text-muted-foreground">Referência do suporte: {r.request_id}</p>
            )}
            {r.estado === "autorizada" && (
              <div className="rounded-lg border p-4 space-y-2">
                <p>
                  NF-e {r.nf_numero} · Série {r.serie}
                </p>
                <p className="break-all text-sm">Chave: {r.chave}</p>
                <p className="text-sm">Protocolo: {r.protocolo}</p>
                <div className="flex gap-3">
                  {linkFiscal(r.danfe_url) && (
                    <a
                      className="underline"
                      href={linkFiscal(r.danfe_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir DANFE
                    </a>
                  )}
                  {linkFiscal(r.xml_url) && (
                    <a
                      className="underline"
                      href={linkFiscal(r.xml_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir XML
                    </a>
                  )}
                </div>
              </div>
            )}
            {r.estado === "rejeitada" && (
              <p className="text-sm">
                Confira o motivo com o contador e o provedor original antes de iniciar outra
                emissão.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !r.recibo ||
                  r.estado === "cancelada" ||
                  atualizar.isPending ||
                  descartar.isPending
                }
                onClick={() => atualizar.mutate()}
              >
                {atualizar.isPending ? "Consultando..." : "Consultar recibo no provedor anterior"}
              </Button>
              {["preparando", "incerta", "rejeitada"].includes(r.estado ?? "") && !r.recibo && (
                <Button
                  variant="outline"
                  disabled={!client || atualizar.isPending || descartar.isPending}
                  onClick={() => descartar.mutate()}
                >
                  Descartar preparação sem envio confirmado
                </Button>
              )}
            </div>
            {consultado && (
              <p className="text-xs text-muted-foreground">
                Consulta concluída. A autorização depende do retorno fiscal confirmado.
              </p>
            )}
          </div>
        ) : (
          r && (
            <p className="text-sm">
              Não há emissão FAZNOTAS vinculada. A nova integração Forecast Fiscal está em
              preparação.
            </p>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
