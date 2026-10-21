import { z } from "zod";
import { UFS_FISCAIS, pendenciasProdutoFiscal, type ProdutoFiscal } from "./faznotas";

export const CAMPOS_ICMS = [
  ["aliquota-icms", "ICMS (%)"],
  ["aliquota-icms-st", "ICMS ST (%)"],
  ["aliquota-icms-desonerado", "ICMS desonerado (%)"],
  ["aliquota-icms-nao-contribuintes", "ICMS não contribuinte (%)"],
  ["aliquota-mva", "MVA (%)"],
  ["aliquota-interna-uf-destino", "Alíquota interna de destino (%)"],
  ["aliquota-fcp-interno", "FCP interno (%)"],
  ["aliquota-fcp-destino", "FCP destino (%)"],
  ["percentual-icms-st-ret", "ICMS ST retido (%)"],
  ["percentual-credito-icms", "Crédito ICMS (%)"],
  ["percentual-diferimento", "Diferimento (%)"],
  ["percentual-reducao-bc", "Redução da base (%)"],
  ["percentual-reducao-bc-st", "Redução da base ST (%)"],
  ["codigo-beneficiario", "Código de benefício fiscal (cBenef)"],
] as const;
export const CAMPOS_CBS = [
  ["percentual-cbs", "CBS (%)"],
  ["percentual-ibs", "IBS (%)"],
  ["percentual-diferimento-cbs", "Diferimento CBS (%)"],
  ["percentual-devolucao-cbs", "Devolução CBS (%)"],
  ["percentual-diferimento-ibs", "Diferimento IBS (%)"],
  ["percentual-devolucao-ibs", "Devolução IBS (%)"],
] as const;
const taxa = (max = 100) =>
  z
    .string()
    .regex(/^\d{1,4}(\.\d{1,6})?$/, "Use percentual decimal sem sinal, com ponto")
    .refine((s) => Number(s) <= max, `Percentual máximo: ${max}`);
const codigo = (n: number) =>
  z
    .string({
      required_error: "Campo obrigatório",
      invalid_type_error: "Informe um código textual",
    })
    .regex(new RegExp(`^\\d{${n}}$`), `Informe ${n} dígitos`);
const mapaIcms = Object.fromEntries(
  CAMPOS_ICMS.map(([k]) => [
    k,
    (k === "codigo-beneficiario"
      ? z.string().regex(/^[A-Z0-9]{8}$/, "cBenef deve conter 8 letras ou dígitos")
      : taxa(k === "aliquota-mva" ? 1000 : 100)
    ).optional(),
  ]),
);
const mapaCbs = Object.fromEntries(CAMPOS_CBS.map(([k]) => [k, taxa().optional()]));
const estadoSchema = z
  .object({
    estado: z.string().refine((s) => UFS_FISCAIS.includes(s), "UF inválida"),
    "icms-cst": z.string().regex(/^\d{2,3}$/, "Informe CST/CSOSN com 2 ou 3 dígitos"),
    "modalidade-base-calculo": z.enum(["0", "1", "2", "3", "4", "5"]).optional(),
    aliquotas: z.object(mapaIcms).strict().optional(),
  })
  .strict();
export const tributosSchema = z
  .object({
    icms: z
      .object({
        estados: z
          .array(estadoSchema)
          .max(27)
          .refine((a) => new Set(a.map((s) => s.estado)).size === a.length, "UF repetida"),
      })
      .strict()
      .optional(),
    ipi: z
      .object({ "ipi-cst": codigo(2), "ipi-aliquota": taxa().optional() })
      .strict()
      .optional(),
    "pis-cofins": z
      .object({
        "pis-cst": codigo(2),
        "pis-aliquota": taxa().optional(),
        "cofins-cst": codigo(2),
        "cofins-aliquota": taxa().optional(),
      })
      .strict()
      .optional(),
    "cbs-ibs": z
      .object({
        "cbs-ibs-cst": codigo(3),
        classificacao: codigo(6),
        aliquotas: z.object(mapaCbs).strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EstadoIcms = {
  estado: string;
  "icms-cst": string;
  "modalidade-base-calculo"?: "0" | "1" | "2" | "3" | "4" | "5" | undefined;
  aliquotas?: Record<string, string>;
};
export type TributosConfig = z.infer<typeof tributosSchema>;
export const CSOSN = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"];
export const CST_ICMS = [
  "00",
  "02",
  "10",
  "15",
  "20",
  "30",
  "40",
  "41",
  "50",
  "51",
  "53",
  "60",
  "61",
  "70",
  "90",
];
export function pendenciasTributacao(
  config: TributosConfig,
  cfop: string,
  ufEmitente: string,
  crt: string,
  aceitaPadrao: boolean,
): string[] {
  const erros: string[] = [];
  const parse = tributosSchema.safeParse(config);
  if (!parse.success) return parse.error.issues.map((i) => `${i.path.join(" → ")}: ${i.message}`);
  if (!/^[56]\d{3}$/.test(cfop))
    erros.push("Informe um CFOP de saída com 4 dígitos, começando com 5 ou 6");
  if (!config.icms?.estados.length) erros.push("Cadastre o ICMS de pelo menos uma UF de destino");
  for (const estado of config.icms?.estados ?? []) {
    if ((estado.estado === ufEmitente) !== cfop.startsWith("5"))
      erros.push(`CFOP incompatível com a UF ${estado.estado}`);
    const codigos = ["1", "4"].includes(crt) ? CSOSN : CST_ICMS;
    if (!codigos.includes(estado["icms-cst"]))
      erros.push(`CST/CSOSN de ${estado.estado} incompatível com o CRT da loja`);
  }
  if (!config["pis-cofins"]) erros.push("Informe CST de PIS e COFINS");
  if (!config["cbs-ibs"] && !aceitaPadrao)
    erros.push("Configure IBS/CBS ou confirme expressamente o uso dos padrões do provedor");
  if (
    config["cbs-ibs"] &&
    (config["cbs-ibs"].aliquotas["percentual-cbs"] === undefined ||
      config["cbs-ibs"].aliquotas["percentual-ibs"] === undefined)
  )
    erros.push("Informe as alíquotas de CBS e IBS, incluindo zero quando aplicável");
  return erros;
}
/** Monta apenas cadastro do produto, nunca uma requisição de emissão. CEST/EAN não constam no schema Produto recebido. */
export function prepararProdutoFaznotas(
  produto: ProdutoFiscal & { codigo: string; descricao: string },
  regras: { cfop: string; configuracoes: TributosConfig; revisao_valida: boolean }[],
) {
  if (!produto.codigo?.trim() || !produto.descricao?.trim())
    throw new Error("Informe código e descrição do produto");
  if (regras.some((r) => !/^[56]\d{3}$/.test(r.cfop))) throw new Error("CFOP de saída inválido");
  const pendencias = pendenciasProdutoFiscal(produto);
  if (pendencias.length) throw new Error(pendencias.join("; "));
  if (!regras.length || regras.some((r) => !r.revisao_valida))
    throw new Error(
      "Todas as regras devem estar revisadas e atualizadas antes de preparar o produto",
    );
  if (new Set(regras.map((r) => r.cfop)).size !== regras.length)
    throw new Error("CFOP repetido na configuração do produto");
  return {
    referencia: produto.codigo,
    nome: produto.descricao,
    medida: produto.unidade,
    ncm: produto.ncm,
    origem: produto.origem_fiscal,
    "tipo-produto": "P",
    "configuracoes-fiscais": regras.map((r) => ({
      cfop: r.cfop,
      configuracoes: tributosSchema.parse(r.configuracoes),
    })),
  };
}
