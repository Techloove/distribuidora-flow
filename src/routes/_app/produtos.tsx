import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { CrudPage, type CrudField, type Row } from "@/components/crud-page";
import { useCentroValido } from "@/lib/centros-acesso";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { HistoricoProduto } from "@/components/historico-produto";
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
  {
    name: "categoria",
    label: "Loja",
    inTable: true,
    lookup: "cad_categorias",
    filter: true,
  },
  { name: "marca", label: "Marca", inTable: true, lookup: "cad_marcas", filter: true },
  { name: "grupo", label: "Grupo", inTable: true, lookup: "cad_grupos", filter: true },
  { name: "unidade", label: "Unidade", filter: true },
  { name: "ncm", label: "NCM (8 dígitos)", section: "Dados fiscais — NF-e" },
  { name: "cest", label: "CEST (7 dígitos, quando aplicável)" },
  { name: "ean", label: "GTIN / EAN (vazio quando não possui)" },
  {
    name: "origem_fiscal",
    label: "Origem da mercadoria (0 a 8)",
    type: "select",
    options: [
      { value: "0", label: "0 · Nacional, exceto códigos 3, 4, 5 e 8" },
      { value: "1", label: "1 · Estrangeira, importação direta, exceto 6" },
      { value: "2", label: "2 · Estrangeira, mercado interno, exceto 7" },
      { value: "3", label: "3 · Nacional, importação acima de 40% até 70%" },
      { value: "4", label: "4 · Nacional, processos produtivos básicos" },
      { value: "5", label: "5 · Nacional, importação até 40%" },
      { value: "6", label: "6 · Estrangeira, importação direta, sem similar nacional" },
      { value: "7", label: "7 · Estrangeira, mercado interno, sem similar nacional" },
      { value: "8", label: "8 · Nacional, importação acima de 70%" },
    ],
  },
  { name: "cfop", label: "CFOP interno específico (vazio = regra da loja)" },
  { name: "cfop_interestadual", label: "CFOP interestadual específico (vazio = regra da loja)" },
  { name: "peso_kg", label: "Peso (kg)", type: "number", step: "0.001" },
  {
    name: "comissao_fixa_unidade",
    currency: true,
    label: "Comissão fixa por unidade (vazio = percentual)",
    type: "number",
    step: "0.0001",
  },
  {
    name: "ultimo_custo",
    currency: true,
    label: "Custo Compra",
    type: "number",
    step: "0.01",
    inTable: true,
    span: 1,
  },
  {
    name: "custo_medio",
    currency: true,
    label: "Custo Médio",
    type: "number",
    step: "0.01",
    inTable: true,
    span: 1,
  },
  {
    name: "markup_percentual",
    label: "% Markup",
    type: "number",
    step: "0.01",
    inTable: true,
    span: 1,
  },
  {
    name: "preco_venda",
    currency: true,
    label: "Preço Venda",
    type: "number",
    step: "0.01",
    inTable: true,
    span: 1,
  },
  {
    name: "promo_preco",
    currency: true,
    label: "Preço Promoção",
    inTable: true,
    auto: true,
    virtual: true,
  },
  { name: "promo_fim", label: "Promoção Válida até", inTable: true, auto: true, virtual: true },
  { name: "comissao_percentual", label: "Comissão do produto (%)", type: "number", step: "0.01" },
  { name: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "0.001" },
  { name: "estoque_maximo", label: "Estoque máximo para reposição", type: "number", step: "0.001" },
  { name: "prazo_fornecedor_dias", label: "Prazo do fornecedor (dias)", type: "number", step: "1" },
  {
    name: "estoque_atual",
    label: "Estoque",
    type: "number",
    step: "0.001",
    inTable: true,
    auto: true,
  },
  { name: "comprado_qtd", label: "Comprado", inTable: true, auto: true, virtual: true },
  {
    name: "permite_estoque_negativo",
    label: "Estoque Negativo",
    type: "checkbox",
    inTable: true,
  },
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

const fmtDate = (v: unknown) => {
  const s = String(v ?? "");
  if (!s) return "sem limite";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function ProdutosPage() {
  const { client, user } = useSupabase();
  const cv = useCentroValido();

  /** Promoções vigentes (tabelas de preço) usadas para exibir o preço promocional do produto. */
  const promocoes = useQuery({
    queryKey: ["vw_promocoes", "vigentes", user?.id, cv.centro],
    enabled: !!client && !!cv.centro && !cv.isLoading && !cv.error,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_promocoes")
        .select("produto_id, preco_promocional, vigencia_fim, tabela_nome, vigente, prioridade")
        .eq("centro_id", cv.centro)
        .order("prioridade", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
  });

  /** Quantidades compradas aguardando recebimento (compras com status "comprado"). */
  const comprados = useQuery({
    queryKey: ["vw_produto_comprado", "produtos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_produto_comprado")
        .select("produto_id, quantidade_comprada");
      if (error) throw new Error(error.message);
      const mapa = new Map<string, number>();
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const id = String(r["produto_id"]);
        mapa.set(id, (mapa.get(id) ?? 0) + Number(r["quantidade_comprada"] ?? 0));
      }
      return mapa;
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
        const promoBase = p
          ? Number(p["preco_promocional"] ?? 0)
          : Number(r["preco_promocional"] ?? 0);
        const comprado = comprados.data?.get(String(r["id"])) ?? 0;
        return {
          ...r,
          promo_preco: promoBase > 0 ? promoBase : null,
          promo_fim: promoBase > 0 ? (p ? fmtDate(p["vigencia_fim"]) : "sem limite") : "—",
          comprado_qtd: comprado > 0 ? `C ${comprado}` : "—",
        };
      });
    },
    [promocoes.data, comprados.data],
  );

  /** Alteração direta na listagem: markup e preço de venda sempre sobre o custo médio. */
  const onInlineSave = useCallback((row: Row, name: string, value: string) => {
    const num = (v: unknown) => Number(String(v ?? "").replace(",", ".")) || 0;
    const custo = num(row["custo_medio"]);
    const novo = num(value);
    if (name === "markup_percentual") {
      if (custo <= 0) return { markup_percentual: novo };
      return {
        markup_percentual: novo,
        preco_venda: Number((custo * (1 + novo / 100)).toFixed(2)),
      };
    }
    return { preco_venda: Number(novo.toFixed(2)) };
  }, []);

  return (
    <ErpLayout
      title="Produtos"
      description="Cadastro geral de produtos. Consulte o estoque e o depósito da loja em Estoque; o preço normal é sincronizado com o catálogo das lojas."
      actions={
        <Button asChild variant="secondary">
          <Link to="/estoque">
            <Boxes className="size-4" /> Estoque e movimentações
          </Link>
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        O preço de venda é o mesmo em Produtos e no catálogo da loja. Salve a alteração para
        atualizar o preço normal usado em novos itens de pedidos. Também é possível editar em{" "}
        <Link to="/centros" className="font-medium underline">
          Lojas → Produtos e preços
        </Link>
        .
      </p>
      <CrudPage
        uppercase
        table="produtos"
        fields={fields}
        formSections={[
          {
            id: "geral",
            label: "Dados gerais",
            fields: [
              "codigo",
              "descricao",
              "categoria",
              "marca",
              "grupo",
              "unidade",
              "peso_kg",
              "ativo",
            ],
          },
          {
            id: "precos",
            label: "Preços e estoque",
            fields: [
              "ultimo_custo",
              "custo_medio",
              "markup_percentual",
              "preco_venda",
              "promo_preco",
              "promo_fim",
              "comissao_percentual",
              "comissao_fixa_unidade",
              "estoque_minimo",
              "estoque_maximo",
              "prazo_fornecedor_dias",
              "estoque_atual",
              "comprado_qtd",
              "permite_estoque_negativo",
            ],
          },
          {
            id: "fiscal",
            label: "Dados fiscais",
            fields: ["ncm", "cest", "ean", "origem_fiscal", "cfop", "cfop_interestadual"],
          },
          { id: "historico", label: "Histórico", fields: [], extra: true },
        ]}
        orderBy="descricao"
        emptyLabel="Nenhum produto cadastrado ainda."
        searchColumns={["codigo", "descricao", "categoria", "marca", "grupo"]}
        onFieldChange={recalcularPreco}
        decorate={decorate}
        inlineEdit={["markup_percentual", "preco_venda"]}
        onInlineSave={onInlineSave}
        extraForm={({ editing }) => (
          <HistoricoProduto produtoId={editing ? String(editing["id"]) : null} />
        )}
      />
    </ErpLayout>
  );
}
