import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { sicrediConfirmarNossoNumero } from "@/lib/sicredi.functions";
export function ConfirmarNossoNumero({ boleto }: { boleto: Record<string, unknown> }) {
  const { session, roles } = useSupabase(),
    qc = useQueryClient(),
    confirm = useServerFn(sicrediConfirmarNossoNumero);
  const canFinance = roles.some((role) => ["admin", "gestor", "financeiro"].includes(role));
  const [open, setOpen] = useState(false),
    [number, setNumber] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (
    !canFinance ||
    boleto["canal"] !== "api" ||
    boleto["ambiente"] !== "producao" ||
    boleto["status"] !== "registrado" ||
    boleto["nosso_numero"] ||
    !boleto["linha_digitavel"]
  )
    return null;
  async function save() {
    if (busy || !session) return;
    setBusy(true);
    setError("");
    try {
      await confirm({
        data: {
          boletoId: String(boleto["id"]),
          nossoNumero: number,
          accessToken: session.access_token,
        },
      });
      await qc.invalidateQueries({ queryKey: ["boletos"] });
      toast.success("Nosso número confirmado no Sicredi");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível confirmar o número.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setNumber("");
          setError("");
          setOpen(true);
        }}
      >
        Confirmar nosso número
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar nosso número</DialogTitle>
            <DialogDescription>
              Informe o número de 9 dígitos que aparece no PDF ou no Sicredi. Vamos conferir se ele
              corresponde à linha digitável deste boleto antes de salvar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sicredi-nosso-confirmar">Nosso número</Label>
            <Input
              id="sicredi-nosso-confirmar"
              inputMode="numeric"
              maxLength={9}
              value={number}
              disabled={busy}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy || !/^\d{9}$/.test(number)} onClick={() => void save()}>
              {busy ? "Conferindo…" : "Conferir e salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
