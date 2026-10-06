import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Barcode, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { sicrediEmitirBoleto } from "@/lib/sicredi.functions";
import { cnabGerarRemessa } from "@/lib/sicredi-cnab.functions";

type Parcela = { conta_receber_id: string; parcela: number; vencimento: string; saldo: number };
const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function EmitirBoletosPedido({
  pedidoId,
  centroId,
}: {
  pedidoId: string;
  centroId: string;
}) {
  const { roles } = useSupabase();
  if (!roles.some((role) => ["admin", "gestor", "financeiro"].includes(role))) return null;
  return <EmissaoPedido key={pedidoId} pedidoId={pedidoId} centroId={centroId} />;
}

export function EmitirBoletoTitulo({ contaId, centroId }: { contaId: string; centroId: string }) {
  const { roles } = useSupabase();
  if (!roles.some((role) => ["admin", "gestor", "financeiro"].includes(role))) return null;
  return <EmissaoPedido key={contaId} contaId={contaId} centroId={centroId} />;
}

function EmissaoPedido({
  pedidoId,
  contaId,
  centroId,
}: {
  pedidoId?: string;
  contaId?: string;
  centroId: string;
}) {
  const { client, session } = useSupabase();
  const qc = useQueryClient();
  const api = useServerFn(sicrediEmitirBoleto);
  const cnab = useServerFn(cnabGerarRemessa);
  const [open, setOpen] = useState(false);
  const [canal, setCanal] = useState<"api" | "cnab240">("api");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parcelas = useQuery({
    queryKey: ["emissao-boletos", pedidoId, contaId],
    enabled: open && !!client && !!session,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_boletos_pendentes")
        .select("conta_receber_id,parcela,vencimento,saldo")
        .eq(contaId ? "conta_receber_id" : "pedido_id", contaId ?? pedidoId!)
        .order("parcela");
      if (error) throw new Error("Não foi possível carregar as parcelas deste pedido.");
      return (data ?? []) as Parcela[];
    },
  });
  const ids = (parcelas.data ?? [])
    .filter((p) => selected.includes(p.conta_receber_id))
    .map((p) => p.conta_receber_id);
  async function emitir() {
    if (busy || !session || !ids.length) return;
    setBusy(true);
    setError(null);
    let emitted = 0;
    try {
      if (canal === "cnab240") {
        if (!centroId)
          throw new Error(
            "O pedido precisa estar vinculado a um centro de custo para emitir por CNAB.",
          );
        const file = await cnab({
          data: { centro_id: centroId, accessToken: session.access_token, conta_ids: ids },
        });
        const url = URL.createObjectURL(
          new Blob([file.content], { type: "text/plain;charset=us-ascii" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("Remessa gerada. Envie o arquivo ao Sicredi Internet Empresas.");
      } else {
        if (ids.length > 10) throw new Error("Selecione até 10 parcelas por emissão via API.");
        for (const contaId of ids) {
          await api({ data: { contaId, accessToken: session.access_token } });
          emitted++;
        }
        toast.success(`${emitted} boleto(s) registrado(s) no Sicredi.`);
      }
      setSelected([]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao emitir os boletos.";
      setError(emitted > 0 ? `${emitted} boleto(s) emitido(s). ${message}` : message);
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["emissao-boletos", pedidoId, contaId] }),
        qc.invalidateQueries({ queryKey: ["boletos"] }),
        qc.invalidateQueries({ queryKey: ["cnab"] }),
        qc.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] }),
        qc.invalidateQueries({ queryKey: ["contas_receber"] }),
        qc.invalidateQueries({ queryKey: ["vw_titulos_receber"] }),
      ]);
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setSelected([]);
          setError(null);
        }}
      >
        <Barcode className="size-4" /> {contaId ? "Emitir boleto" : "Emitir boletos"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {contaId ? "Emitir boleto da parcela" : "Emitir boletos do pedido"}
            </DialogTitle>
            <DialogDescription>
              Selecione as parcelas em aberto. As regras de cobrança são mantidas em Configurações
              do sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`pedido-canal-${contaId ?? pedidoId}`}>Forma de emissão</Label>
            <select
              id={`pedido-canal-${contaId ?? pedidoId}`}
              className="h-10 w-full rounded-md border bg-background px-2"
              disabled={busy}
              value={canal}
              onChange={(e) => {
                setCanal(e.target.value as "api" | "cnab240");
                setError(null);
              }}
            >
              <option value="api">Registro direto no Sicredi (API)</option>
              <option value="cnab240">Arquivo de remessa CNAB 240</option>
            </select>
            {canal === "cnab240" && (
              <p className="text-sm text-muted-foreground">
                O arquivo será baixado para envio ao Sicredi. O registro e o QR Code híbrido serão
                confirmados pelo retorno em Boletos.
              </p>
            )}
          </div>
          {parcelas.isLoading && <p role="status">Carregando parcelas…</p>}
          {parcelas.isError && (
            <p role="alert" className="text-sm text-destructive">
              {parcelas.error.message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="max-h-64 overflow-auto rounded-md border">
            {(parcelas.data ?? []).map((p) => (
              <label
                key={p.conta_receber_id}
                className="flex items-center gap-3 border-b p-3 text-sm"
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(p.conta_receber_id)}
                  onChange={(e) =>
                    setSelected((previous) =>
                      e.target.checked
                        ? [...previous, p.conta_receber_id]
                        : previous.filter((id) => id !== p.conta_receber_id),
                    )
                  }
                />
                <span>
                  Parcela {p.parcela} · {p.vencimento.split("-").reverse().join("/")} ·{" "}
                  {money(p.saldo)}
                </span>
              </label>
            ))}
            {parcelas.data?.length === 0 && (
              <p className="p-3 text-sm">
                Nenhuma parcela disponível para emissão. As parcelas já cobradas ou pagas não são
                exibidas.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={busy || parcelas.isFetching || parcelas.isError || !ids.length}
              onClick={() => void emitir()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Emitir selecionadas (
              {ids.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
