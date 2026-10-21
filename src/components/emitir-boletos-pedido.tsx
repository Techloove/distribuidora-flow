import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Barcode, Download, Loader2, Printer } from "lucide-react";
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
import { useSupabase } from "@/lib/supabase-provider";
import { sicrediEmitirBoleto, sicrediPdfBoleto } from "@/lib/sicredi.functions";
import {
  boletoAtual,
  boletoImprimivel,
  unirPdfsBoletos,
  saldoTituloBoleto,
  type TituloBoleto,
  type BoletoDocumento,
} from "@/lib/boletos-documento";
import { lerPaginas } from "@/lib/paginacao";

const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const estados: Record<string, string> = {
  registrado: "Boleto emitido",
  liquidado: "Boleto liquidado",
  em_processamento: "Emissão em processamento",
  pendente: "Registro pendente",
  erro: "Emissão com erro",
  baixado: "Boleto baixado",
  cancelado: "Boleto cancelado",
};
type Props = { pedidoId?: string; contaId?: string; centroId: string; compact?: boolean };
export function EmitirBoletosPedido(props: {
  pedidoId: string;
  centroId: string;
  compact?: boolean;
}) {
  return <BoletosDocumento {...props} />;
}
export function EmitirBoletoTitulo(props: { contaId: string; centroId: string }) {
  return <BoletosDocumento {...props} compact />;
}
function BoletosDocumento(props: Props) {
  const { roles } = useSupabase();
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r))) return null;
  return <JanelaBoletos key={props.pedidoId ?? props.contaId} {...props} />;
}
function JanelaBoletos({ pedidoId, contaId, centroId, compact = false }: Props) {
  const { client, session, user } = useSupabase();
  const qc = useQueryClient();
  const emitirApi = useServerFn(sicrediEmitirBoleto),
    pdfApi = useServerFn(sicrediPdfBoleto);
  const [open, setOpen] = useState(false),
    [modo, setModo] = useState<"emitir" | "imprimir">("emitir");
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null),
    [progresso, setProgresso] = useState("");
  const [pdf, setPdf] = useState<string | null>(null),
    [mock, setMock] = useState(false),
    [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const trabalhando = useRef(false);
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf);
    },
    [pdf],
  );
  const chave = ["emissao-boletos", user?.id, pedidoId, contaId];
  const cobranca = useQuery({
    queryKey: ["cobranca-emissao", user?.id, centroId],
    enabled: open && !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("cobranca_centros")
        .select("banco,canal,ativo")
        .eq("centro_id", centroId)
        .maybeSingle();
      if (error) throw new Error("Não foi possível consultar a cobrança do centro.");
      return data;
    },
  });
  const habilitado =
    cobranca.data?.banco === "sicredi" &&
    cobranca.data?.canal === "api" &&
    cobranca.data?.ativo === true;
  const consulta = useQuery({
    queryKey: chave,
    enabled: open && !!client && !!session,
    queryFn: async () => {
      // Todas as leituras usam a sessão/RLS. Não busca títulos de outros pedidos.
      const [titulos, boletos, pendentes] = await Promise.all([
        lerPaginas<TituloBoleto>((inicio, fim) =>
          client!
            .from("contas_receber")
            .select(
              "id,pedido_id,parcela,vencimento,valor,status,juros,multa,acrescimo,desconto,valor_pago",
            )
            .eq(contaId ? "id" : "pedido_id", contaId ?? pedidoId!)
            .order("parcela")
            .order("id")
            .range(inicio, fim),
        ),
        lerPaginas<BoletoDocumento>((inicio, fim) =>
          client!
            .from("boletos")
            .select(
              "id,valor,conta_receber_id,status,banco,canal,linha_digitavel,ambiente,created_at",
            )
            .eq(contaId ? "conta_receber_id" : "pedido_id", contaId ?? pedidoId!)
            .order("created_at")
            .order("id")
            .range(inicio, fim),
        ),
        lerPaginas<{ conta_receber_id: string }>((inicio, fim) =>
          client!
            .from("vw_boletos_pendentes")
            .select("conta_receber_id")
            .eq(contaId ? "conta_receber_id" : "pedido_id", contaId ?? pedidoId!)
            .order("conta_receber_id")
            .range(inicio, fim),
        ),
      ]);
      return { titulos, boletos, pendentes: pendentes.map((p) => p.conta_receber_id) };
    },
  });
  const pedidoLiberacao = pedidoId || consulta.data?.titulos[0]?.pedido_id || "";
  const liberacao = useQuery({
    queryKey: ["liberacao-boleto-255", user?.id, pedidoLiberacao],
    enabled: open && !!client && !!pedidoLiberacao && modo === "emitir",
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await client!.rpc("liberacao_boleto_pedido_255", {
        _pedido: pedidoLiberacao,
      });
      if (error)
        throw new Error(
          error.code === "P0001"
            ? error.message
            : error.code === "PGRST202"
              ? "Aplique a fase255 no Supabase para verificar a liberação dos boletos."
              : "Não foi possível verificar a liberação do pedido. Atualize a lista e tente novamente.",
        );
      return data as string | null;
    },
  });
  const pedidoLiberado =
    !pedidoLiberacao || (liberacao.isSuccess && liberacao.data === null && !liberacao.isFetching);
  const linhas = (consulta.data?.titulos ?? []).map((t) => ({
    titulo: t,
    boleto: boletoAtual(consulta.data?.boletos ?? [], t.id),
    emitir: habilitado && pedidoLiberado && (consulta.data?.pendentes.includes(t.id) ?? false),
  }));
  const elegiveis = linhas.filter((l) =>
    modo === "emitir" ? l.emitir : boletoImprimivel(l.boleto),
  );
  const escolhidas = elegiveis.filter((l) => selected.includes(l.titulo.id));
  const limite = modo === "emitir" ? 10 : 20;
  const atualizar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["emissao-boletos"] }),
      qc.invalidateQueries({ queryKey: ["liberacao-boleto-255"] }),
      ...["boletos", "vw_boletos_pendentes", "contas_receber", "vw_titulos_receber"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    ]);
  };
  async function executar() {
    if (
      trabalhando.current ||
      !session ||
      !escolhidas.length ||
      escolhidas.length > limite ||
      consulta.isFetching
    )
      return;
    trabalhando.current = true;
    setBusy(true);
    setErro(null);
    setProgresso("");
    let emitidos = 0;
    try {
      if (modo === "emitir") {
        for (const [i, l] of escolhidas.entries()) {
          setProgresso(`Emitindo ${i + 1} de ${escolhidas.length}…`);
          await emitirApi({ data: { contaId: l.titulo.id, accessToken: session.access_token } });
          emitidos++;
        }
        toast.success(`${emitidos} boleto(s) emitido(s). Abra a reimpressão para obter o PDF.`);
        setModo("imprimir");
      } else {
        const arquivos: string[] = [];
        for (const [i, l] of escolhidas.entries()) {
          setProgresso(`Obtendo PDF ${i + 1} de ${escolhidas.length}…`);
          const result = await pdfApi({
            data: { boletoId: l.boleto!.id, accessToken: session.access_token },
          });
          arquivos.push(result.base64);
        }
        const bytes = await unirPdfsBoletos(arquivos);
        setReady(false);
        setMock(escolhidas.some((l) => l.boleto?.ambiente === "homologacao"));
        setPdf(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Não foi possível concluir a operação.";
      setErro(
        emitidos
          ? `${emitidos} boleto(s) já foram emitidos. ${message} Atualize a lista antes de continuar.`
          : message,
      );
    } finally {
      try {
        await atualizar();
      } finally {
        trabalhando.current = false;
        setBusy(false);
        setProgresso("");
      }
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        size={compact ? "sm" : "default"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          setSelected([]);
          setErro(null);
          setPdf(null);
          setModo("emitir");
        }}
      >
        <Barcode className="size-4" />
        Boletos{contaId ? " da parcela" : " do pedido"}
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
        <DialogContent
          className={
            pdf
              ? "flex max-h-[95dvh] flex-col sm:max-w-5xl"
              : "max-h-[95dvh] overflow-y-auto sm:max-w-2xl"
          }
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {pdf
                ? "Impressão dos boletos selecionados"
                : contaId
                  ? "Boletos da parcela"
                  : "Boletos do pedido"}
            </DialogTitle>
            <DialogDescription>
              {pdf
                ? "PDFs originais do banco reunidos na ordem das parcelas. Baixar ou imprimir não gera uma nova cobrança."
                : "Emita as parcelas disponíveis ou reimprima os boletos já registrados. Selecione um, vários ou todos deste documento."}
            </DialogDescription>
          </DialogHeader>
          {pdf ? (
            <>
              {mock && (
                <p role="alert" className="rounded-md border border-amber-500 p-3 text-sm">
                  HOMOLOGAÇÃO: o Sicredi pode retornar PDFs MOCK com dados fictícios. Não encaminhe
                  para pagamento.
                </p>
              )}
              <iframe
                ref={frame}
                src={pdf}
                title="Prévia dos boletos selecionados"
                className="h-[60dvh] min-h-60 w-full rounded border"
                onLoad={() => setReady(true)}
              />
              <DialogFooter className="flex-wrap">
                <Button variant="outline" onClick={() => setPdf(null)}>
                  Voltar às parcelas
                </Button>
                <Button asChild variant="secondary">
                  <a href={pdf} download={`boletos-${pedidoId ?? contaId}.pdf`}>
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
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" aria-label="Operação com boletos">
                <Button
                  variant={modo === "emitir" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => {
                    setModo("emitir");
                    setSelected([]);
                    setErro(null);
                  }}
                >
                  Emitir pendentes
                </Button>
                <Button
                  variant={modo === "imprimir" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => {
                    setModo("imprimir");
                    setSelected([]);
                    setErro(null);
                  }}
                >
                  Reimprimir emitidos
                </Button>
              </div>
              {modo === "emitir" && pedidoLiberacao && liberacao.isFetching && (
                <p role="status" className="text-sm text-muted-foreground">
                  Conferindo a liberação do pedido…
                </p>
              )}
              {modo === "emitir" && pedidoLiberacao && (liberacao.error || liberacao.data) && (
                <p role="alert" className="text-sm text-destructive">
                  {liberacao.error?.message || liberacao.data}
                </p>
              )}
              {modo === "emitir" && (
                <p className="text-sm text-muted-foreground">
                  {cobranca.isPending
                    ? "Consultando banco do centro…"
                    : cobranca.isError
                      ? cobranca.error.message
                      : habilitado
                        ? "Sicredi · API. O centro do documento define o banco de cobrança."
                        : "Novas emissões indisponíveis neste centro. Configure a cobrança em Centros. Boletos já emitidos continuam disponíveis na reimpressão."}
                </p>
              )}
              {consulta.isPending && <p role="status">Carregando parcelas e boletos…</p>}
              {consulta.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {consulta.error.message}
                </p>
              )}
              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
              {!consulta.isPending && !consulta.isError && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos os boletos disponíveis"
                        disabled={busy || consulta.isFetching || !elegiveis.length}
                        checked={!!elegiveis.length && escolhidas.length === elegiveis.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? elegiveis.map((l) => l.titulo.id) : [])
                        }
                      />
                      Selecionar todos disponíveis ({elegiveis.length})
                    </label>
                    <span>{escolhidas.length} selecionado(s)</span>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-lg border">
                    {linhas.map((l) => {
                      const disponivel = modo === "emitir" ? l.emitir : boletoImprimivel(l.boleto);
                      return (
                        <label
                          key={l.titulo.id}
                          className="flex items-start gap-3 border-b p-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            aria-label={`Selecionar parcela ${l.titulo.parcela}`}
                            disabled={busy || consulta.isFetching || !disponivel}
                            checked={disponivel && selected.includes(l.titulo.id)}
                            onChange={(e) =>
                              setSelected((s) =>
                                e.target.checked
                                  ? [...s, l.titulo.id]
                                  : s.filter((id) => id !== l.titulo.id),
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">
                              Parcela {l.titulo.parcela} ·{" "}
                              {l.titulo.vencimento.split("-").reverse().join("/")} ·{" "}
                              {money(
                                modo === "imprimir" && l.boleto
                                  ? l.boleto.valor
                                  : saldoTituloBoleto(l.titulo),
                              )}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {l.boleto
                                ? (estados[l.boleto.status] ?? l.boleto.status)
                                : "Sem boleto"}{" "}
                              · Título {l.titulo.status}
                              {l.boleto?.ambiente === "homologacao" ? " · Homologação" : ""}
                              {l.boleto?.canal === "cnab240"
                                ? " · CNAB legado: acompanhe em Boletos"
                                : ""}
                              {l.emitir && " · Disponível para emissão"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {!linhas.length && (
                      <p className="p-4 text-sm">
                        Nenhuma parcela financeira encontrada. Confirme o pedido para gerar as
                        parcelas.
                      </p>
                    )}
                  </div>
                  {!elegiveis.length && linhas.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {modo === "emitir"
                        ? "Não há parcelas disponíveis para nova emissão. Consulte a aba Reimprimir emitidos."
                        : "Não há boletos API registrados com PDF disponível para reimpressão."}
                    </p>
                  )}
                </>
              )}
              {escolhidas.length > limite && (
                <p role="alert" className="text-sm text-destructive">
                  Selecione até {limite} por operação, respeitando o limite de requisições
                  bancárias. Depois processe as demais parcelas.
                </p>
              )}
              {progresso && (
                <p role="status" className="text-sm">
                  {progresso}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy || consulta.isFetching}
                  onClick={() => void consulta.refetch()}
                >
                  Atualizar lista
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  Fechar
                </Button>
                <Button
                  disabled={
                    busy ||
                    consulta.isFetching ||
                    consulta.isError ||
                    !escolhidas.length ||
                    escolhidas.length > limite
                  }
                  onClick={() => void executar()}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {modo === "emitir" ? "Emitir selecionadas" : "Abrir PDF selecionados"} (
                  {escolhidas.length})
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
