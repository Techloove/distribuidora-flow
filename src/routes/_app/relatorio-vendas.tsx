import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";

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
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/relatorio-vendas")({
  head: () => ({
    meta: [
      { title: "Relatório de vendas e comissões — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Vendas por período, mês, cliente, representante e centro de custo, com comissões apuradas e peso vendido.",
      },
      { property: "og:title", content: "Relatório de vendas e comissões — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Filtros por data, mês, cliente, representante e centro de custo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RelatorioVendasPage,
});

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
const kg = (v: unknown) =>
  `${num(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;

const hoje = new Date();
const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  .toISOString()
  .slice(0, 10);

function RelatorioVendasPage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const [filtros, setFiltros] = useState<Record<string, string>>({
    de: primeiroDiaMes,
    ate: hoje.toISOString().slice(0, 10),
  });
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const opcoes = useQuery({
    queryKey: ["relatorio-vendas", "opcoes"],
    enabled: !!client,
    queryFn: async () => {
      const [clientes, representantes, centros] = await Promise.all([
        client!.from("clientes").select("id, razao_social").order("razao_social").limit(2000),
        client!.from("representantes").select("id, nome").order("nome"),
        client!.from("centros").select("id, nome").order("nome"),
      ]);
      const erro = clientes.error ?? representantes.error ?? centros.error;
      if (erro) throw new Error(erro.message);
      return {
        clientes: (clientes.data ?? []) as Row[],
        representantes: (representantes.data ?? []) as Row[],
        centros: (centros.data ?? []) as Row[],
      };
    },
  });

  const centroFiltro = filtros["centro"] || centro || "";

  const vendas = useQuery({
    queryKey: ["vw_relatorio_vendas", filtros, centroFiltro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_relatorio_vendas").select("*");
      if (filtros["de"]) q = q.gte("data_pedido", filtros["de"]);
      if (filtros["ate"]) q = q.lte("data_pedido", filtros["ate"]);
      if (filtros["mes"]) q = q.eq("mes", filtros["mes"]);
      if (filtros["cliente"]) q = q.eq("cliente_id", filtros["cliente"]);
      if (filtros["representante"]) q = q.eq("representante_id", filtros["representante"]);
      if (centroFiltro) q = q.eq("centro_id", centroFiltro);
      if (filtros["status"]) q = q.eq("status", filtros["status"]);
      const { data, error } = await q.order("data_pedido", { ascending: false }).limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const linhas = useMemo(() => {
    let lista = vendas.data ?? [];
    if (!filtros["incluirCancelados"]) {
      lista = lista.filter(
        (r) => !["cancelado", "recusado", "rascunho", "digitacao"].includes(String(r["status"])),
      );
    }
    return lista;
  }, [vendas.data, filtros]);

  const totais = useMemo(() => {
    const soma = (k: string) => linhas.reduce((s, r) => s + num(r[k]), 0);
    return {
      pedidos: linhas.length,
      bruto: soma("total_itens"),
      descontos: soma("desconto_valor") + soma("forma_desconto_valor"),
      liquido: soma("total_liquido"),
      comissao: soma("comissao_apurada"),
      peso: soma("peso_kg"),
    };
  }, [linhas]);

  const porMes = useMemo(() => agrupar(linhas, "mes", "mes"), [linhas]);
  const porRepresentante = useMemo(
    () => agrupar(linhas, "representante_id", "representante"),
    [linhas],
  );
  const porCliente = useMemo(() => agrupar(linhas, "cliente_id", "cliente").slice(0, 20), [linhas]);

  const mesesDisponiveis = useMemo(() => {
    const set = new Set((vendas.data ?? []).map((r) => String(r["mes"] ?? "")).filter(Boolean));
    return [...set].sort().reverse();
  }, [vendas.data]);

  return (
    <ErpLayout
      title="Relatório de vendas"
      description="Vendas e comissões por período, mês, cliente, representante e centro de custo."
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir
        </Button>
      }
    >
      <div className="space-y-4">
        <FilterBar
          onClear={() => setFiltros({ de: primeiroDiaMes, ate: hoje.toISOString().slice(0, 10) })}
        >
          <FilterText
            label="De"
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label="Até"
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
          <FilterSelect
            label="Mês"
            value={filtros["mes"] ?? ""}
            onChange={(v) => setF("mes", v)}
            options={mesesDisponiveis.map((m) => ({ value: m, label: m }))}
          />
          <FilterSelect
            label="Cliente"
            value={filtros["cliente"] ?? ""}
            onChange={(v) => setF("cliente", v)}
            options={(opcoes.data?.clientes ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["razao_social"]),
            }))}
          />
          <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={(opcoes.data?.representantes ?? []).map((r) => ({
              value: String(r["id"]),
              label: String(r["nome"]),
            }))}
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={(opcoes.data?.centros ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["nome"]),
            }))}
          />
          <FilterSelect
            label="Situação do pedido"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={[
              { value: "confirmado", label: "Confirmado" },
              { value: "aprovado", label: "Aprovado" },
              { value: "separacao", label: "Separação" },
              { value: "conferido", label: "Conferido" },
              { value: "faturado", label: "Faturado" },
              { value: "nf_emitida", label: "NF emitida" },
              { value: "em_carga", label: "Em carga" },
              { value: "entregue", label: "Entregue" },
            ]}
          />
          <FilterSelect
            label="Cancelados/rascunhos"
            value={filtros["incluirCancelados"] ?? ""}
            onChange={(v) => setF("incluirCancelados", v)}
            options={[{ value: "1", label: "Incluir" }]}
          />
        </FilterBar>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Card label="Pedidos" value={String(totais.pedidos)} />
          <Card label="Valor bruto" value={brl(totais.bruto)} />
          <Card label="Descontos" value={brl(totais.descontos)} />
          <Card label="Vendas líquidas" value={brl(totais.liquido)} destaque />
          <Card label="Comissões" value={brl(totais.comissao)} />
          <Card label="Peso vendido" value={kg(totais.peso)} />
        </div>

        <div className="print-area space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Resumo title="Vendas por mês" rows={porMes} primeiraColuna="Mês" />
            <Resumo
              title="Vendas e comissões por representante"
              rows={porRepresentante}
              primeiraColuna="Representante"
            />
          </div>
          <Resumo title="Maiores clientes do período" rows={porCliente} primeiraColuna="Cliente" />

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">
              Pedidos do período
            </h2>
            {vendas.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </div>
            ) : vendas.isError ? (
              <div className="p-6 text-sm text-destructive">
                {(vendas.error as Error).message}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rode <code>db/fase45_comissoes_relatorio_vendas.sql</code> no banco.
                </p>
              </div>
            ) : linhas.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum pedido neste filtro.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Representante</TableHead>
                      <TableHead>Centro</TableHead>
                      <TableHead>Rota</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Peso</TableHead>
                      <TableHead className="text-right">Líquido</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">Comissão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((r) => (
                      <TableRow key={String(r["pedido_id"])}>
                        <TableCell className="font-medium">{String(r["numero"] ?? "—")}</TableCell>
                        <TableCell>{fmtDate(r["data_pedido"])}</TableCell>
                        <TableCell className="max-w-[16rem] truncate">
                          {String(r["cliente"] ?? "—")}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {String(r["representante"] ?? "—")}
                        </TableCell>
                        <TableCell>{String(r["centro"] ?? "—")}</TableCell>
                        <TableCell>{String(r["rota"] ?? "—")}</TableCell>
                        <TableCell className="capitalize">
                          {String(r["status"] ?? "").replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-right">{kg(r["peso_kg"])}</TableCell>
                        <TableCell className="text-right">{brl(r["total_liquido"])}</TableCell>
                        <TableCell className="text-right">
                          {num(r["comissao_percentual"]).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{brl(r["comissao_apurada"])}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      </div>
    </ErpLayout>
  );
}

type Grupo = { chave: string; rotulo: string; pedidos: number; liquido: number; comissao: number; peso: number };

function agrupar(linhas: Row[], chave: string, rotulo: string): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const r of linhas) {
    const k = String(r[chave] ?? "—");
    const atual =
      mapa.get(k) ??
      { chave: k, rotulo: String(r[rotulo] ?? "—"), pedidos: 0, liquido: 0, comissao: 0, peso: 0 };
    atual.pedidos += 1;
    atual.liquido += num(r["total_liquido"]);
    atual.comissao += num(r["comissao_apurada"]);
    atual.peso += num(r["peso_kg"]);
    mapa.set(k, atual);
  }
  return [...mapa.values()].sort((a, b) => b.liquido - a.liquido);
}

function Card({ label, value, destaque }: { label: string; value: string; destaque?: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold ${destaque ? "text-xl text-primary" : "text-lg"}`}>
        {value}
      </p>
    </article>
  );
}

function Resumo({
  title,
  rows,
  primeiraColuna,
}: {
  title: string;
  rows: Grupo[];
  primeiraColuna: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{primeiraColuna}</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Peso</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead className="text-right">Comissão</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.chave}>
                <TableCell className="max-w-[16rem] truncate">{r.rotulo}</TableCell>
                <TableCell className="text-right">{r.pedidos}</TableCell>
                <TableCell className="text-right">{kg(r.peso)}</TableCell>
                <TableCell className="text-right">{brl(r.liquido)}</TableCell>
                <TableCell className="text-right">{brl(r.comissao)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
