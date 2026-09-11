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
import { exportarCsv } from "@/lib/exportar";
import { usePermissoesFin } from "@/lib/permissoes-financeiras";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/dre")({
  head: () => ({
    meta: [
      { title: "DRE gerencial — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Demonstrativo de resultado gerencial com receita, custo dos produtos, despesas por grupo, resultado operacional e líquido.",
      },
      { property: "og:title", content: "DRE gerencial — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Resultado por período e centro de custo, com comparação ao período anterior.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrePage,
});

type Row = Record<string, unknown>;

const num = (r: Row | undefined, k: string) => Number(r?.[k] ?? 0);

function DrePage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const perm = usePermissoesFin();
  const [visao, setVisao] = useState("mensal");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const dre = useQuery({
    queryKey: ["vw_dre_mensal", "pagina", centro],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_dre_mensal").select("*").order("periodo");
      if (centro) q = q.eq("centro_id", centro);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  /** Consolida os meses no agrupamento escolhido (mensal, trimestral, semestral, anual). */
  const periodos = useMemo(() => {
    const chave = (p: string) => {
      const [ano, mes] = p.split("-");
      const m = Number(mes);
      if (visao === "anual") return ano;
      if (visao === "semestral") return `${ano}-S${m <= 6 ? 1 : 2}`;
      if (visao === "trimestral") return `${ano}-T${Math.ceil(m / 3)}`;
      return p;
    };
    const campos = [
      "receita_bruta",
      "deducoes",
      "cpv",
      "desp_administrativa",
      "desp_comercial",
      "desp_vendas",
      "desp_logistica",
      "desp_operacional",
      "desp_financeira",
      "receita_financeira",
      "outras_receitas",
    ];
    const map = new Map<string, Row>();
    for (const r of dre.data ?? []) {
      const p = String(r["periodo"] ?? "");
      if (!p) continue;
      if (de && p < de.slice(0, 7)) continue;
      if (ate && p > ate.slice(0, 7)) continue;
      const k = chave(p);
      const item = (map.get(k) ?? { periodo: k }) as Row;
      for (const c of campos) item[c] = Number(item[c] ?? 0) + Number(r[c] ?? 0);
      map.set(k, item);
    }
    return [...map.values()].sort((a, b) =>
      String(a["periodo"]).localeCompare(String(b["periodo"])),
    );
  }, [dre.data, visao, de, ate]);

  const atual = periodos[periodos.length - 1];
  const anterior = periodos[periodos.length - 2];

  const calc = (r: Row | undefined) => {
    const receitaBruta = num(r, "receita_bruta");
    const deducoes = num(r, "deducoes");
    const receitaLiquida = receitaBruta - deducoes;
    const cpv = num(r, "cpv");
    const lucroBruto = receitaLiquida - cpv;
    const operacionais =
      num(r, "desp_administrativa") +
      num(r, "desp_comercial") +
      num(r, "desp_vendas") +
      num(r, "desp_logistica") +
      num(r, "desp_operacional");
    const resultadoOperacional = lucroBruto - operacionais;
    const resultadoLiquido =
      resultadoOperacional - num(r, "desp_financeira") + num(r, "receita_financeira");
    return {
      receitaBruta,
      deducoes,
      receitaLiquida,
      cpv,
      lucroBruto,
      operacionais,
      resultadoOperacional,
      resultadoLiquido,
    };
  };

  const a = calc(atual);
  const b = calc(anterior);

  const linhas: { label: string; valor: number; anterior: number; forte?: boolean }[] = [
    { label: "Receita bruta", valor: a.receitaBruta, anterior: b.receitaBruta },
    { label: "(-) Deduções", valor: -a.deducoes, anterior: -b.deducoes },
    { label: "= Receita líquida", valor: a.receitaLiquida, anterior: b.receitaLiquida, forte: true },
    { label: "(-) Custo dos produtos vendidos", valor: -a.cpv, anterior: -b.cpv },
    { label: "= Lucro bruto", valor: a.lucroBruto, anterior: b.lucroBruto, forte: true },
    {
      label: "(-) Despesas administrativas",
      valor: -num(atual, "desp_administrativa"),
      anterior: -num(anterior, "desp_administrativa"),
    },
    {
      label: "(-) Despesas comerciais",
      valor: -num(atual, "desp_comercial"),
      anterior: -num(anterior, "desp_comercial"),
    },
    {
      label: "(-) Despesas com vendas",
      valor: -num(atual, "desp_vendas"),
      anterior: -num(anterior, "desp_vendas"),
    },
    {
      label: "(-) Despesas de logística",
      valor: -num(atual, "desp_logistica"),
      anterior: -num(anterior, "desp_logistica"),
    },
    {
      label: "(-) Outras despesas operacionais",
      valor: -num(atual, "desp_operacional"),
      anterior: -num(anterior, "desp_operacional"),
    },
    {
      label: "= Resultado operacional",
      valor: a.resultadoOperacional,
      anterior: b.resultadoOperacional,
      forte: true,
    },
    {
      label: "(-) Despesas financeiras",
      valor: -num(atual, "desp_financeira"),
      anterior: -num(anterior, "desp_financeira"),
    },
    {
      label: "(+) Receitas financeiras",
      valor: num(atual, "receita_financeira"),
      anterior: num(anterior, "receita_financeira"),
    },
    {
      label: "= Resultado líquido",
      valor: a.resultadoLiquido,
      anterior: b.resultadoLiquido,
      forte: true,
    },
  ];

  if (!perm.carregando && !perm.pode("dre_ver")) {
    return (
      <ErpLayout title="DRE gerencial" description="Acesso restrito.">
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para visualizar a DRE.
        </p>
      </ErpLayout>
    );
  }

  return (
    <ErpLayout
      title="DRE gerencial"
      description="Baseada nas movimentações financeiras reais e no custo dos produtos vendidos dos pedidos. Transferências entre contas não entram no resultado."
    >
      <div className="space-y-4">
        <FilterBar
          onClear={() => {
            setDe("");
            setAte("");
            setVisao("mensal");
          }}
          extra={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  exportarCsv(
                    "dre",
                    [
                      { key: "label", label: "Linha" },
                      { key: "valor", label: "Período atual" },
                      { key: "anterior", label: "Período anterior" },
                    ],
                    linhas as unknown as Row[],
                  )
                }
              >
                Exportar CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="size-3.5" /> PDF
              </Button>
            </div>
          }
        >
          <FilterSelect
            label="Visão"
            value={visao}
            onChange={setVisao}
            options={[
              { value: "mensal", label: "Mensal" },
              { value: "trimestral", label: "Trimestral" },
              { value: "semestral", label: "Semestral" },
              { value: "anual", label: "Anual" },
            ]}
          />
          <FilterText label="De" type="date" value={de} onChange={setDe} />
          <FilterText label="Até" type="date" value={ate} onChange={setAte} />
        </FilterBar>

        <div className="print-area rounded-lg border border-border bg-card">
          {dre.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : dre.isError ? (
            <p className="p-6 text-sm text-destructive">{(dre.error as Error).message}</p>
          ) : periodos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sem movimentações no período selecionado.
            </p>
          ) : (
            <>
              <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                Período {String(atual?.["periodo"])}
                {anterior ? ` · comparado com ${String(anterior["periodo"])}` : ""}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">% receita</TableHead>
                    <TableHead className="text-right">Período anterior</TableHead>
                    <TableHead className="text-right">Variação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => {
                    const perc =
                      a.receitaBruta > 0 ? (l.valor / a.receitaBruta) * 100 : 0;
                    const variacao =
                      l.anterior !== 0 ? ((l.valor - l.anterior) / Math.abs(l.anterior)) * 100 : 0;
                    return (
                      <TableRow key={l.label}>
                        <TableCell className={l.forte ? "font-semibold" : undefined}>
                          {l.label}
                        </TableCell>
                        <TableCell
                          className={`text-right ${l.forte ? "font-semibold" : ""} ${
                            l.valor < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {brl(l.valor)}
                        </TableCell>
                        <TableCell className="text-right">{perc.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">{brl(l.anterior)}</TableCell>
                        <TableCell className="text-right">
                          {l.anterior === 0 ? "—" : `${variacao.toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
