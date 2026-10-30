import { createFileRoute } from "@tanstack/react-router";

import { LogoLoja } from "@/components/logo-loja";
import { CrudPage, type CrudField } from "@/components/crud-page";
import { ConfiguracaoLoja } from "@/components/configuracao-loja";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/centros")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { loja?: string; cidade?: string; uf?: string } => ({
    ...(typeof search["loja"] === "string" ? { loja: search["loja"] } : {}),
    ...(typeof search["cidade"] === "string" ? { cidade: search["cidade"] } : {}),
    ...(typeof search["uf"] === "string" ? { uf: search["uf"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Lojas — ERP Distribuidora" },
      {
        name: "description",
        content: "Nome, identidade visual e dados das lojas da distribuidora.",
      },
      { property: "og:title", content: "Lojas — ERP Distribuidora" },
      { property: "og:description", content: "Identificação e cobrança das lojas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CentrosPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  {
    name: "nome",
    label: "Nome da loja",
    span: 2,
    inTable: true,
    required: true,
    after: ({ form, patch }) => (
      <LogoLoja valor={form["logo_url"]} onChange={(valor) => patch({ logo_url: valor })} />
    ),
  },
  { name: "nome_fantasia", label: "Nome fantasia", span: 2 },
  { name: "razao_social", label: "Razão social", span: 2 },
  { name: "logo_url", label: "Logo da loja", hiddenInForm: true },
  {
    name: "categoria_produtos_id",
    label: "Categoria dos produtos",
    type: "ref",
    ref: { table: "cad_categorias", labelField: "nome" },
    auto: true,
    inTable: true,
    hiddenInForm: true,
  },
  { name: "cnpj", label: "CNPJ" },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "telefone", label: "Telefone" },
  { name: "email", label: "E-mail", type: "email" },
  { name: "logradouro", label: "Rua / avenida", span: 2 },
  { name: "numero", label: "Número" },
  { name: "bairro", label: "Bairro" },
  { name: "cep", label: "CEP" },
  { name: "cidade", label: "Cidade", inTable: true, lookup: "cad_cidades" },
  { name: "uf", label: "UF", inTable: true },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function CentrosPage() {
  const { loja, cidade, uf } = Route.useSearch();
  return (
    <ErpLayout
      title="Lojas"
      description="Identificação, regras comerciais e cobrança por loja. Estoque e regras comerciais respeitam o vínculo de cada loja."
    >
      <CrudPage
        table="centros"
        fields={fields}
        orderBy="nome"
        emptyLabel="Nenhuma loja cadastrada ainda."
        searchColumns={["codigo", "nome", "cidade", "uf"]}
      />
      <ConfiguracaoLoja
        key={`${loja ?? ""}-${cidade ?? ""}-${uf ?? ""}`}
        lojaInicial={loja ?? ""}
        cidadeInicial={[cidade, uf].filter(Boolean).join(" ")}
      />
    </ErpLayout>
  );
}
