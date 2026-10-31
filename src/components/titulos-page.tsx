import { recalcularBaixa } from "@/lib/baixa-titulo";
import { NovoTituloDialog } from "@/components/novo-titulo-dialog";
import { setCentro } from "@/lib/centro-store";
import { getModalidade, nomesModalidade, setModalidade } from "@/lib/modalidade-store";
import { CondicoesBoletoSicredi } from "@/components/condicoes-boleto-sicredi";
import { lerPaginas } from "@/lib/paginacao";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataBr } from "@/lib/formatacao";
import { ContextoReferencia } from "@/components/contexto-referencia";
import { ReferenciaRegistro } from "@/components/referencia-registro";
import { correspondeReferencia, type BuscaReferencias } from "@/lib/referencias-registros";
import { AcoesFinanceirasTitulo } from "@/components/financeiro-novas-rotinas";
import { StatusBadge } from "@/components/status-badge";
import { HistoricoTitulo } from "@/components/historico-titulo";
import { EmitirBoletoTitulo } from "@/components/emitir-boletos-pedido";
import { AlterarVencimentoBoleto } from "@/components/alterar-vencimento-boleto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useCentroValido } from "@/lib/centros-acesso";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";

import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import {
  saldoTitulo,
  selecaoVisivel,
  tituloNoStatus,
  totaisTitulos,
} from "@/lib/integridade-consultas";

type Row = Record<string, unknown>;

export type TitulosConfig = {
  table: "contas_receber" | "contas_pagar";
  /** View com saldo e status efetivo (vencido/parcial) calculados no banco. */
  view: "vw_titulos_receber" | "vw_titulos_pagar";
  /** RPC completa de baixa (conta, forma de pagamento, juros, multa, desconto). */
  rpcBaixa: "receber_titulo" | "pagar_titulo";
  partnerTable: "clientes" | "fornecedores";
  partnerKey: "cliente_id" | "fornecedor_id";
  partnerLabel: string;
  rpc: "baixar_receber" | "baixar_pagar";
  baixaLabel: string;
  /** RPC de lançamento manual do título (com parcelamento). */
  rpcCriar: "criar_receita" | "criar_despesa";
};

const hoje = hojeSaoPaulo;

const statuses = ["todos", "aberto", "vencido", "parcial", "pago", "cancelado"] as const;

export function TitulosPage({
  config,
  referencia,
}: {
  config: TitulosConfig;
  referencia?: BuscaReferencias;
}) {
  const { client, roles, session } = useSupabase();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>(
    referencia && Object.values(referencia).some(Boolean) ? "todos" : "aberto",
  );
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const {
    centro: centroGlobal,
    lista: lojasPermitidas,
    isLoading: lojasCarregando,
    error: lojasErro,
  } = useCentroValido();

  const [target, setTarget] = useState<Row | null>(null);
  const [valor, setValor] = useState("");
  const [valorManual, setValorManual] = useState(false);
  const [data, setData] = useState(hojeSaoPaulo());
  const [contaId, setContaId] = useState("");
  const [formaId, setFormaId] = useState("");
  const [juros, setJuros] = useState("");
  const [multa, setMulta] = useState("");
  const [descontoBaixa, setDescontoBaixa] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [openNovo, setOpenNovo] = useState(false);
  const [openBaixaLote, setOpenBaixaLote] = useState(false);

  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");

  const titulos = useQuery({
    queryKey: [...[config.view, "lista", session?.user.id, centroGlobal], getModalidade()],
    enabled: !!client && !!session && !lojasCarregando && !lojasErro,
    queryFn: () =>
      lerPaginas<Row>((inicio, fim) => {
        let q = client!.from(config.view).select("*");
        if (centroGlobal) q = q.eq("centro_id", centroGlobal);
        return q.order("vencimento").order("id").range(inicio, fim);
      }),
  });

  const partners = useQuery({
    queryKey: [...[config.partnerTable, "options"], getModalidade()],
    enabled: !!client,
    queryFn: () =>
      lerPaginas<Row>((inicio, fim) =>
        client!
          .from(config.partnerTable)
          .select("id, razao_social")
          .order("razao_social")
          .order("id")
          .range(inicio, fim),
      ),
  });

  const isReceber = config.table === "contas_receber";

  const contas = useQuery({
    queryKey: [...["contas_financeiras", "titulos"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from("contas_financeiras")
        .select("id, nome, centro_id")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (rows ?? []) as Row[];
    },
  });

  const formas = useQuery({
    queryKey: [...["formas_pagamento", "titulos"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from("formas_pagamento")
        .select("id, nome")
        .order("nome");
      if (error) return [] as Row[];
      return (rows ?? []) as Row[];
    },
  });

  const centros = useQuery({
    queryKey: [...["centros", "titulos"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) return [] as Row[];
      return (rows ?? []) as Row[];
    },
  });

  const boletos = useQuery({
    queryKey: [...["boletos", "por-conta"], getModalidade()],
    enabled: !!client && isReceber,
    queryFn: async () => {
      return lerPaginas<Row>((inicio, fim) =>
        client!.from("boletos").select("*").order("created_at").order("id").range(inicio, fim),
      );
    },
  });

  const boletoPorConta = useMemo(() => {
    const map = new Map<string, Row>();
    for (const b of boletos.data ?? []) {
      const key = String(b["conta_receber_id"] ?? "");
      if (!key) continue;
      const previous = map.get(key);
      const active = ["pendente", "em_processamento", "registrado", "liquidado"];
      if (
        previous &&
        active.includes(String(previous["status"])) &&
        !active.includes(String(b["status"]))
      )
        continue;
      map.set(key, b);
    }
    return map;
  }, [boletos.data]);

  const boletoLabel = (r: Row) => {
    if (!isReceber) return "—";
    const b = boletoPorConta.get(String(r["id"]));
    if (boletos.isError) return "Consulta indisponível";
    if (boletos.isLoading) return "Carregando…";
    if (!b) return "Sem boleto";
    return String(b["status"] ?? "—");
  };

  const rows = useMemo(() => {
    let list = (titulos.data ?? []).filter(
      (r) => !referencia || correspondeReferencia(r, referencia),
    );
    if (status !== "todos") list = list.filter((r) => tituloNoStatus(r, status));
    if (centroGlobal) list = list.filter((r) => r["centro_id"] === centroGlobal);
    if (filtros["conta"]) list = list.filter((r) => r["conta_financeira_id"] === filtros["conta"]);
    if (filtros["forma"]) list = list.filter((r) => r["forma_pagamento_id"] === filtros["forma"]);
    if (filtros["pgde"])
      list = list.filter((r) => String(r["data_pagamento"] ?? "") >= filtros["pgde"]!);
    if (filtros["pgate"])
      list = list.filter(
        (r) => !!r["data_pagamento"] && String(r["data_pagamento"]) <= filtros["pgate"]!,
      );
    const f = filtros;
    if (isReceber && f["boleto"]) {
      if (boletos.isError || boletos.isLoading) return [];
      list = list.filter((r) => {
        const b = boletoPorConta.get(String(r["id"]));
        if (f["boleto"] === "sem") return !b;
        if (f["boleto"] === "com") return !!b;
        return !!b && String(b["status"]) === f["boleto"];
      });
    }
    const hoje = hojeSaoPaulo();
    if (f["parceiro"])
      list = list.filter((r) => String(r[config.partnerKey] ?? "") === f["parceiro"]);
    if (f["de"]) list = list.filter((r) => String(r["vencimento"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((r) => String(r["vencimento"] ?? "") <= f["ate"]!);
    if (f["situacao"] === "vencidos")
      list = list.filter(
        (r) =>
          String(r["vencimento"] ?? "") < hoje &&
          r["status"] !== "pago" &&
          r["status"] !== "cancelado",
      );
    if (f["situacao"] === "avencer")
      list = list.filter(
        (r) =>
          String(r["vencimento"] ?? "") >= hoje &&
          r["status"] !== "pago" &&
          r["status"] !== "cancelado",
      );
    if (f["min"]) list = list.filter((r) => saldoTitulo(r) >= Number(f["min"]));
    if (f["max"]) list = list.filter((r) => saldoTitulo(r) <= Number(f["max"]));
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((r) => {
        const nome = String(
          partners.data?.find((p) => p["id"] === r[config.partnerKey])?.["razao_social"] ?? "",
        ).toLowerCase();
        return (
          String(r["documento"] ?? "")
            .toLowerCase()
            .includes(termo) || nome.includes(termo)
        );
      });
    }
    return list;
  }, [
    referencia,
    titulos.data,
    status,
    filtros,
    partners.data,
    config.partnerKey,
    isReceber,
    boletoPorConta,
    boletos.isError,
    boletos.isLoading,
    centroGlobal,
  ]);

  const totalFiltrado = rows.reduce(
    (s, r) => s + (r["venda_aprovada"] === false ? 0 : saldoTitulo(r)),
    0,
  );

  const totals = useMemo(
    () =>
      totaisTitulos(
        (titulos.data ?? []).filter((r) => !referencia || correspondeReferencia(r, referencia)),
        centroGlobal,
        hojeSaoPaulo(),
      ),
    [titulos.data, referencia, centroGlobal],
  );
  const idsVisiveis = useMemo(() => selecaoVisivel(selecionados, rows), [selecionados, rows]);
  useEffect(() => {
    if (idsVisiveis.length !== selecionados.length) setSelecionados(idsVisiveis);
  }, [idsVisiveis, selecionados.length]);

  const contasParaLoja = (lojas: string[]) =>
    (contas.data ?? []).filter(
      (c) => !c["centro_id"] || lojas.every((loja) => loja === String(c["centro_id"])),
    );
  const contasBaixa = contasParaLoja([String(target?.["centro_id"] ?? "")]);
  const contasBaixaLote = contasParaLoja([
    ...new Set(
      rows
        .filter((r) => idsVisiveis.includes(String(r["id"])))
        .map((r) => String(r["centro_id"] ?? "")),
    ),
  ]);
  const previaBaixa = target
    ? recalcularBaixa(
        Number(target["saldo"] ?? 0),
        Number(juros || 0),
        Number(multa || 0),
        Number(descontoBaixa || 0),
      )
    : null;
  const valorEfetivo = valorManual
    ? Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100
    : (previaBaixa?.total ?? 0);
  const valorBaixaValido =
    !!previaBaixa &&
    Number.isFinite(valorEfetivo) &&
    valorEfetivo > 0 &&
    Math.round(valorEfetivo * 100) <= Math.round(previaBaixa.total * 100);
  const baixar = useMutation({
    mutationFn: async () => {
      const v = valorEfetivo;
      if (!previaBaixa)
        throw new Error(
          "Confira os ajustes: use valores não negativos e desconto de até o saldo com juros e multa.",
        );
      if (!valorBaixaValido)
        throw new Error(
          "O valor da baixa deve ser maior que zero e não pode exceder o total atualizado.",
        );
      if (!contaId || !contasBaixa.some((c) => c["id"] === contaId))
        throw new Error("Selecione um banco/caixa compatível com a loja do título");
      const { error } = await client!.rpc(config.rpcBaixa, {
        _id: target!["id"],
        _valor: v,
        _data: data,
        _conta_id: contaId || null,
        _forma_id: formaId || null,
        _juros: previaBaixa.juros,
        _multa: previaBaixa.multa,
        _desconto: previaBaixa.desconto,
        _observacao: null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Baixa registrada");
      setTarget(null);
      setValor("");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixarLote = useMutation({
    mutationFn: async () => {
      if (idsVisiveis.length === 0) throw new Error("Selecione os títulos");
      if (!contaId || !contasBaixaLote.some((c) => c["id"] === contaId))
        throw new Error("Selecione um banco/caixa compatível com as lojas dos títulos");
      const { error } = await client!.rpc("baixar_titulos_lote", {
        _tabela: config.table,
        _ids: idsVisiveis,
        _data: data,
        _conta_id: contaId || null,
        _forma_id: formaId || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`${idsVisiveis.length} título(s) baixado(s)`);
      setSelecionados([]);
      setOpenBaixaLote(false);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");

  return (
    <div className="space-y-4">
      <div className="no-print grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="Em aberto" value={brl(totals.aberto)} />
        <Card label="Vencido" value={brl(totals.vencido)} tone />
        <Card label={isReceber ? "Recebido" : "Pago"} value={brl(totals.pago)} />
        <Card label={isReceber ? "Vence hoje" : "Vence hoje"} value={brl(totals.hoje)} />
        <Card label="A vencer (futuro)" value={brl(totals.futuros)} />
      </div>

      <ContextoReferencia busca={referencia} to={isReceber ? "/receber" : "/pagar"} />
      <FilterBar
        onClear={() => setFiltros({})}
        extra={
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!canFinance}
              onClick={() => {
                setOpenNovo(true);
              }}
            >
              <Plus className="size-3.5" />{" "}
              {isReceber ? "Nova conta a receber" : "Nova conta a pagar"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="size-3.5" /> Imprimir
            </Button>
            <Button
              size="sm"
              disabled={!canFinance || idsVisiveis.length === 0 || baixarLote.isPending}
              onClick={() => {
                setContaId("");
                setFormaId("");
                setData(hoje());
                setOpenBaixaLote(true);
              }}
            >
              {baixarLote.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Baixar {idsVisiveis.length} selecionado(s)
            </Button>
          </div>
        }
      >
        <FilterText
          label="Buscar"
          value={filtros["busca"] ?? ""}
          onChange={(v) => setF("busca", v)}
          placeholder={`Documento ou ${config.partnerLabel.toLowerCase()}`}
        />
        <FilterSelect
          label={config.partnerLabel}
          value={filtros["parceiro"] ?? ""}
          onChange={(v) => setF("parceiro", v)}
          options={(partners.data ?? []).map((p) => ({
            value: String(p["id"]),
            label: String(p["razao_social"]),
          }))}
        />
        <FilterSelect
          label="Situação"
          value={filtros["situacao"] ?? ""}
          onChange={(v) => setF("situacao", v)}
          options={[
            { value: "vencidos", label: "Vencidos" },
            { value: "avencer", label: "A vencer" },
          ]}
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
          label="Saldo mínimo"
          type="number"
          value={filtros["min"] ?? ""}
          onChange={(v) => setF("min", v)}
        />
        <FilterText
          label="Saldo máximo"
          type="number"
          value={filtros["max"] ?? ""}
          onChange={(v) => setF("max", v)}
        />

        <FilterSelect
          label="Banco/caixa"
          value={filtros["conta"] ?? ""}
          onChange={(v) => setF("conta", v)}
          options={(contas.data ?? []).map((c) => ({
            value: String(c["id"]),
            label: String(c["nome"]),
          }))}
        />
        <FilterSelect
          label="Forma de pagamento"
          value={filtros["forma"] ?? ""}
          onChange={(v) => setF("forma", v)}
          options={(formas.data ?? []).map((c) => ({
            value: String(c["id"]),
            label: String(c["nome"]),
          }))}
        />
        <FilterText
          label="Pagamento de"
          type="date"
          value={filtros["pgde"] ?? ""}
          onChange={(v) => setF("pgde", v)}
        />
        <FilterText
          label="Pagamento até"
          type="date"
          value={filtros["pgate"] ?? ""}
          onChange={(v) => setF("pgate", v)}
        />
        {isReceber ? (
          <FilterSelect
            label="Boleto"
            value={filtros["boleto"] ?? ""}
            onChange={(v) => setF("boleto", v)}
            options={[
              { value: "sem", label: "Sem boleto" },
              { value: "com", label: "Com boleto" },
              { value: "pendente", label: "Pendente" },
              { value: "em_processamento", label: "Em processamento" },
              { value: "registrado", label: "Registrado" },
              { value: "liquidado", label: "Liquidado" },
              { value: "baixado", label: "Baixado" },
              { value: "cancelado", label: "Cancelado" },
              { value: "erro", label: "Erro" },
            ]}
          />
        ) : null}
      </FilterBar>

      <div className="no-print flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s === "aberto" ? "Em aberto" : s}
          </Button>
        ))}
      </div>

      {(!referencia || !Object.values(referencia).some(Boolean)) && (
        <Button
          size="sm"
          variant="outline"
          className="no-print"
          onClick={() => {
            setStatus("todos");
            setFiltros({});
            setModalidade("todos");
          }}
        >
          Ver todos {centroGlobal ? "desta loja" : "os títulos"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {rows.length} de {(titulos.data ?? []).length} título(s) na loja/modalidade atual · saldo{" "}
        {brl(totalFiltrado)}
      </p>

      <div className="print-area rounded-lg border border-border bg-card">
        {titulos.isLoading || lojasCarregando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : titulos.isError || lojasErro ? (
          <div className="p-6 text-sm text-destructive">
            {(lojasErro || titulos.error)?.message}
            <p className="mt-2 text-xs text-muted-foreground">
              Tente atualizar a página. Se o problema continuar, solicite a conferência das
              permissões e da versão do banco ao administrador.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum título neste filtro.
          </p>
        ) : (
          <Table className="mobile-cards sm:min-w-[1100px] print:min-w-0 print:text-[10px]">
            <TableHeader>
              <TableRow>
                <TableHead className="no-print w-8" />
                <TableHead className="whitespace-nowrap">Documento</TableHead>
                <TableHead className="whitespace-nowrap">{config.partnerLabel}</TableHead>
                <TableHead className="whitespace-nowrap">Parc.</TableHead>
                <TableHead className="whitespace-nowrap">Emissão</TableHead>
                <TableHead className="whitespace-nowrap">Vencimento</TableHead>
                <TableHead className="whitespace-nowrap text-right">Valor</TableHead>
                <TableHead className="whitespace-nowrap text-right">Pago</TableHead>
                <TableHead className="whitespace-nowrap text-right">Saldo</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                {isReceber ? <TableHead className="whitespace-nowrap">Boleto</TableHead> : null}
                <TableHead className="no-print text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r["id"])}>
                  <TableCell data-label="Selecionar" className="no-print">
                    <input
                      type="checkbox"
                      aria-label="Selecionar título"
                      className="size-4"
                      disabled={
                        !canFinance || r["status"] === "pago" || r["status"] === "cancelado"
                      }
                      checked={selecionados.includes(String(r["id"]))}
                      onChange={(e) =>
                        setSelecionados((s) =>
                          e.target.checked
                            ? [...s, String(r["id"])]
                            : s.filter((id) => id !== String(r["id"])),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell data-label="Documento" className="whitespace-nowrap font-medium">
                    <ReferenciaRegistro tipo="pedido" id={r["pedido_id"]}>
                      {String(r["documento"] ?? "—")}
                    </ReferenciaRegistro>
                  </TableCell>
                  <TableCell
                    data-label="Cliente / fornecedor"
                    className="min-w-48 max-w-xs break-words"
                  >
                    <ReferenciaRegistro
                      tipo={isReceber ? "cliente" : "fornecedor"}
                      id={r[config.partnerKey]}
                    >
                      {partnerName(r[config.partnerKey])}
                    </ReferenciaRegistro>
                  </TableCell>
                  <TableCell data-label="Parcela" className="whitespace-nowrap">
                    {String(r["parcela"])}
                  </TableCell>
                  <TableCell data-label="Emissão" className="whitespace-nowrap tabular-nums">
                    {dataBr(r["data_emissao"])}
                  </TableCell>
                  <TableCell data-label="Vencimento" className="whitespace-nowrap tabular-nums">
                    {dataBr(r["vencimento"])}
                  </TableCell>
                  <TableCell
                    data-label="Valor"
                    className="whitespace-nowrap text-right tabular-nums sm:min-w-24 print:min-w-0"
                  >
                    {brl(r["valor"])}
                  </TableCell>
                  <TableCell
                    data-label="Pago"
                    className="whitespace-nowrap text-right tabular-nums sm:min-w-24 print:min-w-0"
                  >
                    {brl(r["valor_pago"])}
                  </TableCell>
                  <TableCell
                    data-label="Saldo"
                    className="whitespace-nowrap text-right tabular-nums sm:min-w-24 print:min-w-0"
                  >
                    {brl(r["saldo"])}
                  </TableCell>
                  <TableCell
                    data-label="Situação"
                    className="whitespace-nowrap [&_span]:whitespace-nowrap"
                  >
                    <StatusBadge value={r["status_efetivo"] ?? r["status"]} />
                  </TableCell>
                  {isReceber ? (
                    <TableCell data-label="Boleto" className="min-w-28 whitespace-nowrap">
                      <span
                        className={
                          boletoLabel(r) === "Sem boleto"
                            ? "text-muted-foreground"
                            : boletoLabel(r) === "erro"
                              ? "text-destructive"
                              : undefined
                        }
                      >
                        <ReferenciaRegistro
                          tipo="boleto"
                          id={boletoPorConta.get(String(r["id"]))?.["id"]}
                        >
                          {boletoLabel(r)}
                        </ReferenciaRegistro>
                      </span>
                      {boletoPorConta.get(String(r["id"]))?.["vencimento_solicitado"] ? (
                        <span className="block max-w-40 whitespace-normal text-xs text-muted-foreground">
                          Vencimento solicitado:{" "}
                          {dataBr(boletoPorConta.get(String(r["id"]))!["vencimento_solicitado"])} ·
                          aguardando Sicredi
                        </span>
                      ) : null}
                      {boletoPorConta.get(String(r["id"]))?.["nosso_numero"] ? (
                        <span className="block whitespace-nowrap text-xs text-muted-foreground">
                          {String(boletoPorConta.get(String(r["id"]))!["nosso_numero"])}
                        </span>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell data-label="Ações" className="no-print text-right">
                    <div className="ml-auto flex w-28 max-w-full flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={
                          !canFinance || r["status"] === "pago" || r["status"] === "cancelado"
                        }
                        onClick={() => {
                          setTarget(r);
                          setValorManual(false);
                          setContaId(String(r["conta_financeira_id"] ?? ""));
                          setFormaId(String(r["forma_pagamento_id"] ?? ""));
                          setData(hoje());
                          setValor(String(Number(r["saldo"] ?? 0)));
                          setJuros("");
                          setMulta("");
                          setDescontoBaixa("");
                        }}
                      >
                        {config.baixaLabel}
                      </Button>
                      {isReceber && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className="w-full">
                              Opções
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            forceMount
                            align="end"
                            aria-label="Opções do título"
                            className="no-print w-64 p-3 data-[state=closed]:hidden"
                          >
                            <div className="flex flex-col gap-2 [&_button]:h-auto [&_button]:min-h-9 [&_button]:w-full [&_button]:whitespace-normal">
                              {isReceber && <HistoricoTitulo titulo={r} />}
                              {isReceber && <AcoesFinanceirasTitulo titulo={r} />}
                              {isReceber && canFinance ? (
                                <EmitirBoletoTitulo
                                  contaId={String(r["id"])}
                                  statusBoleto={String(
                                    boletoPorConta.get(String(r["id"]))?.["status"] ?? "",
                                  )}
                                  consultando={boletos.isPending}
                                  falhaConsulta={boletos.isError}
                                  centroId={String(r["centro_id"] ?? "")}
                                />
                              ) : null}
                              {isReceber &&
                              canFinance &&
                              boletoPorConta.get(String(r["id"]))?.["status"] === "registrado" ? (
                                <>
                                  <AlterarVencimentoBoleto
                                    boleto={boletoPorConta.get(String(r["id"]))!}
                                  />
                                  <CondicoesBoletoSicredi
                                    boleto={boletoPorConta.get(String(r["id"]))!}
                                  />
                                </>
                              ) : null}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!canFinance ? (
        <p className="text-xs text-muted-foreground">
          Somente perfis <strong>financeiro</strong>, <strong>gestor</strong> ou{" "}
          <strong>admin</strong> podem baixar títulos.
        </p>
      ) : null}

      <Dialog
        open={!!target}
        onOpenChange={(o) => {
          if (!o && !baixar.isPending) setTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{config.baixaLabel} título</DialogTitle>
            <DialogDescription>
              Saldo atual {brl(target?.["saldo"])}. A baixa gera movimentação no banco/caixa
              escolhido e atualiza fluxo de caixa, DRE e relatórios.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={baixar.isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="baixa-valor">Valor a {isReceber ? "receber" : "pagar"} (R$)</Label>
              <Input
                type="number"
                step="0.01"
                id="baixa-valor"
                min="0.01"
                value={valorManual ? valor : (previaBaixa?.total.toFixed(2) ?? "")}
                onChange={(e) => {
                  setValor(e.target.value);
                  setValorManual(true);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baixa-banco">Banco/caixa *</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                id="baixa-banco"
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
              >
                <option value="">Selecione</option>
                {contasBaixa.map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={formaId}
                onChange={(e) => setFormaId(e.target.value)}
              >
                <option value="">Selecione</option>
                {(formas.data ?? []).map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baixa-juros">Juros (R$)</Label>
              <Input
                type="number"
                step="0.01"
                id="baixa-juros"
                min="0"
                value={juros}
                onChange={(e) => setJuros(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baixa-multa">Multa (R$)</Label>
              <Input
                type="number"
                step="0.01"
                id="baixa-multa"
                min="0"
                value={multa}
                onChange={(e) => setMulta(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baixa-desconto">Desconto (R$)</Label>
              <Input
                type="number"
                step="0.01"
                id="baixa-desconto"
                min="0"
                value={descontoBaixa}
                onChange={(e) => setDescontoBaixa(e.target.value)}
              />
            </div>
          </fieldset>
          <section
            aria-live="polite"
            aria-atomic="true"
            className="space-y-3 rounded-xl border bg-primary/5 p-4"
          >
            <dl className="space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>Saldo atual</dt>
                <dd className="whitespace-nowrap tabular-nums">{brl(target?.["saldo"] ?? 0)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Juros + multa desta baixa</dt>
                <dd className="whitespace-nowrap tabular-nums">
                  {previaBaixa ? brl(previaBaixa.juros + previaBaixa.multa) : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Desconto desta baixa</dt>
                <dd className="whitespace-nowrap tabular-nums">
                  {previaBaixa ? brl(previaBaixa.desconto) : "—"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm font-medium">
                Total atualizado a {isReceber ? "receber" : "pagar"}
              </span>
              <strong data-total-baixa className="text-xl tabular-nums text-primary">
                {previaBaixa ? brl(previaBaixa.total) : "—"}
              </strong>
            </div>
            {valorManual && previaBaixa && (
              <>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span>Saldo após esta baixa</span>
                  <span>
                    {valorBaixaValido
                      ? brl(Math.round((previaBaixa.total - valorEfetivo) * 100) / 100)
                      : "—"}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={baixar.isPending}
                  onClick={() => setValorManual(false)}
                >
                  Usar total atualizado
                </Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              {valorManual
                ? "O valor informado foi mantido para permitir baixa parcial."
                : "O valor da baixa acompanha automaticamente os ajustes acima."}
            </p>
          </section>
          {!previaBaixa && (
            <p role="alert" className="text-sm text-destructive">
              Use juros e multa não negativos. O desconto não pode superar o saldo acrescido desses
              valores.
            </p>
          )}
          {previaBaixa && !valorBaixaValido && (
            <p role="alert" className="text-sm text-destructive">
              O valor da baixa deve ser maior que zero e não pode superar o total atualizado.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={baixar.isPending} onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => baixar.mutate()}
              disabled={
                baixar.isPending ||
                !valorBaixaValido ||
                !contasBaixa.some((c) => c["id"] === contaId) ||
                !data
              }
            >
              {baixar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {openNovo && (
        <NovoTituloDialog
          receber={isReceber}
          lojaInicial={centroGlobal}
          lojas={lojasPermitidas}
          parceiros={(partners.data ?? []).map((p) => ({
            id: String(p["id"]),
            nome: String(p["razao_social"]),
          }))}
          parceirosCarregando={partners.isPending}
          parceirosErro={partners.error?.message}
          onClose={() => setOpenNovo(false)}
          onCreated={(loja, parcelas) => {
            setOpenNovo(false);
            void queryClient.invalidateQueries();
            toast.success(`${parcelas === 1 ? "Título lançado" : `${parcelas} títulos lançados`}`, {
              description:
                [
                  centroGlobal && centroGlobal !== loja
                    ? "O título foi lançado em outra loja; ajuste o filtro para visualizá-lo."
                    : "",
                  getModalidade() !== "todos"
                    ? `Lançamentos manuais aparecem em Todos. O filtro atual está em ${nomesModalidade[getModalidade()]}.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
              action: {
                label: "Ver lançamentos",
                onClick: () => {
                  setCentro(loja);
                  setModalidade("todos");
                },
              },
            });
          }}
        />
      )}
      <Dialog
        open={openBaixaLote}
        onOpenChange={(v) => {
          if (!baixarLote.isPending) setOpenBaixaLote(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Baixar títulos selecionados</DialogTitle>
            <DialogDescription>
              Confira os {idsVisiveis.length} títulos e escolha o banco/caixa para registrar a
              movimentação.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">Saldo selecionado</p>
            <p className="text-xl font-semibold">
              {brl(
                rows
                  .filter((r) => idsVisiveis.includes(String(r["id"])))
                  .reduce((total, r) => total + saldoTitulo(r), 0),
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="baixa-lote-data">Data da baixa</Label>
            <Input
              id="baixa-lote-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={baixarLote.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="baixa-lote-banco">Banco/caixa *</Label>
            <select
              id="baixa-lote-banco"
              className="h-11 w-full rounded-xl border bg-background px-3"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              disabled={baixarLote.isPending}
            >
              <option value="">Selecione</option>
              {contasBaixaLote.map((c) => (
                <option key={String(c["id"])} value={String(c["id"])}>
                  {String(c["nome"])}
                </option>
              ))}
            </select>
            {!contasBaixaLote.length && (
              <p role="alert" className="text-xs text-destructive">
                Não há banco/caixa disponível para todas as lojas selecionadas. Faça a baixa por
                loja ou cadastre uma conta compatível.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="baixa-lote-forma">Forma de pagamento</Label>
            <select
              id="baixa-lote-forma"
              className="h-11 w-full rounded-xl border bg-background px-3"
              value={formaId}
              onChange={(e) => setFormaId(e.target.value)}
              disabled={baixarLote.isPending}
            >
              <option value="">Selecione</option>
              {(formas.data ?? []).map((f) => (
                <option key={String(f["id"])} value={String(f["id"])}>
                  {String(f["nome"])}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={baixarLote.isPending}
              onClick={() => setOpenBaixaLote(false)}
            >
              Cancelar
            </Button>
            <Button
              disabled={baixarLote.isPending || !contaId || !idsVisiveis.length || !data}
              onClick={() => baixarLote.mutate()}
            >
              {baixarLote.isPending && <Loader2 className="size-4 animate-spin" />}Confirmar baixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight ${
          tone ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </article>
  );
}
