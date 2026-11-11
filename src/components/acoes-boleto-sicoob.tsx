import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { SearchSelect } from "./ui/search-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import {
  sicoobPreviaBoleto,
  sicoobAlterarBoleto,
  sicoobConsultarBoleto,
  sicoobPdfBoleto,
} from "@/lib/sicoob.functions";
import { brl, dataBr } from "@/lib/formatacao";
import type { InstrucaoSicoob } from "@/lib/sicoob-api";
const nomes = {
  vencimento: "Alterar vencimento",
  baixar: "Baixar / cancelar boleto",
  abatimento: "Desconto / abatimento",
};
type Row = Record<string, unknown>;
export function AcoesBoletoSicoob({ boleto, sandbox = false }: { boleto: Row; sandbox?: boolean }) {
  const permissoes = usePermissoesRotinas();
  const { client, session, roles } = useSupabase(),
    qc = useQueryClient(),
    previa = useServerFn(sicoobPreviaBoleto),
    alterar = useServerFn(sicoobAlterarBoleto),
    consultar = useServerFn(sicoobConsultarBoleto),
    pdf = useServerFn(sicoobPdfBoleto);
  const [tipo, setTipo] = useState<"vencimento" | "baixar" | "abatimento" | null>(null),
    [instrucao, setInstrucao] = useState<InstrucaoSicoob["tipo"]>("abatimento"),
    [valor, setValor] = useState(""),
    [dia, setDia] = useState(""),
    [percentual, setPercentual] = useState(false),
    [ordem, setOrdem] = useState("1"),
    [motivo, setMotivo] = useState(""),
    [confirmar, setConfirmar] = useState(false),
    [busy, setBusy] = useState(false),
    [erro, setErro] = useState(""),
    [chave, setChave] = useState("");
  const admin = roles.includes("admin"),
    financeiro = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r)),
    id = String(boleto["id"]),
    alvo = { boletoId: id, sandbox, accessToken: session?.access_token ?? "" };
  const q = useQuery({
    queryKey: ["sicoob-previa", session?.user.id, id, sandbox, tipo],
    enabled: !!tipo && !!session && permissoes.pode("sicoob_operar"),
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () => previa({ data: alvo }),
  });
  const historico = useQuery({
    queryKey: ["sicoob-historico", session?.user.id, id, sandbox],
    enabled: !!client && !!tipo,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicoob_operacoes_316")
        .select("id,tipo,estado,motivo,nota,created_at,updated_at")
        .eq(sandbox ? "teste_id" : "boleto_id", id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw Error("Não foi possível consultar o histórico desta loja.");
      return data as Row[];
    },
  });
  if (boleto["banco"] !== "sicoob" || !financeiro || !permissoes.pode("sicoob_operar")) return null;
  const pendente = q.data?.pendente ?? !!boleto["sicoob_pendente_316"],
    c = q.data?.condicoes;
  async function atualizar() {
    await Promise.all(
      [
        "boletos",
        "emissao-boletos",
        "contas_receber",
        "vw_titulos_receber",
        "sicoob-sandbox",
        "sicoob-previa",
        "sicoob-historico",
      ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  }
  async function acao(check = false) {
    if (busy || !session) return;
    setBusy(true);
    setErro("");
    try {
      if (check) {
        const r = await consultar({ data: alvo });
        if (!r.condicoes) toast.info(r.nota ?? "Consulta sem retorno de boleto.");
        else
          toast.success(
            r.nota ??
              (r.pendente ? "Solicitação ainda pendente no banco." : "Situação Sicoob atualizada."),
          );
      } else {
        if (!c || !tipo) return;
        const r = await alterar({
          data: {
            ...alvo,
            chave,
            anterior: c,
            motivo,
            instrucao: {
              tipo: tipo === "abatimento" ? instrucao : tipo,
              ...(valor !== "" ? { valor: Number(valor) } : {}),
              data: dia,
              percentual,
              ordem: Number(ordem),
            },
          },
        });
        toast.success(r.mensagem);
        setConfirmar(false);
      }
      await atualizar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Operação indisponível.");
    } finally {
      setBusy(false);
    }
  }
  function abrir(t: typeof tipo) {
    setTipo(t);
    setInstrucao("abatimento");
    setValor("");
    setDia("");
    setMotivo("");
    setConfirmar(false);
    setErro("");
    setChave(crypto.randomUUID());
  }
  async function imprimir() {
    if (busy || !session) return;
    setBusy(true);
    try {
      const r = await pdf({ data: alvo }),
        bytes = Uint8Array.from(atob(r.base64), (x) => x.charCodeAt(0)),
        url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = sandbox ? "boleto-sicoob-SANDBOX.pdf" : "boleto-sicoob.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF indisponível.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {sandbox && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void acao(true)}>
              Consultar Sicoob
            </Button>
            {["registrado", "liquidado"].includes(String(boleto["status"])) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void imprimir()}>
                PDF de teste
              </Button>
            )}
          </>
        )}
        {(["vencimento", "baixar", "abatimento"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant="outline"
            disabled={busy || boleto["status"] !== "registrado" || (t !== "vencimento" && !admin)}
            onClick={() => abrir(t)}
          >
            {nomes[t]}
          </Button>
        ))}
        {Number((boleto["retorno"] as Row | null)?.["abatimento"] ?? 0) > 0 && (
          <p className="text-xs text-primary">
            Abatimento Sicoob confirmado: {brl((boleto["retorno"] as Row)["abatimento"])}
          </p>
        )}
        {!sandbox && boleto["status"] === "liquidado" && (
          <p className="text-xs text-muted-foreground">
            Liquidação informada pelo banco.{" "}
            <Link to="/receber" className="underline">
              Conferir recebimento no financeiro
            </Link>
            .
          </p>
        )}
        {!!boleto["sicoob_pendente_316"] && (
          <span className="text-xs text-amber-700">
            Solicitação pendente · consulte para confirmar
          </span>
        )}
      </div>
      <Dialog
        open={!!tipo}
        onOpenChange={(v) => {
          if (!busy && !v) setTipo(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tipo ? nomes[tipo] : "Sicoob"}</DialogTitle>
            <DialogDescription>
              {sandbox
                ? "SANDBOX: teste isolado, sem alteração no financeiro real."
                : "Condições consultadas diretamente no Sicoob. O resultado só é aplicado após confirmação do banco."}
            </DialogDescription>
          </DialogHeader>
          {q.isPending ? (
            <p role="status">Consultando o Sicoob…</p>
          ) : q.isError ? (
            <p role="alert" className="text-destructive">
              {q.error.message}
            </p>
          ) : (
            c && (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div>
                    <dt>Valor nominal</dt>
                    <dd className="font-semibold">{brl(c.valor)}</dd>
                  </div>
                  <div>
                    <dt>Vencimento atual</dt>
                    <dd className="font-semibold">{dataBr(c.vencimento)}</dd>
                  </div>
                  <div>
                    <dt>Abatimento atual</dt>
                    <dd>{brl(c.abatimento)}</dd>
                  </div>
                  <div>
                    <dt>Situação bancária</dt>
                    <dd>{c.situacao}</dd>
                  </div>
                </dl>
                {c.descontos.length > 0 && (
                  <p className="text-sm">
                    Descontos atuais:{" "}
                    {c.descontos
                      .map(
                        (d) =>
                          `${d.ordem}º: ${c.tipoDesconto === 2 ? `${d.valor}%` : brl(d.valor)} até ${dataBr(d.data)}`,
                      )
                      .join(" · ")}
                  </p>
                )}
                {tipo === "baixar" && (
                  <p className="rounded-lg border p-3 text-sm">
                    Baixar cancela a cobrança bancária. O título a receber continua aberto até
                    receber ou cancelar no financeiro.
                  </p>
                )}
                {pendente ? (
                  <p role="status" className="rounded-lg border p-3 text-sm">
                    Há uma solicitação pendente. Consulte o resultado antes de enviar outra
                    instrução.
                  </p>
                ) : c.situacao === "EM ABERTO" ? (
                  <fieldset disabled={busy} className="space-y-3">
                    {tipo === "vencimento" && (
                      <div className="space-y-1">
                        <Label htmlFor={`sicoob-venc-${id}`}>Novo vencimento</Label>
                        <Input
                          id={`sicoob-venc-${id}`}
                          type="date"
                          value={dia}
                          onChange={(e) => {
                            setDia(e.target.value);
                            setConfirmar(false);
                            setChave(crypto.randomUUID());
                          }}
                        />
                      </div>
                    )}
                    {tipo === "abatimento" && (
                      <>
                        <div className="space-y-1">
                          <Label htmlFor={`sicoob-instrucao-${id}`}>Operação</Label>
                          <SearchSelect
                            id={`sicoob-instrucao-${id}`}
                            value={instrucao}
                            onChange={(e) => {
                              setInstrucao(e.target.value as InstrucaoSicoob["tipo"]);
                              setConfirmar(false);
                              setChave(crypto.randomUUID());
                            }}
                          >
                            <option value="abatimento">Conceder / cancelar abatimento</option>
                            <option value="desconto">Definir / alterar desconto</option>
                          </SearchSelect>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`sicoob-valor-${id}`}>
                            {instrucao === "desconto" && percentual ? "Desconto (%)" : "Valor (R$)"}
                          </Label>
                          <Input
                            id={`sicoob-valor-${id}`}
                            currency={!(instrucao === "desconto" && percentual)}
                            type="number"
                            min="0"
                            step="0.01"
                            value={valor}
                            onChange={(e) => {
                              setValor(e.target.value);
                              setConfirmar(false);
                              setChave(crypto.randomUUID());
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            Informe zero para cancelar{" "}
                            {instrucao === "desconto" ? "todos os descontos" : "o abatimento"}.
                          </p>
                        </div>
                        {instrucao === "desconto" && (
                          <>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={percentual}
                                onChange={(e) => {
                                  setPercentual(e.target.checked);
                                  setConfirmar(false);
                                  setChave(crypto.randomUUID());
                                }}
                              />
                              Desconto percentual
                            </label>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label htmlFor={`sicoob-ordem-${id}`}>Ordem do desconto</Label>
                                <SearchSelect
                                  id={`sicoob-ordem-${id}`}
                                  value={ordem}
                                  onChange={(e) => {
                                    setOrdem(e.target.value);
                                    setConfirmar(false);
                                    setChave(crypto.randomUUID());
                                  }}
                                >
                                  <option value="1">1º desconto</option>
                                  <option value="2">2º desconto</option>
                                  <option value="3">3º desconto</option>
                                </SearchSelect>
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`sicoob-desconto-dia-${id}`}>
                                  Data limite do desconto
                                </Label>
                                <Input
                                  id={`sicoob-desconto-dia-${id}`}
                                  type="date"
                                  value={dia}
                                  onChange={(e) => {
                                    setDia(e.target.value);
                                    setConfirmar(false);
                                    setChave(crypto.randomUUID());
                                  }}
                                />
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`sicoob-motivo-${id}`}>Motivo</Label>
                      <Textarea
                        id={`sicoob-motivo-${id}`}
                        maxLength={500}
                        value={motivo}
                        onChange={(e) => {
                          setMotivo(e.target.value);
                          setConfirmar(false);
                          setChave(crypto.randomUUID());
                        }}
                      />
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmar}
                        onChange={(e) => setConfirmar(e.target.checked)}
                      />
                      Conferi os dados e desejo enviar esta solicitação ao{" "}
                      {sandbox ? "sandbox Sicoob" : "Sicoob"}.
                    </label>
                  </fieldset>
                ) : (
                  <p className="text-sm">Este boleto já foi encerrado pelo banco.</p>
                )}
              </>
            )
          )}
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm">
              Últimas 30 solicitações deste boleto
            </summary>
            {historico.isError ? (
              <p role="alert">{historico.error.message}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-xs">
                {historico.data?.map((h) => (
                  <li key={String(h["id"])} className="rounded border p-2">
                    <strong>
                      {String(h["tipo"])} · {String(h["estado"])}
                    </strong>
                    <p>{String(h["motivo"])}</p>
                    <p className="text-muted-foreground">{String(h["nota"] ?? "")}</p>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTipo(null)}>
              Fechar
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void acao(true)}>
              Consultar resultado
            </Button>
            <Button
              disabled={
                busy ||
                !c ||
                pendente ||
                !confirmar ||
                motivo.trim().length < 5 ||
                c.situacao !== "EM ABERTO"
              }
              onClick={() => void acao(false)}
            >
              Enviar solicitação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
