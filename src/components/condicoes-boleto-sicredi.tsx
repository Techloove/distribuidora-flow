import { brl } from "@/lib/formatacao";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import {
  sicrediPreviaCondicoes,
  sicrediAlterarCondicoes,
  sicrediConferirCondicoes,
} from "@/lib/sicredi.functions";
import type { InstrucaoSicredi, CondicoesSicredi } from "@/lib/sicredi-condicoes";

const dia = (s: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : s;
const nomes = {
  abatimento: "Conceder abatimento",
  cancelar_abatimento: "Cancelar abatimento",
  desconto: "Alterar desconto existente",
  data_desconto: "Alterar prazo do desconto",
};
export function CondicoesBoletoSicredi({ boleto }: { boleto: Record<string, unknown> }) {
  const { session, roles } = useSupabase(),
    qc = useQueryClient();
  const previa = useServerFn(sicrediPreviaCondicoes),
    enviar = useServerFn(sicrediAlterarCondicoes),
    conferir = useServerFn(sicrediConferirCondicoes);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tipo, setTipo] = useState<InstrucaoSicredi["tipo"]>("abatimento"),
    [valor, setValor] = useState(""),
    [data, setData] = useState(""),
    [ordem, setOrdem] = useState(1),
    [motivo, setMotivo] = useState(""),
    [confirmar, setConfirmar] = useState(false),
    [chave, setChave] = useState("");
  const permitido =
    roles.includes("admin") &&
    boleto["banco"] === "sicredi" &&
    boleto["canal"] === "api" &&
    !!boleto["nosso_numero"];
  const query = useQuery({
    queryKey: ["sicredi-condicoes", session?.user.id, boleto["id"]],
    enabled: open && permitido && !!session,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      previa({ data: { boletoId: String(boleto["id"]), accessToken: session!.access_token } }),
  });
  if (!permitido) return null;
  const c = query.data?.condicoes,
    pendente = query.data?.pendente ?? !!boleto["condicoes_pendente_292"];
  const operacao =
    tipo === "abatimento" && Number(c?.abatimento) > 0 ? "cancelar_abatimento" : tipo;
  const ordemAtual = c?.descontos.some((d) => d.ordem === ordem)
    ? ordem
    : (c?.descontos[0]?.ordem ?? 1);
  const editavel =
    !!c &&
    ["EM CARTEIRA", "VENCIDO"].includes(c.situacao) &&
    boleto["status"] === "registrado" &&
    !pendente;
  async function atualizar() {
    await Promise.all(
      [
        "boletos",
        "contas_receber",
        "vw_titulos_receber",
        "emissao-boletos",
        "sicredi-condicoes",
      ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  }
  async function executar(check: boolean) {
    if (busy || !session || !c) return;
    setBusy(true);
    setError("");
    try {
      const result = check
        ? await conferir({
            data: { boletoId: String(boleto["id"]), accessToken: session.access_token },
          })
        : await enviar({
            data: {
              boletoId: String(boleto["id"]),
              accessToken: session.access_token,
              chave,
              motivo,
              anterior: c,
              instrucao: {
                tipo: operacao,
                ...(valor === "" ? {} : { valor: Number(valor.replace(",", ".")) }),
                ordem: ordemAtual,
                data,
              },
            },
          });
      toast.success(result.mensagem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao solicitar a condição.");
    } finally {
      await atualizar();
      setChave(crypto.randomUUID());
      setConfirmar(false);
      setBusy(false);
    }
  }
  function descricao(s: CondicoesSicredi) {
    return `Abatimento: ${brl(s.abatimento)}${s.descontos.map((d) => ` · Desconto ${d.ordem}: ${s.tipoDesconto === "PERCENTUAL" ? `${d.valor}%` : brl(d.valor)} até ${dia(d.data)}`).join("")}`;
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setError("");
          setConfirmar(false);
          setMotivo("");
          setValor("");
          setData("");
          setChave(crypto.randomUUID());
          setOpen(true);
        }}
      >
        {boleto["condicoes_pendente_292"]
          ? "Desconto/abatimento pendente"
          : "Desconto e abatimento"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Desconto e abatimento Sicredi</DialogTitle>
            <DialogDescription>
              Nosso número: {String(boleto["nosso_numero"])}. Somente administrador, com motivo
              registrado.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Abatimento reduz o valor a pagar sem mudar o valor nominal. Desconto depende da data
            limite. O financeiro contabiliza a redução na liquidação confirmada pelo banco; não é
            lançado um recebimento ao solicitar.
          </p>
          {query.isFetching ? (
            <p>Consultando condições no Sicredi…</p>
          ) : query.isError ? (
            <div role="alert">
              <p>{query.error.message}</p>
              <Button variant="outline" onClick={() => query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : c ? (
            <>
              <div className="rounded-lg border p-3 text-sm space-y-2">
                <p>
                  Valor nominal: <strong>{brl(c.nominal)}</strong>
                </p>
                <p>{descricao(c)}</p>
                <p>
                  Após abatimento, antes de desconto/encargos:{" "}
                  <strong>{brl(c.nominal - c.abatimento)}</strong>
                </p>
                <p>Situação no banco: {c.situacao}</p>
              </div>
              {pendente ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    Existe uma solicitação aguardando confirmação. Não reenvie a instrução.
                  </p>
                  <Button disabled={busy} onClick={() => executar(true)}>
                    Conferir no Sicredi
                  </Button>
                </div>
              ) : editavel ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="sicredi-instrucao">Operação</Label>
                    <select
                      id="sicredi-instrucao"
                      className="w-full rounded-md border p-2"
                      value={operacao}
                      disabled={busy}
                      onChange={(e) => {
                        setTipo(e.target.value as InstrucaoSicredi["tipo"]);
                        setConfirmar(false);
                        setValor("");
                        setData("");
                      }}
                    >
                      <option value="abatimento" disabled={c.abatimento > 0}>
                        {nomes.abatimento}
                      </option>
                      <option value="cancelar_abatimento" disabled={c.abatimento <= 0}>
                        {nomes.cancelar_abatimento}
                      </option>
                      <option value="desconto" disabled={!c.descontos.length}>
                        {nomes.desconto}
                      </option>
                      <option value="data_desconto" disabled={!c.descontos.length}>
                        {nomes.data_desconto}
                      </option>
                    </select>
                  </div>
                  {!c.descontos.length && (
                    <p className="text-sm text-muted-foreground">
                      Este boleto não tem desconto cadastrado no banco. Para reduzir o valor a
                      pagar, use Conceder abatimento. A alteração de desconto mantém o tipo
                      cadastrado na emissão.
                    </p>
                  )}
                  {(operacao === "desconto" || operacao === "data_desconto") && (
                    <div>
                      <Label htmlFor="sicredi-ordem">Desconto a alterar</Label>
                      <select
                        id="sicredi-ordem"
                        className="w-full rounded-md border p-2"
                        value={ordemAtual}
                        disabled={busy}
                        onChange={(e) => setOrdem(Number(e.target.value))}
                      >
                        {c.descontos.map((d) => (
                          <option key={d.ordem} value={d.ordem}>
                            Desconto {d.ordem} · {dia(d.data)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(operacao === "abatimento" || operacao === "desconto") && (
                    <div>
                      <Label htmlFor="sicredi-valor">
                        {operacao === "desconto" && c.tipoDesconto === "PERCENTUAL"
                          ? "Novo desconto (%)"
                          : operacao === "abatimento"
                            ? "Abatimento (R$)"
                            : "Novo desconto (R$)"}
                      </Label>
                      <Input
                        id="sicredi-valor"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={valor}
                        disabled={busy}
                        onChange={(e) => {
                          setValor(e.target.value);
                          setConfirmar(false);
                        }}
                      />
                    </div>
                  )}
                  {operacao === "abatimento" && Number(valor.replace(",", ".")) > 0 && (
                    <p className="text-sm">
                      Após abatimento, antes de desconto/encargos:{" "}
                      {brl(c.nominal - Number(valor.replace(",", ".")))}
                    </p>
                  )}
                  {operacao === "data_desconto" && (
                    <div>
                      <Label htmlFor="sicredi-data">Nova data limite do desconto</Label>
                      <Input
                        id="sicredi-data"
                        type="date"
                        value={data}
                        disabled={busy}
                        onChange={(e) => {
                          setData(e.target.value);
                          setConfirmar(false);
                        }}
                      />
                    </div>
                  )}
                  {operacao === "cancelar_abatimento" && (
                    <p className="text-sm">
                      O cancelamento remove o abatimento de {brl(c.abatimento)}. Descontos e
                      encargos continuam conforme o banco.
                    </p>
                  )}
                  <div>
                    <Label htmlFor="sicredi-motivo">Motivo (mínimo 10 caracteres)</Label>
                    <Textarea
                      id="sicredi-motivo"
                      maxLength={2000}
                      value={motivo}
                      disabled={busy}
                      onChange={(e) => setMotivo(e.target.value)}
                    />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmar}
                      disabled={busy}
                      onChange={(e) => setConfirmar(e.target.checked)}
                    />
                    Confirmo a operação selecionada e as condições informadas para envio ao Sicredi.
                  </label>
                  <Button
                    disabled={busy || !confirmar || motivo.trim().length < 10}
                    onClick={() => executar(false)}
                  >
                    {busy ? "Enviando…" : "Solicitar ao Sicredi"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm">
                  Novas instruções estão indisponíveis para a situação atual deste boleto.
                </p>
              )}
              {!!query.data?.historico.length && (
                <div className="space-y-2 border-t pt-3">
                  <h3 className="font-semibold">Histórico · últimas 30 solicitações</h3>
                  {query.data.historico.map((h) => (
                    <div
                      key={String(h["id"])}
                      className="rounded-md border p-2 text-sm break-words"
                    >
                      <p>
                        {dia(String(h["created_at"]))} · {nomes[h["tipo"] as keyof typeof nomes]} ·{" "}
                        {String(h["estado"])}
                      </p>
                      <p>{String(h["motivo"])}</p>
                      <p>Antes: {descricao(h["anterior"] as CondicoesSicredi)}</p>
                      <p>Solicitado: {descricao(h["esperado"] as CondicoesSicredi)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
