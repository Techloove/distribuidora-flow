import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/cadastros-padrao")({
  head: () => ({
    meta: [
      { title: "Categorias, marcas e cidades — ERP Distribuidora" },
      {
        name: "description",
        content: "Cadastros padrão de categorias, marcas e cidades usados em todo o sistema.",
      },
      { property: "og:title", content: "Categorias, marcas e cidades — ERP Distribuidora" },
      { property: "og:description", content: "Listas padronizadas e correlacionadas do ERP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CadastrosPadraoPage,
});

const simples: CrudField[] = [
  { name: "nome", label: "Nome", span: 2, inTable: true, required: true },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

const cidades: CrudField[] = [
  { name: "nome", label: "Cidade", inTable: true, required: true },
  { name: "uf", label: "UF", span: 1, inTable: true },
  { name: "codigo_ibge", label: "Código IBGE", span: 1, inTable: true },
  { name: "ativo", label: "Ativo", type: "checkbox", inTable: true },
];

function CadastrosPadraoPage() {
  return (
    <ErpLayout
      title="Categorias, marcas, grupos e cidades"
      description="Cada nome é cadastrado uma única vez e usado em todo o sistema. Renomear aqui atualiza todos os registros."
    >
      <Tabs defaultValue="cat">
        <TabsList>
          <TabsTrigger value="cat">Categorias</TabsTrigger>
          <TabsTrigger value="marca">Marcas</TabsTrigger>
          <TabsTrigger value="grupo">Grupos</TabsTrigger>
          <TabsTrigger value="cid">Cidades</TabsTrigger>
        </TabsList>
        <TabsContent value="cat">
          <CrudPage table="cad_categorias" fields={simples} orderBy="nome" emptyLabel="Nenhuma categoria." searchColumns={["nome"]} />
        </TabsContent>
        <TabsContent value="marca">
          <CrudPage table="cad_marcas" fields={simples} orderBy="nome" emptyLabel="Nenhuma marca." searchColumns={["nome"]} />
        </TabsContent>
        <TabsContent value="grupo">
          <CrudPage table="cad_grupos" fields={simples} orderBy="nome" emptyLabel="Nenhum grupo." searchColumns={["nome"]} />
        </TabsContent>
        <TabsContent value="cid">
          <CrudPage table="cad_cidades" fields={cidades} orderBy="nome" emptyLabel="Nenhuma cidade." searchColumns={["nome", "uf", "codigo_ibge"]} />
        </TabsContent>
      </Tabs>
    </ErpLayout>
  );
}
