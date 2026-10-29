import { ContextoReferencia } from "@/components/contexto-referencia";
import { ReferenciaRegistro } from "@/components/referencia-registro";
import { correspondeReferencia, type BuscaReferencias } from "@/lib/referencias-registros";
import { ReimprimirBoleto } from "@/components/reimprimir-boleto";
import { LiquidacaoSicredi } from "@/components/liquidacao-sicredi";
import { SicrediAutomatico } from "@/components/sicredi-automatico";
import { EmitirBoletosPedido, EmitirBoletoTitulo } from "@/components/emitir-boletos-pedido";
import { ConfirmarNossoNumero } from "@/components/confirmar-nosso-numero";
import { AlterarVencimentoBoleto } from "@/components/alterar-vencimento-boleto";
import { BoletoPix } from "@/components/boleto-pix";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Printer, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { SicrediCnabPanel } from "@/components/sicredi-cnab-panel";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  filtrarBoletos,
  dataBoleto,
  periodoBoletosInvalido,
  agruparTarifasApi,
  ordenarBoletos,
  cancelamentoBoletoPendente,
} from "@/lib/boletos-lista";
import { filtrarCentro, useCentro } from "@/lib/centro-store";
import {
  sicrediBaixarBoleto,
  sicrediConsultarBoleto,
  sicrediStatus,
} from "@/lib/sicredi.functions";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

const statusLabel: Record<string, string> = {
  pendente: "Pendente",
  em_processamento: "Em processamento",
  registrado: "Registrado",
  liquidado: "Liquidado",
  baixado: "Baixado",
  cancelado: "Cancelado",
  erro: "Erro",
};

function dataBr(v: unknown) {
  const s = dataBoleto(v);
  return s ? s.split("-").reverse().join("/") : "—";
}

export function BoletosPage({ referencia }: { referencia?: BuscaReferencias }) {
  const { client, roles, session } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [cancelarBoleto, setCancelarBoleto] = useState<Row | null>(null);
  const [motivoBaixa, setMotivoBaixa] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const consultarFn = useServerFn(sicrediConsultarBoleto);
  const baixarFn = useServerFn(sicrediBaixarBoleto);

  const config = useQuery({
    queryKey: ["sicredi", "status", session?.user.id, centro],
    enabled: !!session && canFinance && !!centro,
    queryFn: () =>
      sicrediStatus({
        data: {
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
          ...(centro ? { centro_id: centro } : {}),
        },
      }),
  });

  const boletos = useQuery({
    queryKey: ["boletos", "lista", session?.user.id, centro],
    enabled: !!client && !!session,
    queryFn: async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        let query = client!
          .from("boletos")
          .select("*,pedidos(status)")
          .order("vencimento", { ascending: false })
          .order("id");
        if (centro) query = query.eq("centro_id", centro);
        const { data, error } = await query.range(offset, offset + 499);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return rows;
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes", "options", session?.user.id],
    enabled: !!client && !!session,
    queryFn: async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client!
          .from("clientes")
          .select("id, razao_social")
          .order("razao_social")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return rows;
    },
  });

  const cliName = useCallback(
    (id: unknown) => String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—"),
    [clientes.data],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] });
    queryClient.invalidateQueries({ queryKey: ["boletos"] });
    queryClient.invalidateQueries({ queryKey: ["contas_receber"] });
    queryClient.invalidateQueries({ queryKey: ["sicredi-tarifa"] });
  };

  const daLoja = useMemo(() => filtrarCentro(boletos.data ?? [], centro), [boletos.data, centro]);
  const opcoesClientes = useMemo(() => {
    const ids = new Set(daLoja.map((b) => String(b["cliente_id"])));
    return (clientes.data ?? [])
      .filter((c) => ids.has(String(c["id"])))
      .map((c) => ({ value: String(c["id"]), label: String(c["razao_social"]) }));
  }, [daLoja, clientes.data]);
  const boletosFiltrados = useMemo(
    () =>
      ordenarBoletos(
        filtrarBoletos(
          daLoja.filter((r) => !referencia || correspondeReferencia(r, referencia, true)),
          filtros,
          cliName,
        ),
        filtros["ordem"] ?? "vencimento_asc",
      ),
    [daLoja, filtros, cliName, referencia],
  );
  const periodoInvalido = periodoBoletosInvalido(filtros);
  const tarifas = useQuery({
    queryKey: ["sicredi-tarifa", "lista", session?.user.id, centro],
    enabled: !!client && !!session && canFinance,
    queryFn: async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        let query = client!
          .from("sicredi_tarifas_279")
          .select("boleto_id,valor,origem,movimentos_financeiros(status)")
          .order("boleto_id");
        if (centro) query = query.eq("centro_id", centro);
        const { data, error } = await query.range(offset, offset + 499);
        if (error)
          throw new Error(
            "Não foi possível conferir as tarifas. Confira o acesso e a instalação da fase279.",
          );
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return new Map(rows.map((r) => [String(r["boleto_id"]), r]));
    },
  });

  const tarifasApi = useQuery({
    queryKey: ["sicredi-tarifas-api", session?.user.id, centro],
    enabled: !!client && !!session && canFinance,
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        let query = client!
          .from("sicredi_tarifas_api_280")
          .select("boleto_id,data_lancamento,tarifa_total,outros_debitos,debitos")
          .order("boleto_id")
          .order("data_lancamento");
        if (centro) query = query.eq("centro_id", centro);
        const { data, error } = await query.range(offset, offset + 499);
        if (error)
          throw new Error(
            "Tarifas da API indisponíveis. Confira o acesso e a instalação da fase280.",
          );
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return agruparTarifasApi(rows);
    },
  });
  const statusTarifas = useQuery({
    queryKey: ["sicredi-tarifas-status", session?.user.id, centro],
    enabled: !!client && !!session && canFinance,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await client!.rpc("sicredi_tarifas_status_280", {
        _centro: centro || null,
      });
      if (error) throw new Error("Não foi possível conferir o agendamento das tarifas.");
      return data as {
        ultima_consulta: string | null;
        dias_pendentes: number;
        dias_com_erro: number;
      };
    },
  });

  const financeiroTarifas = useQuery({
    queryKey: ["sicredi-tarifa-financeiro-lista", session?.user.id, centro],
    enabled: !!client && !!session && canFinance,
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        let query = client!
          .from("sicredi_tarifas_financeiro_282")
          .select("boleto_id,estado,movimento_id,movimento:movimentos_financeiros(status)")
          .order("boleto_id")
          .order("data_lancamento");
        if (centro) query = query.eq("centro_id", centro);
        const { data, error } = await query.range(offset, offset + 499);
        if (error) throw new Error("Confira o acesso e a instalação financeira da fase282.");
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      const result = new Map<string, Row[]>();
      for (const row of rows) {
        const key = String(row["boleto_id"]);
        result.set(key, [...(result.get(key) ?? []), row]);
      }
      return result;
    },
  });
  const consultar = useMutation({
    mutationFn: async (b: Row) => {
      const res = await consultarFn({
        data: {
          boletoId: String(b["id"]),
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
      return res.situacao || (res.liquidado ? "liquidado" : res.baixado ? "baixado" : "registrado");
    },
    onSuccess: (s) => {
      toast.success(`Situação no Sicredi: ${s}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: async (b: Row) => {
      await baixarFn({
        data: {
          boletoId: String(b["id"]),
          motivo: motivoBaixa,
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Cancelamento solicitado ao Sicredi. A consulta confirmará a baixa.");
      setCancelarBoleto(null);
      setMotivoBaixa("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emAberto = boletosFiltrados
    .filter((b) => b["status"] === "registrado")
    .reduce((s, b) => s + Number(b["valor"] ?? 0), 0);
  const liquidado = boletosFiltrados
    .filter((b) => b["status"] === "liquidado")
    .reduce((s, b) => s + Number(b["valor_liquidado"] ?? b["valor"] ?? 0), 0);

  const copiar = (v: unknown) => {
    void navigator.clipboard.writeText(String(v ?? ""));
    toast.success("Copiado");
  };

  return (
    <ErpLayout
      title="Boletos"
      description="Cobrança por centro de custo, com emissão Sicredi via API e acompanhamento das parcelas."
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      }
    >
      <ContextoReferencia busca={referencia} to="/boletos" />
      <AlertDialog
        open={!!cancelarBoleto}
        onOpenChange={(v) => {
          if (!v && !baixar.isPending) setCancelarBoleto(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja realmente cancelar este boleto?</AlertDialogTitle>
            <AlertDialogDescription>
              Cliente: {cliName(cancelarBoleto?.["cliente_id"])} · Nosso número:{" "}
              {String(cancelarBoleto?.["nosso_numero"] ?? "")} · Valor:{" "}
              {brl(cancelarBoleto?.["valor"])}. O pedido de baixa será enviado ao Sicredi e precisa
              de confirmação pela consulta bancária. Isso não cancela o pedido de venda nem quita a
              conta a receber.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Label htmlFor="motivo-baixa-boleto">Motivo obrigatório · administrador</Label>
          <Textarea
            id="motivo-baixa-boleto"
            minLength={10}
            maxLength={2000}
            value={motivoBaixa}
            disabled={baixar.isPending}
            onChange={(e) => setMotivoBaixa(e.target.value)}
            placeholder="Descreva o motivo da solicitação de baixa"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={baixar.isPending}>Voltar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                baixar.isPending ||
                !cancelarBoleto ||
                !roles.includes("admin") ||
                motivoBaixa.trim().length < 10
              }
              onClick={() => {
                if (cancelarBoleto) baixar.mutate(cancelarBoleto);
              }}
            >
              {baixar.isPending ? "Enviando…" : "Sim, solicitar cancelamento"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="space-y-6">
        <SicrediAutomatico />
        <p className="text-sm text-muted-foreground">
          Emita boletos em{" "}
          <Link to="/pedidos" search={{ pedido: undefined }} className="font-medium underline">
            Pedidos
          </Link>{" "}
          ou em{" "}
          <Link to="/receber" className="font-medium underline">
            Contas a receber
          </Link>
          . Configure banco e regras em Centros de custo.
        </p>
        <SicrediCnabPanel />
        {config.data && !config.data.configurado ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Registro direto pela API não configurado</p>
            <p className="mt-1 text-muted-foreground">{config.data.erro}</p>
          </div>
        ) : config.data ? (
          <p className="text-xs text-muted-foreground">
            Sicredi · ambiente <strong>{config.data.ambiente}</strong> · cooperativa{" "}
            {config.data.cooperativa} · posto {config.data.posto} · beneficiário{" "}
            {config.data.beneficiario}
          </p>
        ) : null}

        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Busca (cliente/nº)"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
          />
          <FilterSelect
            label="Ordenar por"
            value={filtros["ordem"] ?? ""}
            onChange={(v) => setF("ordem", v)}
            allLabel="Padrão: primeiro vencimento"
            options={[
              { value: "emissao_asc", label: "Emissão: mais antiga primeiro" },
              { value: "emissao_desc", label: "Emissão: mais recente primeiro" },
              { value: "vencimento_asc", label: "Vencimento: primeiro vencimento" },
              { value: "vencimento_desc", label: "Vencimento: mais recente primeiro" },
            ]}
          />
          <FilterSelect
            label="Cliente"
            value={filtros["cliente"] ?? ""}
            onChange={(v) => setF("cliente", v)}
            options={opcoesClientes}
            allLabel="Todos os clientes da loja"
          />
          <FilterSelect
            label="Situação do boleto"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
          />
          <FilterText
            label="Vencimento de"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Vencimento até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
          <FilterText
            label="Emissão de"
            type="date"
            value={filtros["emissao_de"] ?? ""}
            onChange={(v) => setF("emissao_de", v)}
          />
          <FilterText
            label="Emissão até"
            type="date"
            value={filtros["emissao_ate"] ?? ""}
            onChange={(v) => setF("emissao_ate", v)}
          />
          <FilterText
            label="Liquidação de"
            type="date"
            value={filtros["liquidacao_de"] ?? ""}
            onChange={(v) => setF("liquidacao_de", v)}
          />
          <FilterText
            label="Liquidação até"
            type="date"
            value={filtros["liquidacao_ate"] ?? ""}
            onChange={(v) => setF("liquidacao_ate", v)}
          />
          <FilterText
            label="Valor mínimo"
            type="number"
            value={filtros["min"] ?? ""}
            onChange={(v) => setF("min", v)}
          />
          <FilterText
            label="Valor máximo"
            type="number"
            value={filtros["max"] ?? ""}
            onChange={(v) => setF("max", v)}
          />
        </FilterBar>
        {periodoInvalido && (
          <p role="alert" className="text-sm text-destructive">
            A data inicial deve ser anterior ou igual à data final de cada período.
          </p>
        )}
        {clientes.isError && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os clientes. Atualize a página para conferir os nomes e o
            filtro.
          </p>
        )}
        {canFinance && tarifas.isError && (
          <p role="alert" className="text-sm text-destructive">
            {tarifas.error.message}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Boletos registrados (em aberto)</p>
            <p className="mt-2 text-2xl font-semibold">{brl(emAberto)}</p>
          </article>
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Boletos liquidados</p>
            <p className="mt-2 text-2xl font-semibold">{brl(liquidado)}</p>
          </article>
        </div>

        <section className="print-area space-y-2">
          <h2 className="text-sm font-semibold">Boletos emitidos · {boletosFiltrados.length}</h2>
          <p className="text-xs text-muted-foreground">
            Valores e totais consideram os filtros selecionados. Tarifas identificadas pelo banco
            chegam pela consulta automática de movimentações financeiras. Configure conta e
            categoria por loja em Liquidação e tarifa para contabilizar as despesas. Débitos sem
            identificação de tarifa ficam para conferência; a ausência de informação não significa
            tarifa zero.
          </p>
          {canFinance && (tarifasApi.isError || statusTarifas.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {tarifasApi.error?.message ?? statusTarifas.error?.message}
            </p>
          )}
          {financeiroTarifas.error && (
            <p role="alert" className="text-sm text-destructive">
              {financeiroTarifas.error.message}
            </p>
          )}
          {statusTarifas.data && (
            <p className="text-xs text-muted-foreground">
              Tarifas API ·{" "}
              {statusTarifas.data.ultima_consulta
                ? `Última consulta: ${new Date(statusTarifas.data.ultima_consulta).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : "Aguardando primeira consulta agendada"}{" "}
              · {statusTarifas.data.dias_pendentes} dia(s) aguardando consulta
              {statusTarifas.data.dias_com_erro > 0
                ? ` · ${statusTarifas.data.dias_com_erro} dia(s) com falha; nova tentativa automática`
                : ""}
            </p>
          )}
          <div className="rounded-lg border border-border bg-card">
            {boletos.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : boletos.isError ? (
              <div className="p-6 text-sm text-destructive">{(boletos.error as Error).message}</div>
            ) : boletosFiltrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum boleto encontrado para os filtros selecionados.
              </p>
            ) : (
              <Table className="mobile-cards">
                <TableHeader>
                  <TableRow>
                    <TableHead>Boleto / parcela</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Datas</TableHead>
                    <TableHead className="text-right">Valores</TableHead>
                    <TableHead className="text-right">Tarifas do boleto</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boletosFiltrados.map((b) => {
                    const st = String(b["status"]);
                    const id = String(b["id"]);
                    const tarifa = tarifas.data?.get(id);
                    const tarifaApi = tarifasApi.data?.get(id);
                    const financeiro = financeiroTarifas.data?.get(id);
                    const tarifaStatus = (
                      tarifa?.["movimentos_financeiros"] as { status?: string } | null
                    )?.status;
                    return (
                      <Fragment key={id}>
                        <TableRow>
                          <TableCell
                            data-label="Boleto / parcela"
                            className="whitespace-nowrap font-medium"
                          >
                            <ReferenciaRegistro tipo="receber" id={b["conta_receber_id"]}>
                              {String(b["nosso_numero"] ?? "—")}
                            </ReferenciaRegistro>
                            <span className="block text-xs font-normal text-muted-foreground">
                              <ReferenciaRegistro tipo="pedido" id={b["pedido_id"]}>
                                {String(b["documento"] ?? "—")}
                              </ReferenciaRegistro>
                              /{String(b["parcela"] ?? 1)}
                            </span>
                          </TableCell>
                          <TableCell data-label="Cliente" className="min-w-40 max-w-64 break-words">
                            <ReferenciaRegistro tipo="cliente" id={b["cliente_id"]}>
                              {cliName(b["cliente_id"])}
                            </ReferenciaRegistro>
                          </TableCell>
                          <TableCell data-label="Datas" className="whitespace-nowrap text-xs">
                            <p>
                              <span className="text-muted-foreground">Emissão:</span>{" "}
                              {dataBr(b["data_emissao"])}
                            </p>
                            <p>
                              <span className="text-muted-foreground">Vencimento:</span>{" "}
                              {dataBr(b["vencimento"])}
                            </p>
                            <p>
                              <span className="text-muted-foreground">Liquidação:</span>{" "}
                              {dataBr(b["data_liquidacao"])}
                            </p>
                          </TableCell>
                          <TableCell
                            data-label="Valores"
                            className="whitespace-nowrap text-right tabular-nums"
                          >
                            <p>{brl(b["valor"])}</p>
                            {st === "liquidado" && (
                              <p className="text-xs text-muted-foreground">
                                Recebido {brl(b["valor_liquidado"])}
                              </p>
                            )}
                          </TableCell>
                          <TableCell data-label="Tarifas do boleto" className="text-right text-xs">
                            {!canFinance ? (
                              "Acesso financeiro necessário"
                            ) : tarifaApi && tarifaApi.valor > 0 ? (
                              <>
                                <strong className="whitespace-nowrap">
                                  {brl(tarifaApi.valor)}
                                </strong>
                                <span className="block text-muted-foreground">API Sicredi</span>
                                {financeiro && (
                                  <span className="block text-muted-foreground">
                                    {financeiro.every(
                                      (f) =>
                                        ["lancado", "vinculado_manual"].includes(
                                          String(f["estado"]),
                                        ) && (f["movimento"] as Row | null)?.["status"] === "ativo",
                                    )
                                      ? "Contabilizada no financeiro"
                                      : "Conferir contabilização"}
                                  </span>
                                )}
                                {tarifa && (
                                  <span className="block text-muted-foreground">
                                    Despesa{" "}
                                    {tarifaStatus === "estornado" ? "estornada" : "registrada"}:{" "}
                                    {brl(tarifa["valor"])}
                                  </span>
                                )}
                                {tarifaApi.outros > 0 && (
                                  <span className="block text-muted-foreground">
                                    Há outros débitos a conferir
                                  </span>
                                )}
                              </>
                            ) : tarifas.isPending || tarifasApi.isPending ? (
                              "Conferindo…"
                            ) : tarifas.isError || tarifasApi.isError ? (
                              "Indisponível"
                            ) : tarifa ? (
                              <>
                                <strong className="whitespace-nowrap">
                                  {brl(tarifa["valor"])}
                                </strong>
                                <span className="block text-muted-foreground">
                                  {tarifaStatus === "estornado"
                                    ? "Estornada"
                                    : tarifaStatus === "ativo"
                                      ? "Conferida no extrato"
                                      : "Conferir movimento"}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                {tarifaApi?.outros
                                  ? "Débito a conferir"
                                  : financeiro?.some((f) => !!f["movimento_id"])
                                    ? "Há despesa vinculada: conferir retorno"
                                    : "Sem tarifa confirmada"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell data-label="Situação">
                            {!!b["pagamento_apos_ajuste_285"] && (
                              <p
                                role="alert"
                                className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive"
                              >
                                Pagamento recebido após o ajuste do pedido. Confira a conciliação
                                financeira; o título cancelado não foi reaberto automaticamente.
                              </p>
                            )}
                            {(b["ajuste_pedido_motivo_285"] ||
                              (b["pedidos"] as Row | null)?.["status"] === "cancelado") && (
                              <p className="mb-2 rounded-md bg-amber-50 p-2 text-xs text-amber-950">
                                {b["ajuste_pedido_tipo_285"] === "cancelamento_pedido" ||
                                (b["pedidos"] as Row | null)?.["status"] === "cancelado"
                                  ? "Pedido cancelado."
                                  : "Pedido com devolução e título ajustado."}{" "}
                                {String(
                                  b["ajuste_pedido_motivo_285"] ?? "Confira o histórico do pedido.",
                                )}{" "}
                                {st === "registrado"
                                  ? "Administrador: solicitar baixa com motivo e aguardar confirmação bancária."
                                  : "Confira a situação bancária abaixo."}
                              </p>
                            )}
                            <span className="inline-block rounded-full bg-muted px-2 py-1 text-xs font-medium">
                              {cancelamentoBoletoPendente(b)
                                ? "Cancelamento solicitado"
                                : (statusLabel[st] ?? st)}
                            </span>
                            {["erro", "em_processamento"].includes(st) && b["erro"] ? (
                              <span className="block text-xs text-destructive">
                                {String(b["erro"]).slice(0, 90)}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell data-label="Ações" className="no-print text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <ReimprimirBoleto boleto={b} />
                              <Button
                                size="sm"
                                variant="outline"
                                aria-expanded={expandido === id}
                                aria-controls={`boleto-opcoes-${id}`}
                                onClick={() => setExpandido(expandido === id ? null : id)}
                              >
                                {expandido === id ? "Fechar" : "Opções"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandido === id && (
                          <TableRow className="no-print bg-muted/20" id={`boleto-opcoes-${id}`}>
                            <TableCell colSpan={7}>
                              <p className="mb-3 break-all text-xs">
                                <span className="font-medium">Linha digitável:</span>{" "}
                                {String(b["linha_digitavel"] ?? "Não disponível")}
                              </p>
                              {tarifaApi && (
                                <div className="mb-3 space-y-1 text-xs">
                                  <p className="font-medium">
                                    Débitos retornados pela API Sicredi (confira a contabilização em
                                    Tarifas e financeiro)
                                  </p>
                                  {tarifaApi.itens.map((item, i) => (
                                    <p key={`${item.dia}-${i}`}>
                                      {dataBr(item.dia)} · {item.descricao} · {brl(item.valor)}
                                    </p>
                                  ))}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                {(st === "liquidado" || !!tarifaApi || !!financeiro) &&
                                  b["banco"] === "sicredi" &&
                                  b["canal"] === "api" &&
                                  canFinance && (
                                    <LiquidacaoSicredi key={String(b["id"])} boleto={b} />
                                  )}
                                <AlterarVencimentoBoleto boleto={b} />
                                {b["pedido_id"] ? (
                                  <EmitirBoletosPedido
                                    pedidoId={String(b["pedido_id"])}
                                    centroId={String(b["centro_id"] ?? "")}
                                    compact
                                  />
                                ) : b["conta_receber_id"] ? (
                                  <EmitirBoletoTitulo
                                    contaId={String(b["conta_receber_id"])}
                                    centroId={String(b["centro_id"] ?? "")}
                                  />
                                ) : null}
                                {b["linha_digitavel"] ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Copiar linha digitável"
                                    onClick={() => copiar(b["linha_digitavel"])}
                                  >
                                    <Copy className="size-4" />
                                  </Button>
                                ) : null}
                                {b["canal"] === "cnab240" ? (
                                  <div className="space-y-2">
                                    <span className="text-xs text-muted-foreground">
                                      CNAB 240 · acompanhe pelo retorno
                                    </span>
                                    {st === "registrado" && b["qrcode_pix"] && b["txid"] ? (
                                      <BoletoPix
                                        payload={String(b["qrcode_pix"])}
                                        txid={String(b["txid"])}
                                      />
                                    ) : null}
                                  </div>
                                ) : b["nosso_numero"] || b["linha_digitavel"] ? (
                                  <>
                                    <ConfirmarNossoNumero boleto={b} />
                                    {!b["nosso_numero"] && (
                                      <span className="block text-xs text-muted-foreground">
                                        Registro recuperado. Confirme o nosso número com o Sicredi
                                        para consultar ou alterar.
                                      </span>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Consultar situação no Sicredi"
                                      disabled={consultar.isPending || !b["nosso_numero"]}
                                      onClick={() => consultar.mutate(b)}
                                    >
                                      <RefreshCw className="size-4" />
                                    </Button>
                                  </>
                                ) : null}
                                <div className="ml-auto border-l pl-4">
                                  {canFinance &&
                                    b["banco"] === "sicredi" &&
                                    b["canal"] === "api" &&
                                    st === "registrado" &&
                                    roles.includes("admin") && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive"
                                        disabled={
                                          !b["nosso_numero"] ||
                                          baixar.isPending ||
                                          cancelamentoBoletoPendente(b)
                                        }
                                        onClick={() => {
                                          setMotivoBaixa(
                                            String(b["ajuste_pedido_motivo_285"] ?? ""),
                                          );
                                          setCancelarBoleto(b);
                                        }}
                                      >
                                        Cancelar boleto
                                      </Button>
                                    )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
    </ErpLayout>
  );
}
