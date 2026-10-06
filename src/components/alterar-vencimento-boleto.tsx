import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { sicrediAlterarVencimento, sicrediConsultarBoleto } from "@/lib/sicredi.functions";
import { cnabAlterarVencimento } from "@/lib/sicredi-cnab.functions";

type Row = Record<string, unknown>;
export function AlterarVencimentoBoleto({ boleto }: { boleto: Row }) {
  const { session, roles } = useSupabase();
  const qc = useQueryClient();
  const api = useServerFn(sicrediAlterarVencimento),
    cnab = useServerFn(cnabAlterarVencimento),
    consultar = useServerFn(sicrediConsultarBoleto);
  const [open, setOpen] = useState(false),
    [date, setDate] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = !!boleto["vencimento_solicitacao_id"];
  if (
    !roles.some((role) => ["admin", "gestor", "financeiro"].includes(role)) ||
    boleto["banco"] !== "sicredi" ||
    boleto["status"] !== "registrado"
  )
    return null;
  async function action(check = false) {
    if (busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      if (check) {
        await consultar({
          data: { boletoId: String(boleto["id"]), accessToken: session.access_token },
        });
        toast.success(
          "Situação consultada no Sicredi. Confira o vencimento e a solicitação pendente.",
        );
      } else if (boleto["canal"] === "cnab240") {
        const file = await cnab({
          data: {
            centro_id: String(boleto["centro_id"]),
            boleto_id: String(boleto["id"]),
            vencimento: date,
            accessToken: session.access_token,
          },
        });
        const url = URL.createObjectURL(
          new Blob([file.content], { type: "text/plain;charset=us-ascii" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(
          "Remessa de alteração gerada. Envie ao Sicredi e importe o retorno para confirmar.",
        );
      } else {
        const result = await api({
          data: {
            boletoId: String(boleto["id"]),
            vencimento: date,
            accessToken: session.access_token,
          },
        });
        toast.success(result.mensagem);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível alterar o vencimento.");
    } finally {
      await Promise.all(
        ["boletos", "cnab", "contas_receber", "vw_titulos_receber", "emissao-boletos"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          setDate(String(boleto["vencimento"] ?? ""));
          setError(null);
        }}
      >
        {pending ? "Alteração pendente" : "Alterar vencimento"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar vencimento do boleto</DialogTitle>
            <DialogDescription>
              O vencimento do boleto e da parcela será atualizado após a confirmação do Sicredi.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Nosso número: {String(boleto["nosso_numero"])} · Vencimento atual:{" "}
            {String(boleto["vencimento"])}
          </p>
          {pending ? (
            <p className="text-sm">
              Vencimento solicitado: {String(boleto["vencimento_solicitado"])}.{" "}
              {boleto["canal"] === "cnab240"
                ? "Envie a remessa salva no histórico de Boletos e importe o retorno do Sicredi."
                : "Consulte o Sicredi para conferir a confirmação; não reenvie a solicitação."}
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`boleto-data-${boleto["id"]}`}>Novo vencimento</Label>
              <Input
                id={`boleto-data-${boleto["id"]}`}
                type="date"
                disabled={busy}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {boleto["canal"] === "cnab240" && (
                <p className="text-sm text-muted-foreground">
                  Será gerada uma remessa de alteração de vencimento para envio ao Sicredi Internet
                  Empresas.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Fechar
            </Button>
            {pending ? (
              boleto["canal"] !== "cnab240" && (
                <Button disabled={busy} onClick={() => void action(true)}>
                  Conferir no Sicredi
                </Button>
              )
            ) : (
              <Button
                disabled={busy || !date || date === boleto["vencimento"]}
                onClick={() => void action()}
              >
                Solicitar alteração
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
