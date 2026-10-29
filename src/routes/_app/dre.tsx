import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, ChevronDown, ChevronRight, Loader2, Printer } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
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
          "Demonstração do resultado com receita bruta, custo dos produtos, despesas por categoria e resultado líquido.",
      },
      { property: "og:title", content: "DRE gerencial — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Resultado por período e centro de custo, detalhado por categoria.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrePage,
});

type Row = Record<string, unknown>;
type Linha = { label: string; valor: number; nivel: 0 | 1 | 2; total?: boolean; key: string; pai?: string; avo?: string; filhos?: number };

const hoje = new Date();
const iniMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);

const ehReceita = (g: string) => g === "receita_bruta" || g === "receita_financeira" || g === "outras_receitas";

function DrePage() {
  const { client } = useSupabase();
  const { centro } = useCentro();
  const perm = usePermissoesFin();
  const [de, setDe] = useState(iniMes);
  const [ate, setAte] = useState(fimMes);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const alternar = (k: string) => setAbertas((s) => ({ ...s, [k]: !s[k] }));

  const dre = useQuery({
    queryKey: ["vw_dre_base", "pagina", centro, de, ate],
    enabled: !!client,
    queryFn: async () => {
      let q = client!.from("vw_dre_base").select("data, centro_id, grupo_dre, categoria, subcategoria, valor");
      if (centro) q = q.eq("centro_id", centro);
      if (de) q = q.gte("data", de);
      if (ate) q = q.lte("data", ate);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const { linhas, receita } = useMemo(() => {
    // agrupa: seção -> categoria -> subcategoria
    const secoes = new Map<string, Map<string, Map<string, number>>>();
    for (const r of dre.data ?? []) {
      const g = String(r["grupo_dre"] ?? "");
      const sec =
        g === "receita_bruta"
          ? "receita"
          : g === "deducao"
            ? "deducao"
            : g === "cpv"
              ? "cpv"
              : g === "receita_financeira" || g === "outras_receitas"
                ? "outras_receitas"
                : g === "despesa_financeira"
                  ? "financeira"
                  : "despesa";
      const cat = String(r["categoria"] ?? "Outros");
      const sub = r["subcategoria"] && r["subcategoria"] !== cat ? String(r["subcategoria"]) : "";
      const v = Number(r["valor"] ?? 0);
      const m = secoes.get(sec) ?? new Map();
      const c = m.get(cat) ?? new Map();
      c.set(sub, (c.get(sub) ?? 0) + v);
      m.set(cat, c);
      secoes.set(sec, m);
      void ehReceita;
    }
    const total = (s: string) => {
      let t = 0;
      for (const c of secoes.get(s)?.values() ?? []) for (const v of c.values()) t += v;
      return t;
    };
    const out: Linha[] = [];
    const secao = (s: string, titulo: string) => {
      const m = secoes.get(s);
      const sk = `s:${s}`;
      out.push({ label: titulo, valor: total(s), nivel: 0, key: sk, filhos: m?.size ?? 0 });
      if (!m) return;
      for (const [cat, subs] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        let t = 0;
        for (const v of subs.values()) t += v;
        const ck = `${sk}:${cat}`;
        const nSubs = [...subs.keys()].filter(Boolean).length;
        out.push({ label: cat, valor: t, nivel: 1, key: ck, pai: sk, filhos: nSubs });
        for (const [sub, v] of subs)
          if (sub) out.push({ label: `↳ ${sub}`, valor: v, nivel: 2, key: `${ck}:${sub}`, pai: ck, avo: sk });
      }
    };
    const rb = total("receita");
    secao("receita", "RECEITA BRUTA");
    if (secoes.has("deducao")) secao("deducao", "(-) DEDUÇÕES");
    const rl = rb + total("deducao");
    secao("cpv", "(-) CUSTO DOS PRODUTOS VENDIDOS");
    const lb = rl + total("cpv");
    out.push({ label: "(=) LUCRO BRUTO", valor: lb, nivel: 0, total: true, key: "t" + out.length });
    secao("despesa", "(-) DESPESAS OPERACIONAIS");
    const ro = lb + total("despesa");
    out.push({ label: "(=) RESULTADO OPERACIONAL", valor: ro, nivel: 0, total: true, key: "t" + out.length });
    if (secoes.has("outras_receitas")) secao("outras_receitas", "(+) RECEITAS FINANCEIRAS / OUTRAS");
    if (secoes.has("financeira")) secao("financeira", "(-) DESPESAS FINANCEIRAS");
    out.push({
      label: "(=) RESULTADO LÍQUIDO",
      valor: ro + total("outras_receitas") + total("financeira"),
      nivel: 0,
      total: true,
      key: "t-final",
    });
    return { linhas: out, receita: rb };
  }, [dre.data]);

  if (!perm.carregando && !perm.pode("dre_ver")) {
    return (
      <ErpLayout title="DRE gerencial" description="Acesso restrito.">
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para visualizar a DRE.
        </p>
      </ErpLayout>
    );
  }

  const pct = (v: number) => (receita ? `${((Math.abs(v) / receita) * 100).toFixed(1).replace(".", ",")}%` : "—");

  return (
    <ErpLayout title="DRE gerencial" description="As despesas e receitas lançadas aparecem aqui automaticamente, pela categoria.">
      <div className="space-y-4">
        <FilterBar
          onClear={() => {
            setDe(iniMes);
            setAte(fimMes);
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
                      { key: "label", label: "Descrição" },
                      { key: "valor", label: "Valor" },
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
          <FilterText label="De" type="date" value={de} onChange={setDe} />
          <FilterText label="Até" type="date" value={ate} onChange={setAte} />
        </FilterBar>

        <div className="print-area overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <h2 className="flex items-center gap-2 px-6 pb-2 pt-6 text-lg font-semibold">
            <BarChart3 className="size-5" /> Demonstração do Resultado (DRE)
          </h2>
          <p className="no-print px-6 pb-2 text-xs text-muted-foreground">
            Clique em um totalizador para ver as categorias, e numa categoria para ver as subcategorias.
          </p>
          {dre.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : dre.isError ? (
            <p className="p-6 text-sm text-destructive">{(dre.error as Error).message}</p>
          ) : (
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-4 py-3 text-left font-normal">Descrição</th>
                  <th className="px-4 py-3 text-right font-normal">Valor</th>
                  <th className="w-32 px-4 py-3 text-right font-normal">%</th>
                </tr>
              </thead>
              <tbody>
                {linhas
                  .filter((l) => (!l.pai || abertas[l.pai]) && (!l.avo || abertas[l.avo]))
                  .map((l) => (
                  <Fragment key={l.key}>
                    <tr
                      onClick={l.filhos ? () => alternar(l.key) : undefined}
                      className={`border-b border-border ${l.filhos ? "cursor-pointer hover:bg-accent/50" : ""} ${l.total ? "bg-muted/50" : ""} ${
                        l.nivel === 2 ? "text-xs italic text-muted-foreground" : ""
                      }`}
                    >
                      <td
                        className={`px-4 py-3 ${l.nivel === 0 ? "font-semibold" : ""} ${
                          l.nivel === 1 ? "pl-8 text-muted-foreground" : l.nivel === 2 ? "pl-12" : ""
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {l.filhos ? (
                            abertas[l.key] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
                          ) : null}
                          {l.label}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right ${l.nivel === 0 ? "font-semibold" : ""} ${
                          l.valor < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {brl(l.valor)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{l.nivel === 2 ? "" : pct(l.valor)}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
