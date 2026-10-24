import { z } from "zod";
import { pendenciasProdutoFiscal, validarConfiguracaoFiscal, UFS_FISCAIS } from "./fiscal";

const registro = z.record(z.unknown());
export const contextoForecastSchema = z.object({
  nota: registro,
  pedido: registro,
  loja: registro,
  fiscal: registro,
  cliente: registro,
  conexao: z.object({
    token_configurado: z.boolean(),
    vinculo_atual: z.boolean(),
    cnpj_configurado: z.string().nullable(),
    ambiente_declarado: z.string().nullable(),
  }),
  bloqueio_faturamento: z.string().nullable(),
  itens: z
    .array(z.object({ item: registro, produto: registro, disponivel_loja: z.boolean() }))
    .max(500),
});
export type ContextoForecast = z.infer<typeof contextoForecastSchema>;
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const documento = (v: unknown) => texto(v).replace(/[./-]/g, "").toUpperCase();

// Converter a escala explicitamente, sem arredondar silenciosamente os cadastros.
function decimal(v: unknown, escala: number): bigint {
  if (typeof v !== "number" && typeof v !== "string") throw new Error("Valor ausente");
  const s = String(v);
  if (!/^\d+(\.\d+)?$/.test(s) || s.length > 24) throw new Error("Valor inválido");
  const [inteiro, fracao = ""] = s.split(".");
  if (fracao.slice(escala).replace(/0/g, "")) throw new Error("Precisão não suportada");
  const n =
    BigInt(inteiro!) * 10n ** BigInt(escala) +
    BigInt(fracao.slice(0, escala).padEnd(escala, "0") || "0");
  if (n > 999999999999999n) throw new Error("Valor fora do limite da prévia");
  return n;
}
function formatar(n: bigint, escala: number) {
  const s = n.toString().padStart(escala + 1, "0");
  return `${s.slice(0, -escala)}.${s.slice(-escala)}`;
}
const arredondarCentavos = (numerador: bigint, divisor: bigint) =>
  (numerador + divisor / 2n) / divisor;

/** Rascunho local com os campos documentados. Não é documento pronto para transmissão. */
export function montarPreviaForecast(entrada: unknown) {
  const c = contextoForecastSchema.parse(entrada);
  const pendencias: string[] = [];
  const { nota: n, pedido: p, loja: l, fiscal: f, cliente: d } = c;
  const cnpj = documento(l["cnpj"]);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) pendencias.push("Complete o CNPJ da loja.");
  if (
    !c.conexao.token_configurado ||
    !c.conexao.vinculo_atual ||
    c.conexao.cnpj_configurado !== cnpj
  )
    pendencias.push("Configure o vínculo Forecast para o CNPJ atual da loja.");
  if (c.conexao.ambiente_declarado !== "homologacao")
    pendencias.push(
      "Cadastre um token declarado de homologação para esta loja; produção não pode ser usada nesta prévia.",
    );
  if (
    l["id"] !== n["centro_id"] ||
    p["centro_id"] !== l["id"] ||
    n["pedido_id"] !== p["id"] ||
    n["cliente_id"] !== p["cliente_id"]
  )
    pendencias.push("Nota, pedido e loja possuem vínculos divergentes.");
  if (
    !["pendente", "rejeitada"].includes(texto(n["status"])) ||
    texto(n["chave_acesso"]) ||
    texto(n["nf_numero"]) ||
    texto(n["protocolo"])
  )
    pendencias.push(
      "Use uma nota pendente ou rejeitada, sem número, chave ou protocolo de autorização.",
    );
  if (
    !["faturado", "conferido", "em_carga", "em_rota", "entregue", "parcial"].includes(
      texto(p["status"]),
    )
  )
    pendencias.push("Pedido ainda não está liberado para conferência fiscal.");
  if (c.bloqueio_faturamento) pendencias.push(`Confira o faturamento: ${c.bloqueio_faturamento}`);
  const fiscal = {
    serie: texto(f["serie"]),
    regime: texto(f["regime"]),
    uf_emitente: texto(f["uf_emitente"]),
    cfop_interno: texto(f["cfop_interno"]),
    cfop_interestadual: texto(f["cfop_interestadual"]),
    revisado_contador: f["revisado_contador"] === true,
  };
  pendencias.push(...validarConfiguracaoFiscal(fiscal));
  if (!fiscal.revisado_contador)
    pendencias.push("O contador precisa revisar os dados fiscais da loja.");
  if (texto(l["uf"]) !== fiscal.uf_emitente)
    pendencias.push("UF fiscal diverge da UF cadastrada na loja.");
  if (texto(n["serie"]) !== fiscal.serie)
    pendencias.push("Série da nota diverge da série fiscal da loja.");
  const doc = documento(d["cnpj_cpf"]);
  if (!["PF", "PJ"].includes(texto(d["tipo_pessoa"])))
    pendencias.push("Informe o tipo PF ou PJ do destinatário.");
  const indicador = texto(d["indicador_contribuinte_icms"]);
  if (!["1", "2", "9"].includes(indicador))
    pendencias.push("Confira o indicador de inscrição estadual do destinatário.");
  if (indicador === "1" && !texto(d["inscricao_estadual"]))
    pendencias.push("Informe a inscrição estadual do destinatário contribuinte.");
  if (!(texto(d["tipo_pessoa"]) === "PF" ? /^\d{11}$/ : /^[A-Z0-9]{12}\d{2}$/).test(doc))
    pendencias.push("Documento do destinatário inválido ou incompleto.");
  for (const campo of ["razao_social", "logradouro", "numero", "bairro", "cidade"])
    if (!texto(d[campo])) pendencias.push(`Complete ${campo} do destinatário.`);
  if (!UFS_FISCAIS.includes(texto(d["uf"]))) pendencias.push("UF do destinatário inválida.");
  if (!/^\d{8}$/.test(texto(d["cep"]).replace(/[-.]/g, "")))
    pendencias.push("CEP do destinatário inválido.");
  if (!c.itens.length) pendencias.push("A nota não possui itens.");
  let somaLiquida = 0n;
  const items = c.itens.map(({ item: i, produto: pr, disponivel_loja }, index) => {
    const prefixo = `Item ${index + 1}`;
    if (!disponivel_loja || i["produto_id"] !== pr["id"])
      pendencias.push(`${prefixo}: produto indisponível no catálogo desta loja.`);
    const produto = {
      ncm: texto(pr["ncm"]),
      cest: texto(pr["cest"]),
      ean: texto(pr["ean"]),
      unidade: texto(pr["unidade"]),
      origem_fiscal: texto(pr["origem_fiscal"]),
      cfop: texto(pr["cfop"]),
      cfop_interestadual: texto(pr["cfop_interestadual"]),
    };
    pendencias.push(...pendenciasProdutoFiscal(produto).map((e) => `${prefixo}: ${e}.`));
    if (
      !texto(pr["codigo"]) ||
      texto(pr["codigo"]).length > 60 ||
      !texto(pr["descricao"]) ||
      texto(pr["descricao"]).length > 500 ||
      produto.unidade.length > 6
    )
      pendencias.push(`${prefixo}: confira código, descrição e unidade nos limites da Forecast.`);
    const cfop =
      texto(d["uf"]) === fiscal.uf_emitente
        ? produto.cfop || fiscal.cfop_interno
        : produto.cfop_interestadual || fiscal.cfop_interestadual;
    let quantidade = "",
      preco = "",
      bruto = "",
      desconto = "";
    try {
      const q = decimal(i["quantidade"], 4),
        v = decimal(i["preco_unitario"], 10),
        total = decimal(i["total"], 2),
        pct = decimal(i["desconto_percentual"] ?? 0, 4);
      if (q === 0n || v === 0n || pct > 1000000n)
        throw new Error("Quantidade, preço ou desconto inválido");
      const gross = arredondarCentavos(q * v, 10n ** 12n);
      const esperado = arredondarCentavos(q * v * (1000000n - pct), 10n ** 18n);
      const desc = gross - esperado;
      if (total !== esperado || total === 0n)
        throw new Error("Total do item diverge de quantidade, preço e desconto");
      somaLiquida += total;
      quantidade = formatar(q, 4);
      preco = formatar(v, 10);
      bruto = formatar(gross, 2);
      desconto = formatar(desc, 2);
    } catch {
      pendencias.push(
        `${prefixo}: valores ou precisão inválidos; confira quantidade, preço, desconto e total.`,
      );
    }
    return {
      codigo_produto: texto(pr["codigo"]),
      descricao: texto(pr["descricao"]),
      codigo_ncm: produto.ncm,
      ...(produto.cest ? { cest: produto.cest } : {}),
      cfop,
      icms_origem: produto.origem_fiscal,
      unidade_comercial: produto.unidade,
      quantidade_comercial: quantidade,
      valor_unitario_comercial: preco,
      valor_bruto: bruto,
      valor_desconto: desconto,
    };
  });
  let total = "",
    frete = "",
    desconto = "",
    despesas = "";
  try {
    const itens = decimal(p["total_itens"], 2),
      liquido = decimal(p["total_liquido"], 2),
      nota = decimal(n["valor_total"], 2);
    const freight = decimal(p["frete_valor"] ?? 0, 2),
      volume = decimal(p["frete_volume_valor"] ?? 0, 2),
      desc = decimal(p["desconto_valor"] ?? 0, 2) + decimal(p["forma_desconto_valor"] ?? 0, 2);
    const extra =
      decimal(p["outras_despesas"] ?? 0, 2) + decimal(p["forma_acrescimo_valor"] ?? 0, 2);
    // Motor da fase250: frete_valor e frete_volume_valor são encargos distintos.
    if (
      itens !== somaLiquida ||
      liquido !== itens + freight + volume + extra - desc ||
      liquido !== nota ||
      liquido <= 0n
    )
      pendencias.push(
        "Totais da nota e do pedido não conciliam com itens, descontos, frete e despesas.",
      );
    total = formatar(liquido, 2);
    frete = formatar(freight + volume, 2);
    desconto = formatar(desc, 2);
    despesas = formatar(extra, 2);
  } catch {
    pendencias.push("Valores totais ausentes, negativos ou com precisão inválida.");
  }
  const referencia = `CPRHML${texto(n["id"]).replace(/-/g, "")}`;
  const proposta = {
    ref: referencia,
    cnpj_emitente: cnpj,
    ambiente: "HOMOLOGACAO",
    serie: fiscal.serie,
    ...(texto(d["tipo_pessoa"]) === "PF" ? { cpf_destinatario: doc } : { cnpj_destinatario: doc }),
    nome_destinatario: "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL",
    logradouro_destinatario: texto(d["logradouro"]),
    numero_destinatario: texto(d["numero"]),
    bairro_destinatario: texto(d["bairro"]),
    municipio_destinatario: texto(d["cidade"]),
    ...(texto(d["complemento"]) ? { complemento_destinatario: texto(d["complemento"]) } : {}),
    indicador_inscricao_estadual_destinatario: indicador,
    ...(texto(d["inscricao_estadual"])
      ? { inscricao_estadual_destinatario: texto(d["inscricao_estadual"]) }
      : {}),
    uf_destinatario: texto(d["uf"]),
    cep_destinatario: texto(d["cep"]).replace(/[-.]/g, ""),
    valor_total: total,
    valor_frete: frete,
    valor_desconto: desconto,
    valor_outras_despesas: despesas,
    items,
  };
  return {
    nota: texto(n["id"]),
    cnpj_loja: cnpj,
    ambiente: "homologacao" as const,
    emissao_disponivel: false as const,
    cadastro_conferido: pendencias.length === 0,
    pendencias: [...new Set(pendencias)],
    confirmacoes_externas: [
      "Conferir no painel Forecast se o token é realmente de homologação; a declaração local não comprova o ambiente.",
      "Conferir certificado, série e regras tributárias por NCM para este CNPJ com o contador.",
      "Confirmar com a Forecast os tipos de valores, referência/idempotência, pagamentos, endereço/IBGE e os campos fiscais complementares antes da transmissão.",
    ],
    payload_proposto: pendencias.length ? null : proposta,
    mensagem:
      "Prévia local para conferência. Nenhuma chamada de emissão foi feita; nenhum estoque, título ou documento foi alterado.",
  };
}
