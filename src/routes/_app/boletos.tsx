import { createFileRoute } from "@tanstack/react-router";

import { CrudPage, type CrudField } from "@/components/crud-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/boletos")({
  head: () => ({
    meta: [
      { title: "Boletos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Controle de boletos bancários: nosso número, linha digitável, vencimento, liquidação e situação do registro.",
      },
      { property: "og:title", content: "Boletos — ERP Distribuidora" },
      { property: "og:description", content: "Registro e baixa de boletos do contas a receber." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BoletosPage,
});

const fields: CrudField[] = [
  { name: "cliente_id", label: "Cliente", type: "ref", ref: { table: "clientes", labelField: "razao_social" }, span: 2 },
  {
    name: "banco",
    label: "Banco",
    type: "select",
    inTable: true,
    options: [
      { value: "sicredi", label: "Sicredi" },
      { value: "outro", label: "Outro" },
    ],
  },
  { name: "nosso_numero", label: "Nosso número", inTable: true },
  { name: "seu_numero", label: "Seu número", inTable: true },
  { name: "valor", label: "Valor (R$)", type: "number", step: "0.01", inTable: true },
  { name: "valor_liquidado", label: "Valor liquidado (R$)", type: "number", step: "0.01" },
  { name: "vencimento", label: "Vencimento", type: "date", inTable: true },
  { name: "data_emissao", label: "Emissão", type: "date" },
  { name: "data_liquidacao", label: "Liquidação", type: "date" },
  {
    name: "status",
    label: "Situação",
    type: "select",
    inTable: true,
    options: [
      { value: "pendente", label: "Pendente" },
      { value: "registrado", label: "Registrado" },
      { value: "liquidado", label: "Liquidado" },
      { value: "baixado", label: "Baixado" },
      { value: "cancelado", label: "Cancelado" },
      { value: "erro", label: "Erro" },
    ],
  },
  { name: "linha_digitavel", label: "Linha digitável", span: 2 },
  { name: "pdf_url", label: "Link do PDF", span: 2 },
  { name: "centro_id", label: "Centro de custo", type: "ref", ref: { table: "centros", labelField: "nome" } },
];

function BoletosPage() {
  return (
    <ErpLayout
      title="Boletos"
      description="Cadastro e acompanhamento dos boletos gerados a partir do contas a receber."
    >
      <CrudPage
        table="boletos"
        fields={fields}
        orderBy="vencimento"
        emptyLabel="Nenhum boleto registrado ainda."
        searchColumns={["nosso_numero", "seu_numero", "linha_digitavel", "status"]}
      />
    </ErpLayout>
  );
}
