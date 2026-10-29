import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Printer } from "lucide-react";
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
import { useCentro } from "@/lib/centro-store";
import { sicrediPdfBoleto } from "@/lib/sicredi.functions";
import {
  boletosParaImpressao,
  unirPdfsBoletos,
  type BoletoDocumento,
} from "@/lib/boletos-documento";
import { lerPaginas } from "@/lib/paginacao";
import { dataBr } from "@/lib/formatacao";

type Contexto = {
  contaId?: string | undefined;
  pedidoId?: string | undefined;
  boletoId?: string | undefined;
};
type Registro = BoletoDocumento & {
  cliente_id: string;
  pedido_id: string | null;
  documento: string | null;
  parcela: number;
  nosso_numero: string;
  vencimento: string;
};
export function ImprimirBoletos(props: Contexto) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Printer className="size-4" />
        Reimprimir boleto
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Imprimir boletos</DialogTitle>
            <DialogDescription>
              Selecione boletos da parcela, do pedido ou do mesmo cliente. Os PDFs originais serão
              reunidos, sem nova cobrança.
            </DialogDescription>
          </DialogHeader>
          {open && <PainelImpressaoBoletos {...props} onBusy={setBusy} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function PainelImpressaoBoletos({
  contaId,
  pedidoId,
  boletoId,
  onBusy,
  onVoltar,
}: Contexto & { onBusy?: (busy: boolean) => void; onVoltar?: () => void }) {
  const { client, user, session } = useSupabase();
  const { centro } = useCentro();
  const obterPdf = useServerFn(sicrediPdfBoleto);
  const [scope, setScope] = useState<"parcela" | "pedido" | "cliente">(
    contaId ? "parcela" : "pedido",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [pdf, setPdf] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [mock, setMock] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    running = useRef(false),
    cancel = useRef(false);
  useEffect(
    () => () => {
      cancel.current = true;
    },
    [],
  );
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf);
    },
    [pdf],
  );
  const anchor = useQuery({
    queryKey: ["impressao-contexto", user?.id, contaId, pedidoId, boletoId],
    enabled: !!client && !!session,
    queryFn: async () => {
      if (boletoId) {
        const { data, error } = await client!
          .from("boletos")
          .select("cliente_id,pedido_id,conta_receber_id")
          .eq("id", boletoId)
          .single();
        if (error) throw new Error("Não foi possível consultar o boleto.");
        return {
          cliente: String(data.cliente_id ?? ""),
          pedido: String(data.pedido_id ?? ""),
          conta: String(data.conta_receber_id ?? ""),
        };
      }
      const { data, error } = await client!
        .from("contas_receber")
        .select("id,cliente_id,pedido_id")
        .eq(contaId ? "id" : "pedido_id", contaId ?? pedidoId!)
        .order("id")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Não foi possível consultar o documento.");
      return {
        cliente: String(data?.cliente_id ?? ""),
        pedido: String(data?.pedido_id ?? pedidoId ?? ""),
        conta: String(data?.id ?? contaId ?? ""),
      };
    },
  });
  const query = useQuery({
    queryKey: ["impressao-boletos", user?.id, anchor.data, scope, centro],
    enabled: !!client && anchor.isSuccess,
    queryFn: async () => {
      const a = anchor.data!;
      const field =
        scope === "cliente" ? "cliente_id" : scope === "pedido" ? "pedido_id" : "conta_receber_id";
      const value = scope === "cliente" ? a.cliente : scope === "pedido" ? a.pedido : a.conta;
      if (!value) return [];
      const rows = await lerPaginas<Registro>((inicio, fim) => {
        let q = client!.from("boletos").select("*").eq(field, value);
        if (centro) q = q.eq("centro_id", centro);
        return q.order("vencimento").order("id").range(inicio, fim);
      });
      // Mesmo cliente em todos os escopos e somente o ciclo vigente de cada parcela.
      return boletosParaImpressao(rows, a.cliente);
    },
  });
  const rows = query.data ?? [];
  const chosen = rows.filter((b) => selected.includes(b.id));
  async function imprimir() {
    if (running.current || !session || !chosen.length || query.isFetching) return;
    running.current = true;
    cancel.current = false;
    setBusy(true);
    onBusy?.(true);
    setError("");
    setPdf(null);
    try {
      const files: string[] = [];
      for (const [i, b] of chosen.entries()) {
        // Distribui as consultas para respeitar o teto bancário de 20 por minuto,
        // incluindo consultas recentes feitas em outras telas pelo mesmo usuário.
        if (i > 0 && i % 20 === 0) {
          setProgress("Aguardando o limite bancário para continuar…");
          for (let second = 0; second < 61 && !cancel.current; second++)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (cancel.current)
          throw new Error("Impressão interrompida. Nenhuma cobrança foi criada ou alterada.");
        setProgress(`Obtendo PDF ${i + 1} de ${chosen.length}…`);
        let result;
        try {
          result = await obterPdf({ data: { boletoId: b.id, accessToken: session.access_token } });
        } catch (e) {
          if (!(e instanceof Error) || !e.message.includes("Limite de consultas atingido")) throw e;
          setProgress("Limite de consultas atingido. Aguardando para continuar…");
          for (let second = 0; second < 61 && !cancel.current; second++)
            await new Promise((resolve) => setTimeout(resolve, 1000));
          if (cancel.current) throw new Error("Impressão interrompida.");
          result = await obterPdf({ data: { boletoId: b.id, accessToken: session.access_token } });
        }
        files.push(result.base64);
      }
      if (cancel.current) throw new Error("Impressão interrompida.");
      const bytes = await unirPdfsBoletos(files);
      if (cancel.current) throw new Error("Impressão interrompida.");
      setMock(chosen.some((b) => b.ambiente === "homologacao"));
      setReady(false);
      setPdf(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível reunir os PDFs. Tente novamente.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusy?.(false);
      setProgress("");
    }
  }
  return (
    <div className="space-y-4">
      {pdf ? (
        <>
          {mock && (
            <p role="alert" className="text-sm text-amber-700">
              HOMOLOGAÇÃO: documentos de teste. Não encaminhe para pagamento.
            </p>
          )}
          <iframe
            title="Prévia dos boletos selecionados"
            ref={frame}
            src={pdf}
            className="h-[55dvh] w-full rounded border"
            onLoad={() => setReady(true)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPdf(null)}>
              Voltar à seleção
            </Button>
            <Button asChild>
              <a href={pdf} download="boletos-selecionados.pdf">
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
                  toast.error("Baixe o PDF para imprimir no seu dispositivo.");
                }
              }}
            >
              <Printer className="size-4" />
              Imprimir PDF
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="block text-sm">
            Exibir boletos de
            <select
              aria-label="Agrupar boletos para impressão"
              className="mt-1 block w-full rounded border bg-background p-2"
              value={scope}
              disabled={busy || anchor.isPending}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                setSelected([]);
                setError("");
              }}
            >
              <option value="parcela" disabled={!contaId && !boletoId}>
                Esta parcela
              </option>
              <option value="pedido" disabled={anchor.isSuccess && !anchor.data.pedido}>
                Mesmo pedido
              </option>
              <option value="cliente" disabled={anchor.isSuccess && !anchor.data.cliente}>
                Mesmo cliente
              </option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Somente boletos acessíveis na loja selecionada. Boletos baixados, cancelados ou sem PDF
            não entram na impressão. Lotes maiores aguardam automaticamente o limite bancário.
          </p>
          {(anchor.isPending || query.isFetching) && <p role="status">Carregando boletos…</p>}
          {(anchor.isError || query.isError || error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || anchor.error?.message || query.error?.message}
            </p>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              disabled={busy || query.isFetching || !rows.length}
              checked={rows.length > 0 && chosen.length === rows.length}
              onChange={(e) => setSelected(e.target.checked ? rows.map((b) => b.id) : [])}
            />
            Selecionar todos{" "}
            {scope === "cliente"
              ? "do mesmo cliente"
              : scope === "pedido"
                ? "do mesmo pedido"
                : "da parcela"}{" "}
            ({rows.length})
          </label>
          <div className="max-h-72 overflow-auto rounded border">
            {rows.map((b) => (
              <label key={b.id} className="flex items-start gap-3 border-b p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`Selecionar boleto ${b.nosso_numero}`}
                  disabled={busy || query.isFetching}
                  checked={selected.includes(b.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, b.id] : old.filter((id) => id !== b.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {b.documento || "Título"} · Parcela {b.parcela} · {dataBr(b.vencimento)}
                  </span>
                  <span className="block">
                    Boleto {b.nosso_numero} ·{" "}
                    {Number(b.valor).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}{" "}
                    · {b.status === "liquidado" ? "Liquidado" : "Registrado"}
                  </span>
                </span>
              </label>
            ))}
            {query.isSuccess && !rows.length && (
              <p className="p-3 text-sm">Nenhum boleto com PDF disponível neste grupo.</p>
            )}
          </div>
          {progress && (
            <p role="status" className="text-sm">
              {progress}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {onVoltar && (
              <Button variant="outline" disabled={busy} onClick={onVoltar}>
                Voltar à emissão
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy || query.isFetching}
              onClick={() => {
                setSelected([]);
                void anchor.refetch();
                void query.refetch();
              }}
            >
              Atualizar lista
            </Button>
            {busy ? (
              <Button
                variant="outline"
                onClick={() => {
                  cancel.current = true;
                }}
              >
                Interromper impressão
              </Button>
            ) : null}
            <Button
              disabled={busy || query.isFetching || !chosen.length}
              onClick={() => void imprimir()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Abrir PDF selecionados ({chosen.length})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
