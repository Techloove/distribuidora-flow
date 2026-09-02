import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { CrudPage, type CrudField, type Row } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { useSupabase } from "@/lib/supabase-provider";


export const Route = createFileRoute("/_app/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de produtos com EAN, NCM, unidade, custo médio, preço de venda e níveis de estoque.",
      },
      { property: "og:title", content: "Produtos — ERP Distribuidora" },
      { property: "og:description", content: "Catálogo e parâmetros de estoque dos produtos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProdutosPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "descricao", label: "Descrição", span: 2, inTable: true, required: true },
  { name: "categoria", label: "Categoria", inTable: true },
  { name: "marca", label: "Marca" },
  { name: "unidade", label: "Unidade" },
  { name: "peso_kg", label: "Peso (kg)", type: "number", step: "0.001" },
  { name: "preco_custo", label: "Preço de custo", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "custo_medio", label: "Custo médio", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "markup_percentual", label: "% Markup", type: "number", step: "0.01", inTable: true, span: 1, virtual: true },
  { name: "preco_venda", label: "Preço de venda", type: "number", step: "0.01", inTable: true, span: 1 },
  { name: "ultimo_custo", label: "Último custo", type: "number", step: "0.01" },
  { name: "preco_promocional", label: "Preço promocional", type: "number", step: "0.01" },
  { name: "promo_preco", label: "Promoção vigente", inTable: true, auto: true, virtual: true },
  { name: "promo_fim", label: "Válida até", inTable: true, auto: true, virtual: true },
  { name: "comissao_percentual", label: "Comissão do produto (%)", type: "number", step: "0.01" },
  { name: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "0.001" },
  { name: "estoque_atual", label: "Estoque atual", type: "number", step: "0.001", inTable: true },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];


/**
 * Markup e preço de venda andam juntos, sempre sobre o custo médio:
 * alterando o markup recalcula o preço de venda; alterando custo médio ou
 * preço de venda recalcula o markup.
 */
function recalcularPreco(
  name: string,
  value: string,
  form: Record<string, string | boolean>,
): Record<string, string | boolean> | void {
  const num = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;
  const custo = num(form["custo_medio"]);
  if (name === "markup_percentual") {
    if (custo <= 0) return;
    return { preco_venda: (custo * (1 + num(value) / 100)).toFixed(2) };
  }
  if (name === "custo_medio") {
    const markup = num(form["markup_percentual"]);
    if (num(value) > 0 && markup > 0) {
      return { preco_venda: (num(value) * (1 + markup / 100)).toFixed(2) };
    }
    return;
  }
  if (name === "preco_venda") {
    if (custo <= 0) return;
    return { markup_percentual: (((num(value) - custo) / custo) * 100).toFixed(2) };
  }
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (v: unknown) => {
  const s = String(v ?? "");
  if (!s) return "sem limite";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function ProdutosPage() {
  const { client } = useSupabase();

  /** Promoções vigentes (tabelas de preço) usadas para exibir o preço promocional do produto. */
  const promocoes = useQuery({
    queryKey: ["vw_promocoes", "vigentes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_promocoes")
        .select("produto_id, preco_promocional, vigencia_fim, tabela_nome, vigente, prioridade")
        .order("prioridade", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
  });

  const decorate = useCallback(
    (rows: Row[]) => {
      const mapa = new Map<string, Record<string, unknown>>();
      for (const p of promocoes.data ?? []) {
        if (!p["vigente"]) continue;
        const id = String(p["produto_id"] ?? "");
        if (id && !mapa.has(id)) mapa.set(id, p);
      }
      return rows.map((r) => {
        const p = mapa.get(String(r["id"]));
        const promoBase = p ? Number(p["preco_promocional"] ?? 0) : Number(r["preco_promocional"] ?? 0);
        return {
          ...r,
          promo_preco: promoBase > 0 ? brl(promoBase) : "—",
          promo_fim: promoBase > 0 ? (p ? fmtDate(p["vigencia_fim"]) : "sem limite") : "—",
        };
      });
    },
    [promocoes.data],
  );

  /** Alteração direta na listagem: markup e preço de venda sempre sobre o custo médio. */
  const onInlineSave = useCallback((row: Row, name: string, value: string) => {
    const num = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;
    const custo = num(row["custo_medio"]);
    const novo = num(value);
    if (name === "markup_percentual") {
      if (custo <= 0) return {};
      return { preco_venda: Number((custo * (1 + novo / 100)).toFixed(2)) };
    }
    return { preco_venda: Number(novo.toFixed(2)) };
  }, []);

  return (
    <ErpLayout
      title="Produtos"
      description="Catálogo que alimenta pedidos, precificação, estoque e compras."
    >
      <CrudPage
        table="produtos"
        fields={fields}
        orderBy="descricao"
        emptyLabel="Nenhum produto cadastrado ainda."
        searchColumns={["codigo", "descricao", "categoria", "marca"]}
        onFieldChange={recalcularPreco}
        decorate={decorate}
        inlineEdit={["markup_percentual", "preco_venda"]}
        onInlineSave={onInlineSave}
      />
    </ErpLayout>
  );
}
