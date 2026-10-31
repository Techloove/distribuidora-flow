import { getModalidade } from "@/lib/modalidade-store";
import { ReferenciaRegistro } from "@/components/referencia-registro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import qrcode from "qrcode-generator";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { gerarPixChave } from "@/lib/importacoes-distribuidora";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl } from "@/lib/formatacao";
import type { Registro } from "@/lib/rotinas-distribuidora";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function AcoesFinanceirasTitulo({ titulo }: { titulo: Registro }) {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas(),
    rpc = useRotinaRpc(["contas_receber", "vw_titulos_receber", "renegociacoes"]);
  const [modo, setModo] = useState<"pix" | "acordo" | null>(null),
    [conta, setConta] = useState(""),
    [parcelas, setParcelas] = useState("2"),
    [data, setData] = useState(hojeSaoPaulo()),
    [intervalo, setIntervalo] = useState("30"),
    [acrescimo, setAcrescimo] = useState("0"),
    [desconto, setDesconto] = useState("0"),
    [motivo, setMotivo] = useState(""),
    [pix, setPix] = useState(""),
    [chave, setChave] = useState(() => crypto.randomUUID());
  const contas = useQuery({
    queryKey: [...["contas-pix", user?.id], getModalidade()],
    enabled: !!client && modo === "pix" && perm.pode("pix_gerar"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_financeiras")
        .select("id,nome,centro_id,banco_codigo,banco,chave_pix")
        .eq("ativo", true)
        .order("nome")
        .limit(100);
      if (error) throw new Error("Aplique a fase219 para usar Pix por chave.");
      return (data ?? []) as Registro[];
    },
  });
  const qr = () => {
    if (!pix) return "";
    const q = qrcode(0, "M");
    q.addData(pix);
    q.make();
    return q.createDataURL(4, 4);
  };
  const saldo = Number(titulo["saldo"] ?? 0),
    novo = saldo + Number(acrescimo) - Number(desconto);
  if (["pago", "cancelado"].includes(String(titulo["status"])) || saldo <= 0) return null;
  return (
    <>
      <div className="inline-flex flex-wrap gap-1">
        {perm.pode("pix_gerar") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setModo("pix");
              setPix("");
            }}
          >
            Pix
          </Button>
        )}
        {perm.pode("receber_renegociar") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setModo("acordo");
              setChave(crypto.randomUUID());
            }}
          >
            Renegociar
          </Button>
        )}
      </div>
      <Dialog
        open={!!modo}
        onOpenChange={(open) => {
          if (!open && !rpc.isPending) setModo(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modo === "pix" ? "Pix por chave Sicredi" : "Renegociação do título"}
            </DialogTitle>
            <DialogDescription>
              Saldo atual: {brl(saldo)}. Operação sujeita às permissões e à situação do título no
              banco.
            </DialogDescription>
          </DialogHeader>
          {modo === "pix" ? (
            <>
              {contas.error && <p role="alert">{contas.error.message}</p>}
              <label className="text-sm">
                Conta Sicredi
                <select
                  aria-label="Conta para Pix"
                  className="block w-full rounded border bg-background p-2"
                  value={conta}
                  onChange={(e) => {
                    setConta(e.target.value);
                    setPix("");
                  }}
                >
                  <option value="">Selecione</option>
                  {contas.data
                    ?.filter(
                      (c) =>
                        (!c["centro_id"] || c["centro_id"] === titulo["centro_id"]) &&
                        (c["banco_codigo"] === "748" ||
                          String(c["banco"]).toLowerCase().includes("sicredi")),
                    )
                    .map((c) => (
                      <option key={String(c["id"])} value={String(c["id"])}>
                        {String(c["nome"])}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                disabled={!conta || rpc.isPending}
                onClick={() =>
                  rpc.mutate(
                    { nome: "dados_pix_219", args: { _titulo: titulo["id"], _conta: conta } },
                    {
                      onSuccess: (raw) => {
                        try {
                          const d = raw as Registro;
                          setPix(
                            gerarPixChave(
                              String(d["chave"]),
                              String(d["beneficiario"]),
                              String(d["cidade"]),
                              Number(d["valor"]),
                              String(d["txid"]),
                            ),
                          );
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Dados Pix inválidos");
                        }
                      },
                    },
                  )
                }
              >
                Gerar QR Code e copia e cola
              </Button>
              {pix && (
                <>
                  <img
                    className="mx-auto max-w-full"
                    src={qr()}
                    alt="QR Code Pix para pagamento do saldo"
                  />
                  <textarea
                    aria-label="Pix copia e cola"
                    className="rounded border bg-background p-2 text-xs w-full"
                    readOnly
                    value={pix}
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(pix)
                        .then(() => toast.success("Pix copiado"))
                        .catch(() => toast.error("Copie o código manualmente"))
                    }
                  >
                    Copiar Pix
                  </Button>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Pix independente, sem boleto híbrido. Não há baixa automática nem confirmação da
                API. Confira o recebimento na conta Sicredi antes de baixar o título. O banco
                verifica o beneficiário ao pagar.
              </p>
            </>
          ) : (
            <>
              <label className="text-sm">
                Parcelas
                <Input
                  aria-label="Parcelas do acordo"
                  type="number"
                  min="1"
                  max="24"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Primeiro vencimento
                <Input
                  aria-label="Primeiro vencimento do acordo"
                  type="date"
                  min={hojeSaoPaulo()}
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Intervalo em dias
                <Input
                  aria-label="Intervalo entre parcelas"
                  type="number"
                  min="1"
                  max="90"
                  value={intervalo}
                  onChange={(e) => setIntervalo(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Acréscimo do acordo
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acrescimo}
                  onChange={(e) => setAcrescimo(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Desconto do acordo
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                />
              </label>
              <Input
                aria-label="Motivo do acordo"
                placeholder="Motivo e condições negociadas"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <p className="text-sm">
                Novo total: {brl(novo)}. Parcelas arredondadas; a última absorve a diferença de
                centavos.
              </p>
              <p className="text-xs text-muted-foreground">
                O título original é encerrado, preservando as baixas já feitas. Novas parcelas ficam
                vinculadas ao pedido e ao acordo. Um boleto ativo precisa ser baixado/cancelado no
                banco antes desta operação.
              </p>
              <Button
                disabled={rpc.isPending || !motivo.trim() || !(novo > 0)}
                onClick={() =>
                  rpc.mutate(
                    {
                      nome: "renegociar_titulo_216",
                      args: {
                        _titulo: titulo["id"],
                        _parcelas: Number(parcelas),
                        _primeiro: data,
                        _intervalo: Number(intervalo),
                        _acrescimo: Number(acrescimo),
                        _desconto: Number(desconto),
                        _motivo: motivo,
                        _chave: chave,
                      },
                    },
                    { onSuccess: () => setModo(null) },
                  )
                }
              >
                Confirmar acordo e gerar parcelas
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ComissaoProporcional() {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas(),
    rpc = useRotinaRpc(["comissao_proporcional", "comissao_parcelas", "contas_pagar"]);
  const [valores, setValores] = useState<Record<string, string>>({}),
    [chaves, setChaves] = useState<Record<string, string>>({}),
    [vencimento, setVencimento] = useState(hojeSaoPaulo()),
    [motivos, setMotivos] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: [...["comissao_proporcional", user?.id], getModalidade()],
    enabled: !!client && perm.pode("comissao_ajustes_ver"),
    queryFn: async () => {
      const { data, error, count } = await client!
        .from("vw_comissao_proporcional_217")
        .select("*", { count: "exact" })
        .order("pedido_numero", { ascending: false })
        .limit(100);
      if (error) throw new Error("Aplique a fase217 para comissão proporcional.");
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  const pagamentos = useQuery({
    queryKey: [...["comissao_parcelas", user?.id], getModalidade()],
    enabled: !!client && perm.pode("comissao_ajustes_ver"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("comissao_parcelas")
        .select("id,valor,created_at,contas_pagar(status,valor_pago),comissoes(pedido_id)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Registro[];
    },
  });
  if (!perm.pode("comissao_ajustes_ver")) return null;
  return (
    <section className="rounded border p-4 space-y-3">
      <h2 className="font-semibold">Comissão proporcional ao recebimento</h2>
      <p className="text-xs text-muted-foreground">
        Agenda apenas o valor coberto por recebimentos e créditos aplicados ao pedido. Gera conta a
        pagar; a baixa financeira comprova o pagamento. As parcelas impedem pagamento integral
        duplicado.
      </p>
      {q.error && <p role="alert">{q.error.message}</p>}
      <label className="text-sm">
        Vencimento da comissão
        <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </label>
      {q.data?.rows
        .filter((r) => Number(r["disponivel"]) > 0 || Number(r["agendado"]) > 0)
        .map((r) => {
          const id = String(r["id"]);
          return (
            <div className="grid gap-2 sm:grid-cols-3 border-b py-2" key={id}>
              <span className="text-sm">
                Pedido{" "}
                <ReferenciaRegistro tipo="pedido" id={r["pedido_id"]}>
                  #{String(r["pedido_numero"])}
                </ReferenciaRegistro>{" "}
                · disponível {brl(r["disponivel"])} · agendado {brl(r["agendado"])}
              </span>
              <Input
                aria-label={`Comissão proporcional do pedido ${r["pedido_numero"]}`}
                type="number"
                min="0.01"
                max={Number(r["disponivel"])}
                step="0.01"
                value={valores[id] ?? String(r["disponivel"])}
                onChange={(e) => setValores((s) => ({ ...s, [id]: e.target.value }))}
              />
              {perm.pode("comissao_proporcional_operar") && (
                <Button
                  disabled={rpc.isPending || !(Number(valores[id] ?? r["disponivel"]) > 0)}
                  onClick={() => {
                    const chave = chaves[id] ?? crypto.randomUUID();
                    setChaves((s) => ({ ...s, [id]: chave }));
                    rpc.mutate(
                      {
                        nome: "agendar_comissao_217",
                        args: {
                          _comissao: id,
                          _valor: Number(valores[id] ?? r["disponivel"]),
                          _vencimento: vencimento,
                          _chave: chave,
                        },
                      },
                      { onSuccess: () => setChaves((s) => ({ ...s, [id]: crypto.randomUUID() })) },
                    );
                  }}
                >
                  Agendar comissão
                </Button>
              )}
            </div>
          );
        })}
      {(q.data?.count ?? 0) > 100 && (
        <p className="text-xs">Mostrando as 100 comissões mais recentes.</p>
      )}
      {pagamentos.error && <p role="alert">{pagamentos.error.message}</p>}
      {pagamentos.data?.map((p) => {
        const id = String(p["id"]),
          t = p["contas_pagar"] as Registro;
        return (
          <div key={id} className="border-b py-2 text-sm">
            {brl(p["valor"])} · {String(t?.["status"] ?? "")} · baixado {brl(t?.["valor_pago"])}
            {perm.pode("comissao_proporcional_operar") && t?.["status"] !== "cancelado" && (
              <div className="flex gap-2">
                <Input
                  aria-label={`Motivo do estorno ${id}`}
                  placeholder="Motivo do estorno"
                  value={motivos[id] ?? ""}
                  onChange={(e) => setMotivos((s) => ({ ...s, [id]: e.target.value }))}
                />
                <Button
                  variant="outline"
                  disabled={rpc.isPending || !motivos[id]?.trim() || Number(t?.["valor_pago"]) > 0}
                  onClick={() =>
                    rpc.mutate({
                      nome: "estornar_comissao_217",
                      args: { _parcela: id, _motivo: motivos[id] },
                    })
                  }
                >
                  Estornar agendamento
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
