import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { sicrediPdfBoleto } from "@/lib/sicredi.functions";
import { boletoImprimivel } from "@/lib/boletos-documento";
import { useSupabase } from "@/lib/supabase-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function ReimprimirBoleto({ boleto }: { boleto: Record<string, unknown> }) {
  const { session, roles } = useSupabase();
  const obterPdf = useServerFn(sicrediPdfBoleto);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [pdf, setPdf] = useState<string | null>(null),
    [erro, setErro] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    trabalhando = useRef(false);
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf);
    },
    [pdf],
  );
  const imprimivel = boletoImprimivel({
    banco: String(boleto["banco"]),
    canal: String(boleto["canal"]),
    status: String(boleto["status"]),
    linha_digitavel:
      typeof boleto["linha_digitavel"] === "string" ? boleto["linha_digitavel"] : null,
  });
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r)) || !imprimivel) return null;
  async function abrir() {
    if (trabalhando.current || !session) return;
    trabalhando.current = true;
    setBusy(true);
    setOpen(true);
    setErro(null);
    setReady(false);
    setPdf(null);
    try {
      const result = await obterPdf({
        data: { boletoId: String(boleto["id"]), accessToken: session.access_token },
      });
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      setPdf(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível obter o PDF do boleto.");
    } finally {
      trabalhando.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy || !session} onClick={() => void abrir()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
        Reimprimir boleto
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v);
            if (!v) setPdf(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[95dvh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Reimprimir boleto · {String(boleto["nosso_numero"] ?? "")}</DialogTitle>
            <DialogDescription>
              PDF original do Sicredi. Reimprimir não gera uma nova cobrança.
              {boleto["status"] === "liquidado" ? " Este boleto já está liquidado." : ""}
            </DialogDescription>
          </DialogHeader>
          {boleto["ambiente"] === "homologacao" && (
            <p role="alert" className="text-sm">
              HOMOLOGAÇÃO: documento de teste, não encaminhe para pagamento.
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 py-8">
              <Loader2 className="size-4 animate-spin" />
              Obtendo PDF do Sicredi…
            </p>
          )}
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          {pdf && (
            <iframe
              ref={frame}
              src={pdf}
              title="Prévia do boleto"
              className="h-[60dvh] min-h-60 w-full rounded border"
              onLoad={() => setReady(true)}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setPdf(null);
              }}
            >
              Fechar
            </Button>
            {pdf && (
              <>
                <Button asChild variant="secondary">
                  <a
                    href={pdf}
                    download={`boleto-${String(boleto["nosso_numero"] ?? boleto["id"])}.pdf`}
                  >
                    <Download className="size-4" />
                    Baixar PDF
                  </a>
                </Button>
                <Button
                  disabled={!ready}
                  onClick={() => {
                    try {
                      frame.current?.contentWindow?.focus();
                      frame.current?.contentWindow?.print();
                    } catch {
                      toast.error("Baixe o PDF para imprimir pelo leitor do seu dispositivo.");
                    }
                  }}
                >
                  <Printer className="size-4" />
                  Imprimir PDF
                </Button>
              </>
            )}
            {erro && <Button onClick={() => void abrir()}>Tentar novamente</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
