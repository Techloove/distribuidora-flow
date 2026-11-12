import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { sicoobEmitirBoleto, sicoobConsultarBoleto } from "@/lib/sicoob.functions";
import { brl as money, dataBr } from "@/lib/formatacao";
import { PainelImpressaoBoletos } from "@/components/imprimir-boletos";
import { useEffect, useRef, useState } from "react";
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
import { useSupabase } from "@/lib/supabase-provider";
import { sicrediEmitirBoleto } from "@/lib/sicredi.functions";
import {
  boletoAtual,
  boletosParaAberturaAutomatica,
  centroEmissaoTitulos,
  saldoTituloBoleto,
  type TituloBoleto,
  type BoletoDocumento,
} from "@/lib/boletos-documento";
import { lerPaginas } from "@/lib/paginacao";

const estados: Record<string, string> = {
  registrado: "Boleto emitido",
  liquidado: "Boleto liquidado",
  em_processamento: "Emissão em processamento",
  pendente: "Registro pendente",
  erro: "Emissão com erro",
  baixado: "Boleto baixado",
  cancelado: "Boleto cancelado",
};
type Props = {
  pedidoId?: string;
  contaId?: string;
  centroId: string;
  compact?: boolean;
  statusBoleto?: string | null;
  consultando?: boolean;
  falhaConsulta?: boolean;
};
export function EmitirBoletosPedido(props: {
  pedidoId: string;
  centroId: string;
  compact?: boolean;
}) {
  return <BoletosDocumento {...props} />;
}
export function EmitirBoletoTitulo(props: {
  contaId: string;
  centroId: string;
  statusBoleto?: string | null;
  consultando?: boolean;
  falhaConsulta?: boolean;
}) {
  const { roles } = useSupabase();
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r))) return null;
  return <BoletosDocumento {...props} compact />;
}
function BoletosDocumento(props: Props) {
  const { roles } = useSupabase();
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r))) return null;
  return <JanelaBoletos key={props.pedidoId ?? props.contaId} {...props} />;
}
function JanelaBoletos({
  pedidoId,
  contaId,
  compact = false,
  statusBoleto,
  consultando,
  falhaConsulta,
}: Props) {
  const { client, session, user } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const qc = useQueryClient();
  const emitirApi = useServerFn(sicrediEmitirBoleto),
    emitirSicoob = useServerFn(sicoobEmitirBoleto),
    consultarSicoob = useServerFn(sicoobConsultarBoleto);
  const [open, setOpen] = useState(false),
    [modo, setModo] = useState<"emitir" | "imprimir">("emitir");
  const [autoContas, setAutoContas] = useState<string[]>([]);
  const [aguardandoImpressao, setAguardandoImpressao] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [avisoConsulta, setAvisoConsulta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null),
    [progresso, setProgresso] = useState("");
  const trabalhando = useRef(false);
  const chave = ["emissao-boletos", user?.id, pedidoId, contaId];
  const consulta = useQuery({
    queryKey: chave,
    enabled: open && !!client && !!session,
    refetchInterval: (query) =>
      !busy &&
      query.state.data?.boletos.some((b) => b.banco === "sicoob" && b.status === "em_processamento")
        ? 10_000
        : false,
    queryFn: async () => {
      // Todas as leituras usam a sessão/RLS. Não busca títulos de outros pedidos.
      const [titulos, boletos, pendentes] = await Promise.all([
        lerPaginas<TituloBoleto>((inicio, fim) =>
          client!
            .from("contas_receber")
            .select(
              "id,pedido_id,centro_id,parcela,vencimento,valor,status,juros,multa,acrescimo,desconto,valor_pago",
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
  useEffect(() => {
    if (!open || busy || modo !== "emitir" || !aguardandoImpressao.length || consulta.isFetching)
      return;
    if (boletosParaAberturaAutomatica(consulta.data?.boletos ?? [], aguardandoImpressao).length) {
      setAutoContas(aguardandoImpressao);
      setAguardandoImpressao([]);
      setModo("imprimir");
    }
  }, [open, busy, modo, aguardandoImpressao, consulta.data, consulta.isFetching]);
  const centroDocumento = centroEmissaoTitulos(consulta.data?.titulos ?? []);
  const cobranca = useQuery({
    queryKey: ["cobranca-emissao", user?.id, centroDocumento],
    enabled: open && !!client && !!centroDocumento,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await client!
        .from("cobranca_centros")
        .select("banco,canal,ativo")
        .eq("centro_id", centroDocumento)
        .maybeSingle();
      if (error) throw new Error("Não foi possível consultar a cobrança do centro.");
      return data;
    },
  });
  const habilitado =
    cobranca.isSuccess &&
    !cobranca.isFetching &&
    ["sicredi", "sicoob"].includes(cobranca.data?.banco ?? "") &&
    (cobranca.data?.banco !== "sicoob" || permissoes.pode("sicoob_operar")) &&
    cobranca.data?.canal === "api" &&
    cobranca.data?.ativo === true;
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
  const elegiveis = linhas.filter((l) => l.emitir);
  const escolhidas = elegiveis.filter((l) => selected.includes(l.titulo.id));
  const limite = 10;
  const atualizar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["emissao-boletos"] }),
      qc.invalidateQueries({ queryKey: ["liberacao-boleto-255"] }),
      ...["boletos", "vw_boletos_pendentes", "contas_receber", "vw_titulos_receber"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    ]);
  };
  async function consultarTentativa(boletoId: string) {
    if (trabalhando.current || !session) return;
    trabalhando.current = true;
    setBusy(true);
    setErro(null);
    setAvisoConsulta(null);
    setSelected([]);
    try {
      const r = await consultarSicoob({ data: { boletoId, accessToken: session.access_token } });
      if (!r.condicoes) setAvisoConsulta(r.nota ?? "Consulta sem retorno de boleto.");
      else toast.success(r.nota ?? `Consulta Sicoob: ${r.situacao}.`);
      if (r.situacao === "EM ABERTO" || r.situacao === "LIQUIDADO") {
        const b = consulta.data?.boletos.find((b) => b.id === boletoId);
        setAutoContas(b?.conta_receber_id ? [b.conta_receber_id] : []);
        setModo("imprimir");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar a tentativa.");
    } finally {
      await atualizar();
      trabalhando.current = false;
      setBusy(false);
    }
  }
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
    setAvisoConsulta(null);
    setProgresso("");
    const contasDaEmissao = escolhidas.map((l) => l.titulo.id);
    setAutoContas([]);
    setAguardandoImpressao([]);
    let emitidos = 0;
    let pendentes = 0;
    try {
      const atual = await cobranca.refetch();
      if (
        atual.isError ||
        !atual.data?.ativo ||
        atual.data.canal !== "api" ||
        !["sicoob", "sicredi"].includes(atual.data.banco)
      )
        throw new Error(
          "A configuração bancária da loja mudou ou está indisponível. Atualize antes de emitir.",
        );
      if (atual.data.banco === "sicoob" && !permissoes.pode("sicoob_operar"))
        throw new Error("Sem permissão para emitir no Sicoob.");
      const emitir = atual.data.banco === "sicoob" ? emitirSicoob : emitirApi;
      for (const [i, l] of escolhidas.entries()) {
        if (l.titulo.centro_id !== centroDocumento)
          throw new Error("A loja da parcela diverge da configuração consultada.");
        setProgresso(`Emitindo ${i + 1} de ${escolhidas.length}…`);
        const resultado = await emitir({
          data: { contaId: l.titulo.id, accessToken: session.access_token },
        });
        if ("confirmacaoPendente" in resultado && resultado.confirmacaoPendente) pendentes++;
        else emitidos++;
      }
      if (pendentes) {
        setAguardandoImpressao(contasDaEmissao);
        const mensagem = `${emitidos} boleto(s) confirmado(s); ${pendentes} aguardando confirmação automática no Sicoob. Não é necessário emitir novamente.`;
        setAvisoConsulta(
          "Confirmação acompanhada automaticamente. A lista será atualizada enquanto houver emissão Sicoob em processamento.",
        );
        toast.info(mensagem);
      } else {
        toast.success(`${emitidos} boleto(s) emitido(s). Abrindo a prévia para impressão.`);
        setAutoContas(contasDaEmissao);
        setModo("imprimir");
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
          setAvisoConsulta(null);
          setModo(
            contaId && ["registrado", "liquidado"].includes(statusBoleto ?? "")
              ? "imprimir"
              : "emitir",
          );
          setAutoContas([]);
          setAguardandoImpressao([]);
        }}
      >
        <Barcode className="size-4" />
        {falhaConsulta
          ? "Consulta de boleto indisponível"
          : consultando
            ? "Consultando boleto…"
            : contaId
              ? ["registrado", "liquidado"].includes(statusBoleto ?? "")
                ? "Reimprimir boleto"
                : ["pendente", "em_processamento"].includes(statusBoleto ?? "")
                  ? "Consultar boleto"
                  : "Emitir boleto"
              : "Boletos do pedido"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v);
          }
        }}
      >
        <DialogContent
          className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{contaId ? "Boletos da parcela" : "Boletos do pedido"}</DialogTitle>
            <DialogDescription>
              Emita parcelas disponíveis ou selecione boletos do pedido ou do cliente para
              reimpressão.
            </DialogDescription>
          </DialogHeader>
          {modo === "imprimir" ? (
            <PainelImpressaoBoletos
              contaId={contaId}
              pedidoId={pedidoId}
              onBusy={setBusy}
              autoContas={autoContas}
              onVoltar={() => setModo("emitir")}
            />
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
                    setAvisoConsulta(null);
                  }}
                >
                  Emitir pendentes
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAutoContas([]);
                    setAguardandoImpressao([]);
                    setModo("imprimir");
                    setSelected([]);
                    setErro(null);
                    setAvisoConsulta(null);
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
                    ? centroDocumento
                      ? "Consultando banco da loja do título…"
                      : consulta.isPending
                        ? "Consultando a loja do título…"
                        : "Não foi possível determinar uma única loja para as parcelas. Confira o cadastro do título."
                    : cobranca.isError
                      ? cobranca.error.message
                      : habilitado
                        ? `${cobranca.data?.banco === "sicoob" ? "Sicoob" : "Sicredi"} · API de produção. A loja gravada no título define o banco da emissão.`
                        : "Novas emissões indisponíveis neste centro. Configure a cobrança em Lojas. Boletos já emitidos continuam disponíveis na reimpressão."}
                </p>
              )}
              {consulta.isPending && <p role="status">Carregando parcelas e boletos…</p>}
              {consulta.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {consulta.error.message}
                </p>
              )}
              {avisoConsulta && (
                <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
                  {avisoConsulta}
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
                      const disponivel = l.emitir;
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
                              Parcela {l.titulo.parcela} · {dataBr(l.titulo.vencimento)} ·{" "}
                              {money(saldoTituloBoleto(l.titulo))}
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
                            {l.boleto?.banco === "sicoob" &&
                              ["erro", "pendente", "em_processamento"].includes(
                                l.boleto.status,
                              ) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="mt-2"
                                  disabled={busy}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void consultarTentativa(l.boleto!.id);
                                  }}
                                >
                                  Consultar tentativa no Sicoob (sem emitir)
                                </Button>
                              )}
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
