import { AlterarVencimentoBoleto } from "@/components/alterar-vencimento-boleto";
import { BoletoPix } from "@/components/boleto-pix";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Printer, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { SicrediCnabPanel } from "@/components/sicredi-cnab-panel";
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
  sicrediPdfBoleto,
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
  const s = String(v ?? "");
  if (!s || s === "null") return "—";
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("pt-BR");
}

export function BoletosPage() {
  const { client, roles, session } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const consultarFn = useServerFn(sicrediConsultarBoleto);
  const baixarFn = useServerFn(sicrediBaixarBoleto);
  const pdfFn = useServerFn(sicrediPdfBoleto);

  const config = useQuery({
    queryKey: ["sicredi", "status"],
    queryFn: () =>
      sicrediStatus({
        data: session?.access_token ? { accessToken: session.access_token } : {},
      }),
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

  const cliName = useCallback(
    (id: unknown) => String(clientes.data?.find((c) => c["id"] === id)?.["razao_social"] ?? "—"),
    [clientes.data],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] });
    queryClient.invalidateQueries({ queryKey: ["boletos"] });
    queryClient.invalidateQueries({ queryKey: ["contas_receber"] });
  };

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
          String(b["nosso_numero"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(b["seu_numero"] ?? "")
            .toLowerCase()
            .includes(termo) ||
          String(b["linha_digitavel"] ?? "")
            .toLowerCase()
            .includes(termo),
      );
    }
    return list;
  }, [boletos.data, centro, filtros, cliName]);

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
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Boleto baixado no Sicredi");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const abrirPdf = useMutation({
    mutationFn: async (b: Row) => {
      const res = await pdfFn({
        data: {
          boletoId: String(b["id"]),
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank");
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
      description="Cobrança Sicredi por API ou arquivos CNAB 240, com acompanhamento das parcelas."
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Emita boletos em{" "}
          <Link to="/pedidos" search={{ pedido: undefined }} className="font-medium underline">
            Pedidos
          </Link>{" "}
          ou em{" "}
          <Link to="/receber" className="font-medium underline">
            Contas a receber
          </Link>
          . As configurações do Sicredi ficam em Configurações do sistema.
        </p>
        <SicrediCnabPanel mode="operacao" />
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
          <div className="rounded-lg border border-border bg-card">
            {boletos.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : boletos.isError ? (
              <div className="p-6 text-sm text-destructive">{(boletos.error as Error).message}</div>
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
                          <AlterarVencimentoBoleto boleto={b} />
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
                          ) : b["nosso_numero"] ? (
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
