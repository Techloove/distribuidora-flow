import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Barcode, Copy, Loader2, Printer, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { filtrarCentro, useCentro } from "@/lib/centro-store";
import {
  sicrediBaixarBoleto,
  sicrediConsultarBoleto,
  sicrediEmitirBoleto,
  sicrediPdfBoleto,
  sicrediStatus,
} from "@/lib/sicredi.functions";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/faturamento")({
  head: () => ({
    meta: [
      { title: "Faturamento e boletos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Emissão e controle de boletos bancários integrados à API de cobrança do Sicredi, com registro, consulta, baixa e liquidação das parcelas.",
      },
      { property: "og:title", content: "Faturamento e boletos — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Registre boletos no Sicredi a partir das parcelas em aberto e acompanhe a liquidação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaturamentoPage,
});

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
  const s = String(v ?? "");
  if (!s || s === "null") return "—";
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("pt-BR");
}

function FaturamentoPage() {
  const { client, roles } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const [selecao, setSelecao] = useState<Record<string, boolean>>({});
  const [processando, setProcessando] = useState<string | null>(null);

  const emitirFn = useServerFn(sicrediEmitirBoleto);
  const consultarFn = useServerFn(sicrediConsultarBoleto);
  const baixarFn = useServerFn(sicrediBaixarBoleto);
  const pdfFn = useServerFn(sicrediPdfBoleto);

  const config = useQuery({
    queryKey: ["sicredi", "status"],
    queryFn: () => sicrediStatus(),
  });

  const pendentes = useQuery({
    queryKey: ["vw_boletos_pendentes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_boletos_pendentes")
        .select("*")
        .order("vencimento");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const boletos = useQuery({
    queryKey: ["boletos", "lista"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("boletos")
        .select("*")
        .order("vencimento", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const clientes = useQuery({
    queryKey: ["clientes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("clientes")
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const cliName = (id: unknown) =>
    String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] });
    queryClient.invalidateQueries({ queryKey: ["boletos"] });
    queryClient.invalidateQueries({ queryKey: ["contas_receber"] });
  };

  const pendentesFiltrados = useMemo(() => {
    let list = filtrarCentro(pendentes.data ?? [], centro);
    const f = filtros;
    if (f["de"]) list = list.filter((r) => String(r["vencimento"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((r) => String(r["vencimento"] ?? "") <= f["ate"]!);
    if (f["min"]) list = list.filter((r) => Number(r["saldo"] ?? 0) >= Number(f["min"]));
    if (f["max"]) list = list.filter((r) => Number(r["saldo"] ?? 0) <= Number(f["max"]));
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (r) =>
          String(r["razao_social"] ?? "").toLowerCase().includes(termo) ||
          String(r["documento"] ?? "").toLowerCase().includes(termo) ||
          String(r["pedido_numero"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [pendentes.data, centro, filtros]);

  const boletosFiltrados = useMemo(() => {
    let list = filtrarCentro(boletos.data ?? [], centro);
    const f = filtros;
    if (f["status"]) list = list.filter((b) => String(b["status"]) === f["status"]);
    if (f["de"]) list = list.filter((b) => String(b["vencimento"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((b) => String(b["vencimento"] ?? "") <= f["ate"]!);
    if (f["min"]) list = list.filter((b) => Number(b["valor"] ?? 0) >= Number(f["min"]));
    if (f["max"]) list = list.filter((b) => Number(b["valor"] ?? 0) <= Number(f["max"]));
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter(
        (b) =>
          cliName(b["cliente_id"]).toLowerCase().includes(termo) ||
          String(b["nosso_numero"] ?? "").toLowerCase().includes(termo) ||
          String(b["seu_numero"] ?? "").toLowerCase().includes(termo) ||
          String(b["linha_digitavel"] ?? "").toLowerCase().includes(termo),
      );
    }
    return list;
  }, [boletos.data, centro, filtros, clientes.data]);

  /** Registra a parcela como boleto no Sicredi e grava o retorno. */
  const emitirUm = async (row: Row) => {
    const contaId = String(row["conta_receber_id"]);
    try {
      await emitirFn({ data: { contaId } });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, msg: (e as Error).message };
    }
  };

  const emitir = useMutation({
    mutationFn: async (rows: Row[]) => {
      let ok = 0;
      const erros: string[] = [];
      for (const r of rows) {
        setProcessando(String(r["conta_receber_id"]));
        const res = await emitirUm(r);
        if (res.ok) ok += 1;
        else erros.push(res.msg);
      }
      setProcessando(null);
      return { ok, erros };
    },
    onSuccess: ({ ok, erros }) => {
      if (ok > 0) toast.success(`${ok} boleto(s) registrado(s) no Sicredi`);
      if (erros.length > 0) toast.error(erros[0]!);
      setSelecao({});
      invalidate();
    },
    onError: (e: Error) => {
      setProcessando(null);
      toast.error(e.message);
    },
  });

  const consultar = useMutation({
    mutationFn: async (b: Row) => {
      const res = await consultarFn({ data: { boletoId: String(b["id"]) } });
      if (res.liquidado) {
        const { error } = await client!.rpc("liquidar_boleto", {
          _boleto_id: String(b["id"]),
          _valor: Number(b["valor"] ?? 0),
          _data: new Date().toISOString().slice(0, 10),
        });
        if (error) throw new Error(error.message);
        return "liquidado";
      }
      return res.situacao || (res.baixado ? "baixado" : "registrado");
    },
    onSuccess: (s) => {
      toast.success(`Situação no Sicredi: ${s}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: async (b: Row) => {
      await baixarFn({ data: { boletoId: String(b["id"]) } });
    },
    onSuccess: () => {
      toast.success("Boleto baixado no Sicredi");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const abrirPdf = useMutation({
    mutationFn: async (b: Row) => {
      const res = await pdfFn({ data: { boletoId: String(b["id"]) } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selecionados = pendentesFiltrados.filter((r) => selecao[String(r["conta_receber_id"])]);
  const totalSelecionado = selecionados.reduce((s, r) => s + Number(r["saldo"] ?? 0), 0);
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
      title="Faturamento (boletos Sicredi)"
      description="As parcelas em aberto são registradas como boletos na API de cobrança do Sicredi. Este sistema não emite nota fiscal."
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
          <Button
            disabled={!canFinance || selecionados.length === 0 || emitir.isPending}
            onClick={() => emitir.mutate(selecionados)}
          >
            {emitir.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Barcode className="size-4" />
            )}
            Emitir {selecionados.length > 0 ? `${selecionados.length} boleto(s)` : "boletos"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {config.data && !config.data.configurado ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Integração Sicredi não configurada</p>
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

        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Selecionado para emissão</p>
            <p className="mt-2 text-2xl font-semibold">{brl(totalSelecionado)}</p>
          </article>
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
          <h2 className="text-sm font-semibold">
            Parcelas aguardando boleto · {pendentesFiltrados.length}
          </h2>
          <div className="rounded-lg border border-border bg-card">
            {pendentes.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : pendentes.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(pendentes.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase16_boletos_sicredi.sql</code> no banco.
                </p>
              </div>
            ) : pendentesFiltrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma parcela em aberto sem boleto.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="no-print w-10">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={
                          selecionados.length > 0 &&
                          selecionados.length === pendentesFiltrados.length
                        }
                        onChange={(e) =>
                          setSelecao(
                            e.target.checked
                              ? Object.fromEntries(
                                  pendentesFiltrados.map((r) => [
                                    String(r["conta_receber_id"]),
                                    true,
                                  ]),
                                )
                              : {},
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendentesFiltrados.map((r) => {
                    const id = String(r["conta_receber_id"]);
                    return (
                      <TableRow key={id}>
                        <TableCell className="no-print">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${id}`}
                            checked={!!selecao[id]}
                            onChange={(e) =>
                              setSelecao((s) => ({ ...s, [id]: e.target.checked }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {String(r["pedido_numero"] ?? r["documento"] ?? "—")}/
                          {String(r["parcela"] ?? 1)}
                        </TableCell>
                        <TableCell>{String(r["razao_social"] ?? "—")}</TableCell>
                        <TableCell>{dataBr(r["vencimento"])}</TableCell>
                        <TableCell className="text-right">{brl(r["saldo"])}</TableCell>
                        <TableCell className="no-print text-right">
                          <Button
                            size="sm"
                            disabled={!canFinance || emitir.isPending}
                            onClick={() => emitir.mutate([r])}
                          >
                            {processando === id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : null}
                            Emitir boleto
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        <section className="print-area space-y-2">
          <h2 className="text-sm font-semibold">
            Boletos emitidos · {boletosFiltrados.length}
          </h2>
          <div className="rounded-lg border border-border bg-card">
            {boletos.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : boletos.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(boletos.error as Error).message}
              </div>
            ) : boletosFiltrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum boleto emitido ainda.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nosso número</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Linha digitável</TableHead>
                    <TableHead className="no-print text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boletosFiltrados.map((b) => {
                    const st = String(b["status"]);
                    return (
                      <TableRow key={String(b["id"])}>
                        <TableCell>{String(b["nosso_numero"] ?? "—")}</TableCell>
                        <TableCell>{cliName(b["cliente_id"])}</TableCell>
                        <TableCell>
                          {String(b["documento"] ?? "—")}/{String(b["parcela"] ?? 1)}
                        </TableCell>
                        <TableCell>{dataBr(b["vencimento"])}</TableCell>
                        <TableCell className="text-right">{brl(b["valor"])}</TableCell>
                        <TableCell className={st === "erro" ? "text-destructive" : ""}>
                          {statusLabel[st] ?? st}
                          {st === "erro" && b["erro"] ? (
                            <span className="block text-xs text-muted-foreground">
                              {String(b["erro"]).slice(0, 90)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-52 truncate text-xs">
                          {String(b["linha_digitavel"] ?? "—")}
                        </TableCell>
                        <TableCell className="no-print space-x-1 text-right">
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
                          {b["nosso_numero"] ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Consultar situação no Sicredi"
                                disabled={consultar.isPending}
                                onClick={() => consultar.mutate(b)}
                              >
                                <RefreshCw className="size-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={abrirPdf.isPending}
                                onClick={() => abrirPdf.mutate(b)}
                              >
                                PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !canFinance ||
                                  baixar.isPending ||
                                  !["registrado", "pendente"].includes(st)
                                }
                                onClick={() => baixar.mutate(b)}
                              >
                                Baixar
                              </Button>
                            </>
                          ) : null}
                        </TableCell>
                      </TableRow>
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
