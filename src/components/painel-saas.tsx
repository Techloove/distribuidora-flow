import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { brl, dataBr, mesBr, dataHoraBr } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { estadosSaas, type SaasPainel, type SaasParcela } from "@/lib/saas";
import { ConfigurarContratoSaas } from "@/components/configurar-contrato-saas";
import { FaturasSaas } from "@/components/faturas-saas";
import { periodicidadesSaas } from "@/lib/faturas-saas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PainelSaas({ administracao = false }: { administracao?: boolean }) {
  const { client, session, saas, loading, error, signOut } = useSupabase();
  const qc = useQueryClient();
  const [configurar, setConfigurar] = useState(false);
  const [tipoCobranca, setTipoCobranca] = useState("todos");
  const [servico, setServico] = useState<{
    id: string;
    descricao: string;
    valor: string;
    vencimento: string;
    observacao: string;
    revisao: number;
  } | null>(null);
  const [revisarServico, setRevisarServico] = useState(false);
  const [operacao, setOperacao] = useState<{
    parcela: SaasParcela;
    acao: string;
    chave: string;
  } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pagamento, setPagamento] = useState(hojeSaoPaulo());
  const painel = useQuery({
    queryKey: ["saas-painel", session?.user.id],
    enabled: !!client && !!session && !!saas && (!administracao || saas.proprietario),
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await client!.rpc("saas_painel_330");
      if (r.error) throw new Error(r.error.message);
      return r.data as SaasPainel;
    },
  });
  const atualizar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["saas-painel"] }),
      qc.invalidateQueries({ queryKey: ["session-permissions"] }),
    ]);
  };
  const salvarServico = useMutation({
    mutationFn: async () => {
      if (!servico) throw new Error("Informe o serviço.");
      const r = await client!.rpc("saas_salvar_servico_331", {
        _id: servico.id,
        _descricao: servico.descricao,
        _valor: Number(servico.valor),
        _vencimento: servico.vencimento,
        _observacao: servico.observacao,
        _revisao: servico.revisao,
      });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: async () => {
      setServico(null);
      setRevisarServico(false);
      await atualizar();
      toast.success("Serviço adicional salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const nomeCobranca = (p: SaasParcela) =>
    p.descricao
      ? `${p.descricao} · parcela ${p.parcela}`
      : p.tipo === "servico"
        ? (painel.data?.servicos?.find((s) => `servico:${s.id}` === p.chave)?.descricao ??
          "Serviço adicional")
        : p.tipo === "implantacao"
          ? `Implantação · parcela ${p.parcela}`
          : "Mensalidade";
  const abrirServico = (p?: SaasParcela) => {
    const s = p ? painel.data?.servicos?.find((x) => `servico:${x.id}` === p.chave) : undefined;
    setServico(
      s
        ? { ...s, valor: String(s.valor) }
        : {
            id: crypto.randomUUID(),
            descricao: "",
            valor: "0",
            vencimento: hojeSaoPaulo(),
            observacao: "",
            revisao: 0,
          },
    );
    setRevisarServico(false);
  };
  const registrar = useMutation({
    mutationFn: async () => {
      if (!operacao) throw new Error("Selecione uma parcela.");
      const r = await client!.rpc("saas_registrar_pagamento_330", {
        _chave: operacao.parcela.chave,
        _acao: operacao.acao,
        _data: operacao.acao === "pago" ? pagamento : null,
        _motivo: motivo,
        _requisicao: operacao.chave,
      });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: async () => {
      setOperacao(null);
      await atualizar();
      toast.success("Histórico de cobrança atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const abrirContrato = () => setConfigurar(true);
  const estado = painel.data?.status ?? saas;
  const dono = !!saas?.proprietario;
  const parcelas = painel.data?.parcelas ?? [];
  const card = "rounded-2xl border bg-card p-5 shadow-sm";
  if (loading)
    return (
      <p role="status" className="p-8">
        Verificando acesso à assinatura…
      </p>
    );
  if (!session)
    return (
      <main className="mx-auto max-w-lg space-y-5 p-8">
        <h1 className="text-2xl font-semibold">
          {administracao ? "Administração da plataforma" : "Minha assinatura"}
        </h1>
        <p>Entre com a conta autorizada para continuar.</p>
        <Link
          to="/auth"
          search={{ painel: administracao ? "plataforma" : "assinatura" }}
          className="text-primary underline"
        >
          Entrar
        </Link>
      </main>
    );
  if (error || (administracao && !dono))
    return (
      <main className="mx-auto max-w-lg space-y-4 p-8">
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p role="alert">
          {error ??
            "Este painel é exclusivo do proprietário da plataforma. O perfil administrador da distribuidora não concede essa permissão."}
        </p>
        <Link to="/dashboard" className="text-primary underline">
          Voltar ao sistema
        </Link>
        <Button
          variant="outline"
          onClick={() => void signOut().catch((e: Error) => toast.error(e.message))}
        >
          Sair
        </Button>
      </main>
    );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-muted/40 p-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary">
            {administracao ? "Administração da plataforma" : "Contrato e cobrança"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {administracao ? "Painel SaaS" : "Minha assinatura"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {estado ? estadosSaas[estado.estado] : "Consultando assinatura…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={painel.isFetching} onClick={() => void atualizar()}>
            Atualizar
          </Button>
          {!saas?.bloqueado && (
            <Link to="/dashboard" className="rounded-xl border px-3 py-2 text-sm">
              Abrir sistema
            </Link>
          )}
          {dono && !administracao && (
            <Link to="/plataforma" className="rounded-xl border px-3 py-2 text-sm">
              Administrar plataforma
            </Link>
          )}
          <Button
            variant="outline"
            onClick={() => void signOut().catch((e: Error) => toast.error(e.message))}
          >
            Sair
          </Button>
        </div>
      </header>
      {estado?.bloqueado && (
        <section
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5"
        >
          <h2 className="font-semibold">Regularização necessária</h2>
          <p className="mt-2 text-sm">
            O uso do sistema está suspenso por pagamento pendente. Seus dados permanecem
            preservados. O proprietário da plataforma confirma o recebimento e o acesso é liberado
            quando não houver parcelas além da tolerância.
          </p>
        </section>
      )}
      {painel.isPending ? (
        <p role="status">Carregando contrato…</p>
      ) : painel.isError ? (
        <section role="alert" className={card}>
          <p>{painel.error.message}</p>
          <Button onClick={() => void atualizar()}>Tentar novamente</Button>
        </section>
      ) : !painel.data?.contrato ? (
        <p className={card}>{painel.data?.mensagem ?? "Procure o usuário master da empresa."}</p>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{painel.data.contrato.empresa}</h2>
                <p className="mt-1 text-sm">
                  {painel.data.contrato.plano} · {painel.data.contrato.dominio}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Responsável: {painel.data.contrato.responsavel || "Não informado"} ·{" "}
                  {painel.data.contrato.contato || "Contato não informado"}
                </p>
              </div>
              {administracao && dono && (
                <Button onClick={abrirContrato}>Configurar contrato</Button>
              )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Tolerância: {painel.data.contrato.tolerancia} dia(s) após o vencimento. Avisos:{" "}
              {painel.data.contrato.aviso_dias} dia(s) antes. Confirmação de pagamento manual pelo
              proprietário.
            </p>
            {painel.data.contrato.instrucoes && (
              <p className="mt-4 whitespace-pre-wrap rounded-xl bg-muted p-4 text-sm">
                {painel.data.contrato.instrucoes}
              </p>
            )}
          </section>
          {painel.data.contrato.modelo_335 && (
            <section className={card}>
              <h2 className="font-semibold">Serviços contratados</h2>
              <p className="my-3 text-sm">
                Vigência: {dataBr(painel.data.contrato.inicio)} a {dataBr(painel.data.contrato.fim)}
              </p>
              <div className="divide-y">
                {painel.data.itens_contrato?.map((s) => (
                  <div key={s.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{s.descricao}</p>
                      <p className="text-muted-foreground">
                        {periodicidadesSaas[s.periodicidade]}
                        {s.periodicidade === "parcelado" ? ` · ${s.parcelas} parcela(s)` : ""} ·
                        primeiro vencimento {dataBr(s.primeiro_vencimento)}
                      </p>
                      {s.observacao && (
                        <p className="text-xs text-muted-foreground">{s.observacao}</p>
                      )}
                    </div>
                    <p className="font-semibold">
                      {brl(s.valor)}
                      <span className="block text-right text-xs font-normal text-muted-foreground">
                        {s.periodicidade === "parcelado" ? "Total do serviço" : "Por cobrança"}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
          <FaturasSaas parcelas={parcelas} contrato={painel.data.contrato} />
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "Em aberto",
                parcelas
                  .filter((p) => ["pendente", "vencido"].includes(p.estado))
                  .reduce((s, p) => s + Number(p.valor), 0),
              ],
              [
                "Vencido",
                parcelas
                  .filter((p) => p.estado === "vencido")
                  .reduce((s, p) => s + Number(p.valor), 0),
              ],
              [
                "Pagamentos confirmados",
                parcelas
                  .filter((p) => p.estado === "pago")
                  .reduce((s, p) => s + Number(p.valor), 0),
              ],
            ].map(([l, v]) => (
              <div key={String(l)} className={card}>
                <p className="text-xs text-muted-foreground">{l}</p>
                <p className="mt-2 text-xl font-semibold">{brl(v)}</p>
              </div>
            ))}
          </section>
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Cobranças da plataforma</h2>
              {administracao && dono && (
                <Button onClick={abrirContrato}>Configurar serviços</Button>
              )}
            </div>
            {administracao && dono && !painel.data.contrato.modelo_335 && (
              <p className="mb-3 text-sm text-muted-foreground">
                Defina a vigência e a lista de serviços em Configurar contrato.
              </p>
            )}
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                ["todos", "Todas"],
                ["mensalidade", "Mensalidades"],
                ["implantacao", "Implantação"],
                ["servico", "Outros serviços"],
                ["hospedagem", "Hospedagem"],
                ["dominio", "Domínio"],
              ].map(([tipo, label]) => (
                <Button
                  key={tipo}
                  size="sm"
                  variant={tipoCobranca === tipo ? "default" : "outline"}
                  onClick={() => setTipoCobranca(tipo!)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Consulte e registre o pagamento de cada item da fatura. A lista respeita a vigência e
              os vencimentos configurados. Cobranças anteriores ficam preservadas. Os recebimentos
              seguem separados do financeiro da distribuidora.
            </p>
            {parcelas.filter((p) => tipoCobranca === "todos" || p.tipo === tipoCobranca).length ? (
              <Table className="mobile-cards">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobrança</TableHead>
                    <TableHead>Competência</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Pagamento</TableHead>
                    {administracao && dono && <TableHead>Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parcelas
                    .filter((p) => tipoCobranca === "todos" || p.tipo === tipoCobranca)
                    .map((p) => (
                      <TableRow key={p.chave}>
                        <TableCell>
                          <span className="block max-w-[16rem] whitespace-normal break-words">
                            {nomeCobranca(p)}
                          </span>
                          {p.tipo === "servico" && (
                            <span className="block text-xs text-muted-foreground">
                              Serviço adicional
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{mesBr(p.competencia)}</TableCell>
                        <TableCell>{dataBr(p.vencimento)}</TableCell>
                        <TableCell>{brl(p.valor)}</TableCell>
                        <TableCell>
                          {p.estado === "pago"
                            ? "Pago"
                            : p.estado === "cancelado"
                              ? "Cancelado"
                              : p.estado === "vencido"
                                ? "Vencido"
                                : "Pendente"}
                        </TableCell>
                        <TableCell>{dataBr(p.pagamento_data)}</TableCell>
                        {administracao && dono && (
                          <TableCell>
                            <div className="flex max-w-[19rem] flex-wrap gap-2">
                              {!painel.data?.contrato?.modelo_335 &&
                                p.tipo === "servico" &&
                                painel.data?.servicos?.some(
                                  (s) => `servico:${s.id}` === p.chave && s.editavel,
                                ) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => abrirServico(p)}
                                  >
                                    Editar serviço
                                  </Button>
                                )}
                              {(p.estado === "pago" || p.estado === "cancelado"
                                ? ["reaberto"]
                                : ["pago", "cancelado"]
                              ).map((acao) => (
                                <Button
                                  key={acao}
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setOperacao({ parcela: p, acao, chave: crypto.randomUUID() });
                                    setMotivo("");
                                    setPagamento(hojeSaoPaulo());
                                  }}
                                >
                                  {acao === "pago"
                                    ? "Confirmar pagamento"
                                    : acao === "reaberto"
                                      ? "Reabrir cobrança"
                                      : "Cancelar cobrança"}
                                </Button>
                              ))}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                {parcelas.length
                  ? "Nenhuma cobrança neste filtro."
                  : "Nenhuma cobrança cadastrada. Configure o contrato antes de ativar o controle."}
              </p>
            )}
          </section>
          <section className={card}>
            <h2 className="mb-4 font-semibold">Histórico da assinatura</h2>
            <ul className="divide-y">
              {painel.data.historico?.map((e) => (
                <li key={e.id} className="py-3 text-sm">
                  <p className="font-medium">
                    {e.acao === "contrato"
                      ? "Contrato atualizado"
                      : e.acao === "pago"
                        ? "Pagamento confirmado"
                        : e.acao === "reaberto"
                          ? "Cobrança reaberta"
                          : "Cobrança cancelada"}{" "}
                    ·{" "}
                    {e.chave?.startsWith("mensal:")
                      ? mesBr(e.chave.slice(7))
                      : e.chave?.startsWith("servico:")
                        ? (painel.data?.servicos?.find((s) => `servico:${s.id}` === e.chave)
                            ?.descricao ?? "Serviço adicional")
                        : e.chave?.startsWith("contrato:")
                          ? (parcelas.find((p) => p.chave === e.chave)?.descricao ??
                            "Serviço do contrato")
                          : e.chave?.replace("setup:", "Implantação · parcela ")}
                    {e.valor != null && ` · ${brl(e.valor)}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dataHoraBr(e.criado_em)} · {e.motivo}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {configurar && painel.data?.contrato && (
        <ConfigurarContratoSaas
          painel={painel.data}
          fechar={() => setConfigurar(false)}
          salvo={atualizar}
        />
      )}
      <Dialog
        open={!!servico}
        onOpenChange={(o) => {
          if (!o && !salvarServico.isPending) setServico(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {servico?.revisao ? "Editar serviço adicional" : "Adicionar serviço"}
            </DialogTitle>
            <DialogDescription>
              Taxa de domínio, hospedagem, suporte ou outro serviço. Cada lançamento tem valor e
              vencimento próprios.
            </DialogDescription>
          </DialogHeader>
          {servico && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (Number(servico.valor) <= 0) {
                  toast.error("Informe um valor maior que zero.");
                  return;
                }
                if (revisarServico) salvarServico.mutate();
                else setRevisarServico(true);
              }}
            >
              <div>
                <Label htmlFor="saas-servico-descricao">Serviço / descrição</Label>
                <Input
                  id="saas-servico-descricao"
                  list="saas-sugestoes-servicos"
                  required
                  minLength={2}
                  maxLength={160}
                  value={servico.descricao}
                  disabled={salvarServico.isPending}
                  onChange={(e) => {
                    setServico({ ...servico, descricao: e.target.value });
                    setRevisarServico(false);
                  }}
                />
                <datalist id="saas-sugestoes-servicos">
                  {[
                    "Taxa de domínio",
                    "Hospedagem",
                    "Suporte técnico",
                    "Treinamento",
                    "Configuração adicional",
                  ].map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="saas-servico-valor">Valor (R$)</Label>
                  <Input
                    id="saas-servico-valor"
                    currency
                    required
                    value={servico.valor}
                    disabled={salvarServico.isPending}
                    onChange={(e) => {
                      setServico({ ...servico, valor: e.target.value });
                      setRevisarServico(false);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="saas-servico-vencimento">Vencimento</Label>
                  <Input
                    id="saas-servico-vencimento"
                    type="date"
                    required
                    value={servico.vencimento}
                    disabled={salvarServico.isPending}
                    onChange={(e) => {
                      setServico({ ...servico, vencimento: e.target.value });
                      setRevisarServico(false);
                    }}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="saas-servico-observacao">Observação (opcional)</Label>
                <Textarea
                  id="saas-servico-observacao"
                  maxLength={1000}
                  value={servico.observacao}
                  disabled={salvarServico.isPending}
                  onChange={(e) => {
                    setServico({ ...servico, observacao: e.target.value });
                    setRevisarServico(false);
                  }}
                />
              </div>
              {revisarServico && (
                <p role="alert" className="rounded-xl border bg-muted/30 p-3 text-sm">
                  {servico.descricao} · {brl(servico.valor)} · vencimento{" "}
                  {dataBr(servico.vencimento)}. Esta cobrança entra no saldo da assinatura e pode
                  causar bloqueio se vencer além da tolerância com o controle ativo. Após registro
                  financeiro, os dados ficam preservados; use cancelamento e uma nova cobrança para
                  corrigir.
                </p>
              )}
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={salvarServico.isPending}
                  onClick={() => setServico(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={salvarServico.isPending}>
                  {salvarServico.isPending
                    ? "Salvando…"
                    : revisarServico
                      ? "Confirmar cobrança"
                      : "Revisar cobrança"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!operacao}
        onOpenChange={(o) => {
          if (!o && !registrar.isPending) setOperacao(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {operacao?.acao === "pago"
                ? "Confirmar pagamento recebido"
                : operacao?.acao === "cancelado"
                  ? "Cancelar cobrança"
                  : "Reabrir cobrança"}
            </DialogTitle>
            <DialogDescription>
              O histórico será preservado. Esta operação não movimenta o caixa da distribuidora nem
              confirma recebimento em banco.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              registrar.mutate();
            }}
          >
            <p>{operacao ? nomeCobranca(operacao.parcela) : ""}</p>
            <p>
              {brl(operacao?.parcela.valor)} · vencimento {dataBr(operacao?.parcela.vencimento)}
            </p>
            {operacao?.acao === "pago" && (
              <div>
                <Label htmlFor="saas-pagamento">Data do pagamento</Label>
                <Input
                  id="saas-pagamento"
                  type="date"
                  required
                  max={hojeSaoPaulo()}
                  value={pagamento}
                  onChange={(e) => setPagamento(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label htmlFor="saas-motivo">Motivo ou referência do recebimento</Label>
              <Textarea
                id="saas-motivo"
                required
                minLength={5}
                maxLength={1000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <Button disabled={registrar.isPending}>
              {registrar.isPending ? "Registrando…" : "Confirmar registro"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export function AvisoAssinatura() {
  const { saas } = useSupabase();
  if (!saas || (!saas.master && !saas.proprietario)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
      <p>
        {saas.controle_ativo ? estadosSaas[saas.estado] : "Assinatura da plataforma"}
        {saas.controle_ativo && saas.vencimento && ` · vencimento ${dataBr(saas.vencimento)}`}
      </p>
      <div className="flex gap-4">
        <Link to="/assinatura" className="text-primary underline">
          Minha assinatura
        </Link>
        {saas.proprietario && (
          <Link to="/plataforma" className="text-primary underline">
            Painel SaaS
          </Link>
        )}
      </div>
    </div>
  );
}
