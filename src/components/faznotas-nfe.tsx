import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import {
  faznotasPreviaNfe,
  faznotasEnviarNfe,
  faznotasProcessarNfe,
  faznotasStatusNfe,
  type StatusNfe,
} from "@/lib/faznotas-nfe.functions";
import type { ContextoNfe, OpcoesNfe } from "@/lib/faznotas-documento";
const moeda = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function linkFiscal(v: string | null) {
  try {
    const u = new URL(v ?? "");
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
const titulos: Record<string, string> = {
  preparando: "Preparando cadastros fiscais",
  enviando: "Enviando à FAZNOTAS",
  processando: "Aguardando retorno da SEFAZ",
  autorizada: "NF-e autorizada",
  rejeitada: "Emissão recusada",
  incerta: "Retorno precisa ser consultado",
  cancelada: "Documento cancelado no provedor",
};
export function FaznotasNfe({ nota, onClose }: { nota: string; onClose: () => void }) {
  const { client, session } = useSupabase();
  const qc = useQueryClient();
  const statusFn = useServerFn(faznotasStatusNfe),
    previaFn = useServerFn(faznotasPreviaNfe),
    enviarFn = useServerFn(faznotasEnviarNfe),
    processarFn = useServerFn(faznotasProcessarNfe);
  const args = { nota, accessToken: session?.access_token };
  const key = ["nfe-status", nota];
  const [cfopOperacao, setCfopOperacao] = useState("");
  const [consumidor, setConsumidor] = useState(""),
    [ie, setIe] = useState(""),
    [modalidade, setModalidade] = useState(""),
    [confirmado, setConfirmado] = useState(false),
    [pausado, setPausado] = useState(false);
  const status = useQuery({
    queryKey: key,
    enabled: !!session,
    queryFn: () => statusFn({ data: args }),
    refetchOnWindowFocus: false,
  });
  const contexto = useQuery({
    queryKey: ["nfe-contexto", nota],
    enabled: !!client && status.data?.vinculada === false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("contexto_nfe_259", { _nota: nota });
      if (error) throw new Error(error.message);
      return data as ContextoNfe;
    },
  });
  const c = { ...contexto.data?.dados.cliente, ...(contexto.data?.dados.pessoa ?? {}) };
  const ieCadastro = /^[129]$/.test(String(c["indicador_contribuinte_icms"] ?? ""))
    ? String(c["indicador_contribuinte_icms"])
    : "";
  function opcoes(): OpcoesNfe {
    if (!consumidor || !(ie || ieCadastro) || !modalidade)
      throw new Error("Informe consumidor final, situação da IE e modalidade do frete");
    return {
      ...(cfopOperacao ? { cfop: cfopOperacao } : {}),
      consumidor: consumidor as OpcoesNfe["consumidor"],
      indicadorIe: (ie || ieCadastro) as OpcoesNfe["indicadorIe"],
      modalidade: modalidade as OpcoesNfe["modalidade"],
    };
  }
  const previa = useMutation({
    mutationFn: () => previaFn({ data: { ...args, opcoes: opcoes() } }),
    onError: (e: Error) => toast.error(e.message),
  });
  function mudou() {
    previa.reset();
    setConfirmado(false);
  }
  async function atualizado(r: StatusNfe) {
    qc.setQueryData(key, r);
    await qc.invalidateQueries({ queryKey: ["notas_saida"] });
  }
  const enviar = useMutation({
    mutationFn: () => {
      if (!previa.data || !confirmado)
        throw new Error("Confira a prévia e confirme os dados antes de emitir");
      return enviarFn({ data: { ...args, opcoes: opcoes(), hash: previa.data.hash } });
    },
    onSuccess: atualizado,
    onError: (e: Error) => {
      toast.error(e.message);
      void status.refetch();
    },
  });
  const continuar = useMutation({
    mutationFn: (recuperar: boolean) => processarFn({ data: { ...args, recuperar } }),
    onSuccess: atualizado,
    onError: (e: Error) => {
      setPausado(true);
      toast.error(e.message);
      void status.refetch();
    },
  });
  const ocupado = continuar.isPending || enviar.isPending;
  const automatico =
    !!status.data?.vinculada &&
    ["preparando", "enviando", "processando"].includes(status.data.estado ?? "");
  const processar = continuar.mutate;
  useEffect(() => {
    if (!automatico || pausado || ocupado) return;
    const t = setTimeout(() => processar(false), 8000);
    return () => clearTimeout(t);
  }, [automatico, pausado, ocupado, processar, status.dataUpdatedAt]);
  const descartar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("abortar_preparacao_nfe_259", { _nota: nota });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await status.refetch();
      await qc.invalidateQueries({ queryKey: ["notas_saida"] });
      await qc.invalidateQueries({ queryKey: ["nfe-contexto", nota] });
      previa.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cfopsDisponiveis = (contexto.data?.dados.itens[0]?.regras ?? [])
    .filter(
      (regra) =>
        regra.revisao_valida &&
        contexto.data!.dados.itens.every((item) =>
          item.regras.some((r) => r.cfop === regra.cfop && r.revisao_valida),
        ),
    )
    .map((r) => r.cfop);
  const r = status.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>NF-e · FAZNOTAS</DialogTitle>
          <DialogDescription>
            Confira o documento antes de enviar. A autorização será registrada somente após o
            retorno fiscal confirmado.
          </DialogDescription>
        </DialogHeader>
        {(status.isLoading || contexto.isLoading) && <p>Carregando documento fiscal...</p>}
        {(status.error || contexto.error) && (
          <p role="alert" className="text-destructive">
            {status.error?.message || contexto.error?.message}
          </p>
        )}
        {r?.vinculada ? (
          <div className="space-y-4">
            <h3 className="font-semibold">{titulos[r.estado ?? ""] ?? "Acompanhe o documento"}</h3>
            <p className="text-sm">
              Ambiente declarado: {r.ambiente === "producao" ? "Produção" : "Homologação"} ·{" "}
              {r.produtos_prontos}/{r.total_produtos} cadastros fiscais preparados
            </p>
            {r.mensagem && (
              <p role="status" className="rounded-md bg-muted p-3 text-sm">
                {r.mensagem}
              </p>
            )}
            {r.recibo && (
              <p className="text-sm break-all">Protocolo de acompanhamento: {r.recibo}</p>
            )}
            {r.request_id && (
              <p className="text-xs text-muted-foreground">Referência do suporte: {r.request_id}</p>
            )}
            {automatico && !pausado && (
              <p className="text-sm text-muted-foreground">
                Acompanhamento a cada 8 segundos enquanto esta janela estiver aberta. A emissão
                reservada pode ser retomada ao voltar.
              </p>
            )}
            {r.estado === "autorizada" && (
              <div className="rounded-lg border p-4 space-y-2">
                <p>
                  NF-e {r.nf_numero} · Série {r.serie}
                </p>
                <p className="break-all text-sm">Chave: {r.chave}</p>
                <p className="text-sm">Protocolo de autorização: {r.protocolo}</p>
                <div className="flex gap-3">
                  {linkFiscal(r.danfe_url) && (
                    <a
                      className="underline"
                      href={linkFiscal(r.danfe_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir DANFE
                    </a>
                  )}
                  {linkFiscal(r.xml_url) && (
                    <a
                      className="underline"
                      href={linkFiscal(r.xml_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir XML
                    </a>
                  )}
                </div>
                {(!r.danfe_url || !r.xml_url) && (
                  <p className="text-sm text-muted-foreground">
                    Os arquivos ainda não foram disponibilizados. Atualize a consulta.
                  </p>
                )}
              </div>
            )}
            {r.estado === "rejeitada" && (
              <p className="text-sm text-destructive">
                Revise o motivo com o contador/provedor. Este documento mantém sua identificação
                original; não crie outra nota para contornar a recusa. Correção e cancelamento
                remoto precisam ser tratados no provedor.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  ocupado ||
                  descartar.isPending ||
                  (r.estado === "rejeitada" && !r.recibo) ||
                  r.estado === "cancelada"
                }
                onClick={() => {
                  setPausado(false);
                  continuar.mutate(true);
                }}
              >
                {ocupado
                  ? "Processando..."
                  : r.estado === "incerta" && !r.recibo
                    ? "Recuperar envio original"
                    : "Atualizar acompanhamento"}
              </Button>
              {["preparando", "incerta", "rejeitada"].includes(r.estado ?? "") && !r.recibo && (
                <Button
                  variant="outline"
                  disabled={ocupado || descartar.isPending}
                  onClick={() => descartar.mutate()}
                >
                  Descartar preparação ou recusa sem enfileiramento
                </Button>
              )}
            </div>
          </div>
        ) : (
          contexto.data && (
            <div className="space-y-4">
              <p className="font-medium">
                {String(c["razao_social"] ?? "Cliente")} · Pedido{" "}
                {String(contexto.data.dados.pedido["numero"] ?? "")}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="nfe-consumidor">Consumidor final</Label>
                  <select
                    id="nfe-consumidor"
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={consumidor}
                    disabled={ocupado || previa.isPending}
                    onChange={(e) => {
                      setConsumidor(e.target.value);
                      mudou();
                    }}
                  >
                    <option value="">Selecione</option>
                    <option value="0">Não</option>
                    <option value="1">Sim</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="nfe-ie">Situação da inscrição estadual</Label>
                  <select
                    id="nfe-ie"
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={ie || ieCadastro}
                    disabled={ocupado || previa.isPending}
                    onChange={(e) => {
                      setIe(e.target.value);
                      mudou();
                    }}
                  >
                    <option value="">Selecione</option>
                    <option value="1">Contribuinte ICMS</option>
                    <option value="2">Contribuinte isento</option>
                    <option value="9">Não contribuinte</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="nfe-frete">Modalidade de transporte</Label>
                  <select
                    id="nfe-frete"
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={modalidade}
                    disabled={ocupado || previa.isPending}
                    onChange={(e) => {
                      setModalidade(e.target.value);
                      mudou();
                    }}
                  >
                    <option value="">Selecione</option>
                    <option value="0">Por conta do remetente</option>
                    <option value="1">Por conta do destinatário</option>
                    <option value="2">Por conta de terceiros</option>
                    <option value="3">Próprio do remetente</option>
                    <option value="4">Próprio do destinatário</option>
                    <option value="9">Sem transporte</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="nfe-cfop">CFOP da operação</Label>
                <select
                  id="nfe-cfop"
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={cfopOperacao}
                  disabled={ocupado || previa.isPending}
                  onChange={(e) => {
                    setCfopOperacao(e.target.value);
                    mudou();
                  }}
                >
                  <option value="">Automático pelas regras da loja e dos produtos</option>
                  {cfopsDisponiveis.map((cfop) => (
                    <option key={cfop} value={cfop}>
                      {cfop} · Regra revisada em todos os itens
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Para enquadramentos diferentes, selecione uma regra comum já revisada. Vendas
                  interestaduais a não contribuintes exigem CFOP próprio; o CEP define a UF, não a
                  natureza da operação.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={ocupado || previa.isPending}
                onClick={() => previa.mutate()}
              >
                {previa.isPending ? "Conferindo cadastro e CEP..." : "Conferir dados para emissão"}
              </Button>
              {previa.data && (
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold">
                    Conferência ·{" "}
                    {previa.data.snapshot.ambiente === "producao"
                      ? "Produção"
                      : "Homologação declarada"}
                  </h3>
                  <p>
                    Emitente: {previa.data.snapshot.cnpj} · Série{" "}
                    {previa.data.snapshot.emissao.serie} · CFOP {previa.data.snapshot.emissao.cfop}
                  </p>
                  <p>
                    Total do documento antes da apuração do provedor:{" "}
                    <strong>{moeda(previa.data.snapshot.total)}</strong>
                  </p>
                  <p className="text-sm">
                    Frete: {moeda(previa.data.snapshot.emissao.transporte["valor-frete"])} · Outras
                    despesas: {moeda(previa.data.snapshot.emissao["valor-despesas"])}
                  </p>
                  <ul className="list-disc pl-5 text-sm">
                    {previa.data.snapshot.produtos.map((p, i) => (
                      <li key={p.referencia}>
                        {p.nome} · Quantidade{" "}
                        {Number(previa.data!.snapshot.emissao.itens[i]!.quantidade)} {p.medida} ·
                        NCM {p.ncm}
                      </li>
                    ))}
                  </ul>
                  {previa.data.snapshot.avisos.map((a) => (
                    <p key={a} className="text-sm text-muted-foreground">
                      {a}
                    </p>
                  ))}
                  <p className="text-sm text-muted-foreground">
                    O ambiente é o habilitado na conta FAZNOTAS. A indicação local não altera a
                    configuração do provedor.
                  </p>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmado}
                      disabled={ocupado}
                      onChange={(e) => setConfirmado(e.target.checked)}
                    />
                    Conferi destinatário, CFOP, tributação e valores e desejo transmitir esta NF-e.
                  </label>
                  <Button disabled={!confirmado || ocupado} onClick={() => enviar.mutate()}>
                    {ocupado
                      ? "Reservando e enviando..."
                      : previa.data.snapshot.ambiente === "producao"
                        ? "Emitir NF-e em produção"
                        : "Emitir NF-e no ambiente declarado de homologação"}
                  </Button>
                  <details>
                    <summary className="cursor-pointer text-sm">Ver requisição preparada</summary>
                    <pre className="max-h-72 overflow-auto bg-muted p-3 text-xs">
                      {JSON.stringify(previa.data.snapshot.emissao, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )
        )}
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
