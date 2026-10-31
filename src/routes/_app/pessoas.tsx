import { getModalidade } from "@/lib/modalidade-store";
import { ConsultaCep } from "@/components/consulta-cep";
import {
  decorarPendenciasClientes,
  filtroPendenciaCliente,
  PENDENCIAS_COMERCIAIS_CLIENTE,
  type FiltroPendenciaCliente,
} from "@/lib/pendencias-cadastro";
import { useCentrosPermitidos } from "@/lib/centros-acesso";
import { idReferencia } from "@/lib/referencias-registros";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ComissaoRepresentante } from "@/components/comissao-representante";
import { ConsultaCadastral } from "@/components/consulta-cadastral";
import { ConsultaIe } from "@/components/consulta-ie";
import { CodigoIbge } from "@/components/codigo-ibge";
import { CrudPage, type CrudField } from "@/components/crud-page";
import { HistoricoCliente } from "@/components/historico-cliente";
import { ErpLayout } from "@/components/erp-layout";
import { RotasRepresentante } from "@/components/rotas-representante";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";
import {
  CadastrarClienteRepresentante,
  CreditosClientesPendentes,
} from "@/components/clientes-credito";

export const Route = createFileRoute("/_app/pessoas")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    pendencia?: FiltroPendenciaCliente | undefined;
    pessoa?: string | undefined;
    cliente?: string | undefined;
    fornecedor?: string | undefined;
    pedido?: string | undefined;
  } => ({
    pendencia: filtroPendenciaCliente(search["pendencia"]),
    pessoa: idReferencia(search["pessoa"]),
    pedido: idReferencia(search["pedido"]),
    cliente: idReferencia(search["cliente"]),
    fornecedor: idReferencia(search["fornecedor"]),
  }),
  head: () => ({
    meta: [
      { title: "Cadastro unificado — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro único de pessoas com marcação de papéis: cliente, fornecedor, representante e usuário do ERP.",
      },
      { property: "og:title", content: "Cadastro unificado — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Um registro por pessoa ou empresa, com as funções marcadas em caixas de seleção.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PessoasPage,
});

const fields: CrudField[] = [
  { name: "codigo", label: "Código", auto: true, inTable: true },
  { name: "razao_social", label: "Razão social / Nome", span: 2, inTable: true, required: true },
  {
    name: "papeis",
    label: "Funções deste cadastro",
    type: "multicheck",
    span: 2,
    inTable: true,
    checks: [
      { name: "is_cliente", label: "Cliente" },
      { name: "is_fornecedor", label: "Fornecedor" },
      { name: "is_representante", label: "Representante" },
      { name: "is_transportadora", label: "Transportadora" },
      { name: "is_usuario", label: "Usuário do sistema" },
    ],
  },
  { name: "nome_fantasia", label: "Nome fantasia" },
  {
    name: "tipo_pessoa",
    label: "Tipo de pessoa",
    type: "select",
    hiddenInForm: true,
    options: [
      { value: "PJ", label: "Pessoa jurídica" },
      { value: "PF", label: "Pessoa física" },
    ],
  },
  { name: "cnpj_cpf", label: "CNPJ / CPF", inTable: true, hiddenInForm: true },
  {
    name: "loja_pendente",
    label: "Cliente sem loja",
    type: "checkbox",
    hiddenInForm: true,
    filter: false,
  },
  { name: "email", label: "E-mail", type: "email", inTable: true },
  { name: "telefone", label: "Telefone" },
  { name: "whatsapp", label: "WhatsApp" },
  {
    name: "centro_id",
    label: "Centro de custo",
    type: "ref",
    inTable: true,
    ref: { table: "centros", labelField: "nome", emptyLabel: "Todos os centros" },
    showWhen: (form) => !form["is_cliente"],
  },
  {
    name: "status",
    label: "Status",
    type: "select",
    inTable: true,
    options: [
      { value: "ativo", label: "Ativo" },
      { value: "inativo", label: "Inativo" },
      { value: "bloqueado", label: "Bloqueado" },
    ],
  },
  { name: "ativo", label: "Ativo", type: "checkbox" },
  { name: "data_nascimento", label: "Data de nascimento", type: "date" },

  // Dados fiscais e da empresa: não se aplicam a quem é só representante.
  {
    name: "inscricao_estadual",
    label: "Inscrição estadual",
    section: "Dados fiscais",
    showWhen: naoSoRepresentante,
  },
  {
    name: "uf_inscricao_estadual",
    label: "UF da inscrição estadual",
    showWhen: naoSoRepresentante,
  },
  {
    name: "situacao_inscricao_estadual",
    label: "Situação da inscrição estadual",
    showWhen: naoSoRepresentante,
  },
  {
    name: "indicador_contribuinte_icms",
    label: "Contribuinte de ICMS",
    showWhen: naoSoRepresentante,
  },
  { name: "situacao_cadastral", label: "Situação cadastral", showWhen: naoSoRepresentante },
  { name: "data_abertura", label: "Data de abertura", type: "date", showWhen: naoSoRepresentante },
  { name: "natureza_juridica", label: "Natureza jurídica", showWhen: naoSoRepresentante },
  { name: "porte", label: "Porte", showWhen: naoSoRepresentante },
  { name: "cnae_principal", label: "CNAE principal", span: 2, showWhen: naoSoRepresentante },
  { name: "cnae_secundarios", label: "CNAEs secundários", span: 2, showWhen: naoSoRepresentante },

  // Comissão do representante: tudo junto.
  {
    name: "tipo_representante",
    label: "Tipo de vendedor",
    section: "Comissão do representante",
    showIf: "is_representante",
    type: "select",
    options: [
      { value: "interno", label: "Interno" },
      { value: "externo", label: "Externo / representante" },
    ],
  },
  {
    name: "comissao_percentual",
    label: "Comissão padrão (%)",
    showIf: "is_representante",
    type: "number",
    step: "0.01",
  },
  {
    name: "meta_mensal",
    currency: true,
    label: "Meta mensal (R$)",
    type: "number",
    step: "0.01",
    showIf: "is_representante",
  },
  {
    name: "regiao",
    label: "Região de atuação",
    showIf: "is_representante",
    after: ({ editing }) => (
      <div className="space-y-4">
        <ComissaoDaPessoa pessoaId={editing ? String(editing["id"]) : null} />
        <RotasRepresentante pessoaId={editing ? String(editing["id"]) : null} />
      </div>
    ),
  },

  // Endereço
  { name: "cep", label: "CEP", section: "Endereço" },
  { name: "logradouro", label: "Logradouro", span: 2 },
  { name: "numero", label: "Número" },
  { name: "complemento", label: "Complemento" },
  { name: "bairro", label: "Bairro" },
  { name: "cidade", label: "Cidade", inTable: true, lookup: "cad_cidades" },
  {
    name: "uf",
    label: "UF",
    after: ({ form, patch }) => <CodigoIbge form={form} patch={patch} />,
  },
  { name: "codigo_ibge", label: "Código IBGE", hiddenInForm: true },

  // Somente cliente
  {
    name: "rota_id",
    label: "Rota",
    section: "Dados do cliente",
    showIf: "is_cliente",
    type: "ref",
    ref: { table: "rotas", labelField: "nome" },
  },
  {
    name: "limite_credito",
    currency: true,
    label: "Limite de crédito",
    type: "number",
    step: "0.01",
    showIf: "is_cliente",
  },
  { name: "condicao_pagamento", label: "Condição de pagamento", showIf: "is_cliente" },
  {
    name: "representante_id",
    label: "Representante / vendedor do cliente",
    type: "select",
    showIf: "is_cliente",
    options: [],
  },
  { name: "observacoes", label: "Observações", span: 2, section: "Observações" },
];

function naoSoRepresentante(form: Record<string, string | boolean>) {
  return (
    !form["is_representante"] ||
    !!form["is_cliente"] ||
    !!form["is_fornecedor"] ||
    !!form["is_transportadora"]
  );
}

function PessoasPage() {
  const { pessoa, cliente, fornecedor, pedido, pendencia } = Route.useSearch();
  const filtroComercial = PENDENCIAS_COMERCIAIS_CLIENTE.find((p) => p.filtro === pendencia);
  const { client, roles } = useSupabase();
  const lojas = useCentrosPermitidos();
  const representante = roles.includes("representante") && !roles.includes("admin");

  const vinculo = useQuery({
    queryKey: ["pessoa-referencia", cliente, fornecedor, pedido],
    enabled: !!client && !pessoa && !!(cliente || fornecedor || pedido),
    queryFn: async () => {
      let clienteId = cliente;
      if (!clienteId && !fornecedor && pedido) {
        const resultado = await client!
          .from("pedidos")
          .select("cliente_id")
          .eq("id", pedido)
          .maybeSingle();
        if (resultado.error || !resultado.data?.cliente_id)
          throw new Error("Cliente do pedido indisponível para seu acesso.");
        clienteId = String(resultado.data.cliente_id);
      }
      const { data, error } = await client!
        .from(clienteId ? "clientes" : "fornecedores")
        .select("pessoa_id")
        .eq("id", clienteId ?? fornecedor!)
        .maybeSingle();
      if (error) throw new Error("Não foi possível abrir o cadastro relacionado.");
      if (!data?.pessoa_id) throw new Error("Cadastro relacionado indisponível para seu acesso.");
      return String(data.pessoa_id);
    },
  });

  const formas = useQuery({
    queryKey: [...["formas_pagamento", "pessoas"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("formas_pagamento")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []).filter((f) => f["ativo"] !== false);
    },
  });

  const representantes = useQuery({
    queryKey: [...["representantes", "pessoas"], getModalidade()],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []).filter((r) => r["ativo"] !== false);
    },
  });

  const camposComFormas: CrudField[] = fields.map((f) => {
    if (f.name === "centro_id")
      return {
        ...f,
        renderValue: (r) =>
          r["loja_pendente"] === true
            ? "Sem loja"
            : r["centro_id"]
              ? (lojas.lista.find((l) => l.id === r["centro_id"])?.nome ?? "Loja específica")
              : "Compartilhado entre lojas",
      };
    if (f.name === "limite_credito" && !roles.includes("admin")) return { ...f, auto: true };
    if (f.name === "condicao_pagamento")
      return {
        ...f,
        label: "Condição de pagamento (formas cadastradas)",
        type: "select" as const,
        options: (formas.data ?? []).map((forma) => ({
          value: String(forma["nome"]),
          label: String(forma["nome"]),
        })),
      };
    if (f.name === "representante_id")
      return {
        ...f,
        options: (representantes.data ?? []).map((r) => ({
          value: String(r["id"]),
          label: String(r["nome"]),
        })),
      };
    return f;
  });

  return (
    <ErpLayout
      title="Cadastro unificado"
      description="Um único cadastro por pessoa ou empresa. Marque as funções (cliente, fornecedor, representante, usuário) e o sistema replica automaticamente nos módulos correspondentes."
    >
      {representante && <CadastrarClienteRepresentante />}
      {roles.includes("admin") && <CreditosClientesPendentes />}
      {!pessoa && (cliente || fornecedor || pedido) && (vinculo.isPending || vinculo.isError) ? (
        <p role="status" className="p-4 text-sm">
          {vinculo.isError ? vinculo.error.message : "Abrindo cadastro relacionado…"}
        </p>
      ) : (
        <CrudPage
          key={pendencia ?? "todos"}
          readAll
          defaultValues={{ loja_pendente: true }}
          decorate={decorarPendenciasClientes}
          initialFilters={filtroComercial ? { [filtroComercial.campo]: "sem" } : undefined}
          uppercase
          readOnly={representante}
          table="pessoas"
          initialEditId={pessoa ?? vinculo.data}
          fields={[
            ...camposComFormas,
            {
              name: "_cadastro_loja",
              label: "Vínculo de loja do cliente",
              type: "select",
              virtual: true,
              hiddenInForm: true,
              options: [
                { value: "sem", label: "Sem loja" },
                { value: "especifica", label: "Com loja específica" },
                { value: "compartilhado", label: "Compartilhado entre lojas (todos os centros)" },
              ],
            },
            {
              name: "_cadastro_loja_id",
              label: "Loja específica do cliente",
              type: "select",
              virtual: true,
              hiddenInForm: true,
              options: lojas.lista.map((l) => ({ value: l.id, label: l.nome })),
            },
            ...PENDENCIAS_COMERCIAIS_CLIENTE.filter((p) => p.filtro !== "sem_loja").map((p) => ({
              name: p.campo,
              label: p.filtroLabel,
              type: "select" as const,
              virtual: true,
              hiddenInForm: true,
              options: [
                { value: "sem", label: p.sem },
                { value: "com", label: p.com },
              ],
            })),
            {
              name: "credito_pendente",
              label: "Crédito pendente",
              type: "checkbox",
              auto: true,
              inTable: true,
            },
          ]}
          formSections={[
            {
              id: "identificacao",
              label: "CPF / CNPJ",
              fields: ["codigo", "tipo_pessoa", "cnpj_cpf"],
              extra: true,
            },
            {
              id: "geral",
              label: "Dados gerais",
              extra: true,
              fields: [
                "razao_social",
                "nome_fantasia",
                "papeis",
                "centro_id",
                "status",
                "ativo",
                "data_nascimento",
              ],
            },
            {
              id: "endereco",
              label: "Contato e endereço",
              extra: true,
              fields: [
                "email",
                "telefone",
                "whatsapp",
                "cep",
                "logradouro",
                "numero",
                "complemento",
                "bairro",
                "cidade",
                "uf",
                "codigo_ibge",
              ],
            },
            {
              id: "fiscal",
              label: "Dados fiscais",
              fields: [
                "inscricao_estadual",
                "uf_inscricao_estadual",
                "situacao_inscricao_estadual",
                "indicador_contribuinte_icms",
                "situacao_cadastral",
                "data_abertura",
                "natureza_juridica",
                "porte",
                "cnae_principal",
                "cnae_secundarios",
              ],
              extra: true,
            },
            {
              id: "cliente",
              label: "Limites Rotas e Representantes",
              fields: ["rota_id", "limite_credito", "condicao_pagamento", "representante_id"],
              extra: true,
            },
            {
              id: "representante",
              label: "Dados Representante",
              fields: ["tipo_representante", "comissao_percentual", "meta_mensal", "regiao"],
              extra: true,
            },
            { id: "historico", label: "Histórico", fields: [], extra: true },
            { id: "observacoes", label: "Observações", fields: ["observacoes"] },
          ]}
          orderBy="razao_social"
          emptyLabel="Nenhuma pessoa cadastrada ainda."
          searchColumns={["codigo", "razao_social", "nome_fantasia", "cnpj_cpf", "cidade", "email"]}
          extraFormTop
          extraForm={({ form, editing, patch, openRow, sectionId }) => (
            <div className="space-y-4">
              {sectionId === "geral" && form["is_cliente"] && (
                <div className="space-y-2 rounded-lg border p-3">
                  <label htmlFor="vinculo-loja-cliente" className="text-sm font-medium">
                    Vínculo de loja do cliente
                  </label>
                  <select
                    id="vinculo-loja-cliente"
                    className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                    disabled={representante || lojas.isLoading || !!lojas.error}
                    value={
                      form["loja_pendente"] === true ? "sem" : String(form["centro_id"] || "todas")
                    }
                    onChange={(e) =>
                      patch({
                        loja_pendente: e.target.value === "sem",
                        centro_id: ["sem", "todas"].includes(e.target.value) ? "" : e.target.value,
                      })
                    }
                  >
                    <option value="sem">Sem loja</option>
                    <option value="todas">Compartilhado entre lojas (todas as lojas)</option>
                    <optgroup label="Uma loja">
                      {lojas.lista.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Sem loja indica cadastro pendente. Defina uma loja ou o compartilhamento antes
                    de iniciar novos pedidos. O histórico existente é preservado.
                  </p>
                  {lojas.error && (
                    <p role="alert" className="text-sm text-destructive">
                      Não foi possível carregar as lojas permitidas.
                    </p>
                  )}
                </div>
              )}
              {sectionId === "endereco" && (
                <ConsultaCep key={String(editing?.["id"] ?? "novo")} form={form} patch={patch} />
              )}
              {sectionId === "identificacao" && (
                <ConsultaCadastral
                  form={form}
                  editing={editing}
                  patch={patch}
                  openRow={openRow}
                  escopo="pessoas"
                />
              )}
              {sectionId === "fiscal" &&
                (naoSoRepresentante(form) ? (
                  <ConsultaIe form={form} editing={editing} patch={patch} escopo="pessoas" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Dados fiscais não se aplicam a um cadastro somente de representante.
                  </p>
                ))}
              {sectionId === "cliente" && !form["is_cliente"] && (
                <p className="text-sm text-muted-foreground">
                  Marque a função Cliente em Dados gerais para preencher as condições comerciais.
                </p>
              )}
              {sectionId === "representante" && !form["is_representante"] && (
                <p className="text-sm text-muted-foreground">
                  Marque a função Representante em Dados gerais para acessar comissões e rotas.
                </p>
              )}
              {sectionId === "historico" &&
                (form["is_cliente"] ? (
                  <HistoricoCliente pessoaId={editing ? String(editing["id"]) : null} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    O histórico comercial está disponível para cadastros com a função Cliente.
                  </p>
                ))}
            </div>
          )}
        />
      )}
    </ErpLayout>
  );
}

/** Comissões do vendedor: busca o vínculo comercial da própria pessoa. */
function ComissaoDaPessoa({ pessoaId }: { pessoaId: string | null }) {
  const { client } = useSupabase();
  const vinculo = useQuery({
    queryKey: [...["representante_da_pessoa", pessoaId], getModalidade()],
    enabled: !!client && !!pessoaId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id")
        .eq("pessoa_id", pessoaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? String(data["id"]) : null;
    },
  });

  return <ComissaoRepresentante representanteId={vinculo.data ?? null} />;
}
