type CampoSicredi = {
  name: string;
  label: string;
  type?: "text" | "number" | "password";
  span?: number;
  hint?: string;
  options?: { value: string; label: string }[];
};

/** Campos conforme a API de cobranca do Sicredi. */
export const gruposSicredi: { titulo: string; campos: CampoSicredi[] }[] = [
  {
    titulo: "Convênio Sicredi · este centro de custo",
    campos: [
      { name: "cooperativa", label: "Cooperativa" },
      { name: "posto", label: "Posto" },
      { name: "codigo_beneficiario", label: "Código do beneficiário" },
      {
        name: "ambiente",
        label: "Ambiente da API",
        options: [
          { value: "homologacao", label: "Homologação (sandbox)" },
          { value: "producao", label: "Produção" },
        ],
      },
    ],
  },
  {
    titulo: "Acesso à API Sicredi",
    campos: [
      {
        name: "api_key",
        label: "Chave de API de produção (x-api-key)",
        type: "password",
        span: 2,
        hint: "Por segurança, a chave atual nunca é enviada ao navegador. Deixe em branco para manter a existente.",
      },
      {
        name: "sandbox_api_key",
        label: "Chave de API do sandbox (x-api-key)",
        type: "password",
        span: 2,
        hint: "Use a chave de homologação liberada pelo Sicredi. Em branco mantém a atual.",
      },
      { name: "username", label: "Usuário de produção (beneficiário + cooperativa)" },
      {
        name: "password",
        label: "Código de acesso de produção",
        type: "password",
        hint: "A senha atual fica somente no servidor. Deixe em branco para manter a existente.",
      },
    ],
  },
  {
    titulo: "Boleto",
    campos: [
      {
        name: "tipo_cobranca",
        label: "Tipo de cobrança",
        options: [{ value: "NORMAL", label: "Normal (só boleto)" }],
      },
      {
        name: "especie_documento",
        label: "Espécie do documento",
        options: [
          { value: "DUPLICATA_MERCANTIL_INDICACAO", label: "Duplicata mercantil" },
          { value: "DUPLICATA_SERVICO_INDICACAO", label: "Duplicata de serviço" },
          { value: "NOTA_PROMISSORIA", label: "Nota promissória" },
          { value: "OUTROS", label: "Outros" },
        ],
      },
      { name: "informativo", label: "Informativo do boleto", span: 2 },
      { name: "mensagem", label: "Mensagem ao pagador", span: 2 },
    ],
  },
  {
    titulo: "Juros e multa",
    campos: [
      {
        name: "tipo_juro",
        label: "Tipo de juro",
        options: [
          { value: "ISENTO", label: "Isento" },
          { value: "PERCENTUAL", label: "Percentual ao mês" },
          { value: "VALOR", label: "Valor por dia" },
        ],
      },
      { name: "juros", label: "Juros (% mês ou valor/dia)", type: "number" },
      { name: "multa", label: "Multa (%)", type: "number" },
      {
        name: "dias_multa",
        label: "Multa após (dias do vencimento)",
        type: "number",
        hint: "Quantidade de dias após o vencimento para iniciar a multa.",
      },
    ],
  },
  {
    titulo: "Desconto",
    campos: [
      {
        name: "tipo_desconto",
        label: "Tipo de desconto",
        options: [
          { value: "NAO_TEM_DESCONTO", label: "Sem desconto" },
          { value: "VALOR", label: "Valor fixo" },
          { value: "PERCENTUAL", label: "Percentual" },
        ],
      },
      { name: "valor_desconto1", label: "Valor/percentual do desconto", type: "number" },
      {
        name: "dias_desconto1",
        label: "Desconto até (dias antes do venc.)",
        type: "number",
        hint: "O sistema converte os dias em dataDesconto1 ao emitir o boleto.",
      },
    ],
  },
  {
    titulo: "Protesto / negativação",
    campos: [
      {
        name: "tipo_protesto",
        label: "Instrução",
        options: [
          { value: "SEM_PROTESTO", label: "Sem protesto" },
          { value: "PROTESTAR", label: "Protestar" },
          { value: "NEGATIVAR", label: "Negativar (Serasa)" },
        ],
      },
      { name: "dias_protesto", label: "Protestar após (dias)", type: "number" },
    ],
  },
];

export const numericosSicredi = new Set([
  "juros",
  "multa",
  "dias_multa",
  "valor_desconto1",
  "dias_desconto1",
  "dias_protesto",
  "validade_apos_vencimento",
]);
