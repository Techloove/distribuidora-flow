import { createHash } from "node:crypto";
import { selecionarCfop } from "./faznotas";
import {
  pendenciasTributacao,
  prepararProdutoFaznotas,
  type TributosConfig,
} from "./faznotas-tributos";
export type DbFiscal = Record<string, unknown>;
export type ContextoNfe = {
  dados: {
    nota: DbFiscal;
    pedido: DbFiscal;
    cliente: DbFiscal;
    pessoa: DbFiscal | null;
    loja: DbFiscal;
    fiscal: DbFiscal | null;
    liberacao: DbFiscal | null;
    itens: {
      item: DbFiscal;
      produto: DbFiscal;
      regras: {
        cfop: string;
        configuracoes: TributosConfig;
        revisao_valida: boolean;
        aceita_padrao_ibs_cbs: boolean;
      }[];
    }[];
    faturas: { valor: unknown; data: string }[];
  };
  versao: string;
  vinculada: boolean;
};
export type OpcoesNfe = {
  cfop?: string | undefined;
  consumidor: "0" | "1";
  indicadorIe: "1" | "2" | "9";
  modalidade: "0" | "1" | "2" | "3" | "4" | "9";
};
const txt = (v: unknown) => String(v ?? "").trim();
const normal = (v: unknown) =>
  txt(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
const doc = (v: unknown) =>
  txt(v)
    .replace(/[./\s-]/g, "")
    .toUpperCase();
export function documentoValidoNfe(v: string) {
  if (/^(\d)\1+$/.test(v)) return false;
  if (/^\d{11}$/.test(v)) {
    for (let n = 9; n < 11; n++) {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += Number(v[i]) * (n + 1 - i);
      let d = (soma * 10) % 11;
      if (d === 10) d = 0;
      if (d !== Number(v[n])) return false;
    }
    return true;
  }
  if (!/^[A-Z0-9]{12}\d{2}$/.test(v)) return false;
  for (let n = 12; n < 14; n++) {
    let soma = 0,
      peso = n === 12 ? 5 : 6;
    for (let i = 0; i < n; i++) {
      soma += (v.charCodeAt(i) - 48) * peso;
      if (--peso === 1) peso = 9;
    }
    const r = soma % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(v[n])) return false;
  }
  return true;
}
const escala = 10_000_000_000n;
function inteiro(v: unknown, casas: number): bigint {
  const s = txt(v) || "0";
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Valor monetário ou quantidade inválida");
  const [a, b = ""] = s.split(".");
  if (b.slice(casas).replace(/0/g, ""))
    throw new Error("Precisão de valor incompatível com a nota");
  return BigInt(a!) * 10n ** BigInt(casas) + BigInt(b.slice(0, casas).padEnd(casas, "0") || "0");
}
const arredondar = (n: bigint, d: bigint) => (n + d / 2n) / d;
function decimal(n: bigint, casas: number) {
  const base = 10n ** BigInt(casas);
  return `${n / base}.${String(n % base).padStart(casas, "0")}`;
}
/** Rateia desconto do cabeçalho em centavos sem perder o total financeiro. */
export function ratearDescontoNfe(totais: bigint[], desconto: bigint) {
  const soma = totais.reduce((a, b) => a + b, 0n);
  if (desconto < 0n || desconto > soma || soma <= 0n)
    throw new Error("Desconto incompatível com os itens");
  const partes = totais.map((t, i) => ({
    i,
    v: (t * desconto) / soma,
    resto: (t * desconto) % soma,
  }));
  let sobra = desconto - partes.reduce((a, p) => a + p.v, 0n);
  for (const p of [...partes].sort((a, b) =>
    a.resto > b.resto ? -1 : a.resto < b.resto ? 1 : a.i - b.i,
  )) {
    if (sobra-- <= 0n) break;
    p.v++;
  }
  return partes.map((p) => p.v);
}
export function prepararDocumentoNfe(
  contexto: ContextoNfe,
  opcoes: OpcoesNfe,
  cep: { uf: string; localidade: string },
) {
  const { nota, pedido, loja, fiscal, liberacao, itens, faturas } = contexto.dados;
  if (contexto.vinculada)
    throw new Error("Nota já vinculada à FAZNOTAS. Acompanhe o envio existente");
  if (!liberacao || liberacao["liberado"] !== true || liberacao["atual"] !== true)
    throw new Error(
      "Administrador deve liberar a emissão na configuração da loja para o ambiente confirmado com a FAZNOTAS",
    );
  if (!fiscal || fiscal["revisado_contador"] !== true)
    throw new Error("Revise a preparação fiscal da loja antes de emitir");
  if (txt(nota["status"]) !== "pendente" || txt(nota["nf_numero"]) || txt(nota["chave_acesso"]))
    throw new Error("Nota já emitida ou fora da situação pendente");
  if (!itens.length || itens.length > 200)
    throw new Error("A emissão suporta entre 1 e 200 itens por documento");
  if (!/^[1-9]\d{0,2}$/.test(txt(fiscal["serie"]))) throw new Error("Série fiscal inválida");
  const cnpj = doc(loja["cnpj"]);
  if (!/^\d{14}$/.test(cnpj) || !documentoValidoNfe(cnpj))
    throw new Error(
      "Confira o CNPJ do emitente. CNPJ alfanumérico de emitente requer validação específica do provedor",
    );
  if (normal(loja["uf"]) !== normal(fiscal["uf_emitente"]))
    throw new Error("UF da preparação fiscal diverge do cadastro da loja");
  for (const campo of [
    "inscricao_estadual",
    "logradouro",
    "numero",
    "bairro",
    "cidade",
    "uf",
    "cep",
  ])
    if (!txt(loja[campo]))
      throw new Error(`Complete ${campo.replace(/_/g, " ")} no cadastro da loja`);
  const cliente = { ...contexto.dados.cliente, ...(contexto.dados.pessoa ?? {}) };
  const documento = doc(cliente["cnpj_cpf"]);
  if (!documentoValidoNfe(documento))
    throw new Error("CPF/CNPJ do cliente inválido. Corrija o cadastro unificado");
  const tipo = txt(cliente["tipo_pessoa"]) === "PF" ? "F" : "J";
  if ((tipo === "F" && documento.length !== 11) || (tipo === "J" && documento.length !== 14))
    throw new Error("Tipo de pessoa incompatível com CPF/CNPJ do cliente");
  for (const campo of ["razao_social", "logradouro", "numero", "bairro", "cidade", "uf", "cep"])
    if (!txt(cliente[campo]))
      throw new Error(`Complete ${campo.replace(/_/g, " ")} no cadastro do cliente`);
  if (!/^\d{8}$/.test(txt(cliente["cep"]).replace(/\D/g, "")))
    throw new Error("CEP do cliente inválido");
  if (normal(cep.localidade) !== normal(cliente["cidade"]))
    throw new Error("Cidade do cadastro diverge da consulta do CEP. Corrija o endereço do cliente");
  const ie = txt(cliente["inscricao_estadual"]);
  if (opcoes.indicadorIe === "1" && (!ie || normal(ie) === "ISENTO"))
    throw new Error("Cliente contribuinte precisa de inscrição estadual válida");
  if (opcoes.indicadorIe === "2" && ie && normal(ie) !== "ISENTO")
    throw new Error("Cliente isento possui IE preenchida. Confira o indicador e o cadastro");
  const regraLoja = {
    uf_emitente: txt(fiscal["uf_emitente"]),
    cfop_interno: txt(fiscal["cfop_interno"]),
    cfop_interestadual: txt(fiscal["cfop_interestadual"]),
    revisado_contador: true,
  };
  const totais = itens.map((i) => inteiro(i.item["total"], 2));
  const soma = totais.reduce((a, b) => a + b, 0n);
  if (soma !== inteiro(pedido["total_itens"], 2))
    throw new Error("Total dos itens diverge do pedido. Confira o documento antes de emitir");
  const desconto =
    inteiro(pedido["desconto_valor"], 2) + inteiro(pedido["forma_desconto_valor"], 2);
  const rateio = ratearDescontoNfe(totais, desconto);
  const frete = inteiro(pedido["frete_valor"], 2) + inteiro(pedido["frete_volume_valor"], 2);
  const despesas =
    inteiro(pedido["outras_despesas"], 2) + inteiro(pedido["forma_acrescimo_valor"], 2);
  const total = soma - desconto + frete + despesas;
  if (
    total <= 0n ||
    total !== inteiro(pedido["total_liquido"], 2) ||
    total !== inteiro(nota["valor_total"], 2)
  )
    throw new Error(
      "Totais do pedido e da nota não conferem. Refaça o faturamento antes da emissão",
    );
  if (opcoes.modalidade === "9" && frete > 0n)
    throw new Error("Documento com frete cobrado não pode usar modalidade sem transporte");
  const produtos: ReturnType<typeof prepararProdutoFaznotas>[] = [];
  const linhas = itens.map(({ item, produto, regras }, indice) => {
    const p = {
      ...produto,
      codigo: txt(produto["codigo"]),
      descricao: txt(produto["descricao"]),
      ncm: txt(produto["ncm"]),
      cest: txt(produto["cest"]),
      ean: txt(produto["ean"]),
      unidade: txt(produto["unidade"]),
      origem_fiscal: txt(produto["origem_fiscal"]),
      cfop: txt(produto["cfop"]),
      cfop_interestadual: txt(produto["cfop_interestadual"]),
    };
    const automatico = selecionarCfop(regraLoja, cep.uf, txt(cliente["uf"]), p);
    const cfop = opcoes.cfop || automatico;
    if (!/^[56]\d{3}$/.test(cfop) || cfop[0] !== automatico[0])
      throw new Error("CFOP escolhido incompatível com a UF de destino");
    if (opcoes.indicadorIe === "9" && ["6101", "6102"].includes(cfop))
      throw new Error(
        "Venda interestadual a não contribuinte: selecione o CFOP específico da operação, confirmado pelo contador, e cadastre sua tributação. O CFOP genérico não será aplicado automaticamente",
      );
    if (opcoes.indicadorIe !== "9" && ["6107", "6108"].includes(cfop))
      throw new Error(
        "O CFOP escolhido é destinado a não contribuintes. Confira a situação da IE e a operação",
      );
    const regra = regras.find((r) => r.cfop === cfop);
    if (!regra?.revisao_valida)
      throw new Error(
        `${p.codigo} · ${p.descricao}: CFOP ${cfop} sem tributação revisada e atualizada`,
      );
    const tributacao = structuredClone(regra.configuracoes);
    const estado = tributacao.icms?.estados.find((e) => e.estado === normal(cep.uf));
    if (!estado) throw new Error(`${p.codigo}: falta ICMS para ${cep.uf} no CFOP ${cfop}`);
    tributacao.icms = { estados: [estado] };
    const faltas = pendenciasTributacao(
      tributacao,
      cfop,
      regraLoja.uf_emitente,
      txt(fiscal["regime"]),
      regra.aceita_padrao_ibs_cbs,
    );
    if (faltas.length) throw new Error(`${p.codigo}: ${faltas.join("; ")}`);
    const cadastrado = prepararProdutoFaznotas(p, [{ ...regra, configuracoes: tributacao }]);
    // Referência imutável por nota/item: não altera a tributação de produto de outra emissão em andamento.
    cadastrado.referencia = `CPR${createHash("sha256")
      .update(txt(nota["id"]) + ":" + indice + ":" + JSON.stringify(cadastrado))
      .digest("hex")
      .slice(0, 32)}`;
    produtos.push(cadastrado);
    const q = inteiro(item["quantidade"], 3),
      preco = inteiro(item["preco_unitario"], 10),
      alvo = totais[indice]! - rateio[indice]!;
    if (q <= 0n) throw new Error("Quantidade inválida");
    const bruto = arredondar(q * preco * 100n, 1000n * escala);
    if (totais[indice]! > bruto)
      throw new Error("Valor do item supera o preço unitário. Confira o pedido");
    const liquido = alvo === bruto ? preco : arredondar(alvo * 1000n * escala, 100n * q);
    if (liquido > preco || arredondar(q * liquido * 100n, 1000n * escala) !== alvo)
      throw new Error("Não foi possível representar o desconto deste item com precisão fiscal");
    return {
      produto: cadastrado.referencia,
      quantidade: decimal(q, 3),
      "valor-unitario": decimal(preco, 10),
      "desconto-unitario": decimal(preco - liquido, 10),
      cfop,
    };
  });
  const cfops = [...new Set(linhas.map((i) => i.cfop))];
  if (cfops.length !== 1)
    throw new Error(
      "Pedido com múltiplos CFOPs: confirme com a FAZNOTAS o suporte a CFOP por item antes de emitir. O contrato recebido só expõe CFOP no cabeçalho",
    );
  const nome = txt(cliente["razao_social"]);
  const clienteApi = {
    tipo,
    ...(tipo === "J" ? { "razao-social": nome, cnpj: documento } : { nome, cpf: documento }),
    "tipo-inscricao-estadual": opcoes.indicadorIe,
    ...(opcoes.indicadorIe === "1"
      ? { "inscricao-estadual": ie }
      : opcoes.indicadorIe === "2"
        ? { "inscricao-estadual": "ISENTO" }
        : {}),
    "consumidor-final": opcoes.consumidor,
    endereco: {
      cep: txt(cliente["cep"]).replace(/\D/g, ""),
      rua: txt(cliente["logradouro"]),
      numero: txt(cliente["numero"]),
      bairro: txt(cliente["bairro"]),
      cidade: cep.localidade,
      estado: normal(cep.uf),
      ...(txt(cliente["complemento"]) ? { complemento: txt(cliente["complemento"]) } : {}),
    },
  };
  const faturasValidas =
    faturas.length > 0 &&
    faturas.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.data)) &&
    faturas.reduce((a, f) => a + inteiro(f.valor, 2), 0n) === total;
  const emissao = {
    serie: txt(fiscal["serie"]),
    "numero-origem": `CPR-NFE-${txt(nota["id"])}`,
    tipo: "S",
    finalidade: "N",
    cfop: cfops[0]!,
    cliente: clienteApi,
    itens: linhas.map(({ cfop: _cfop, ...i }) => i),
    "valor-despesas": decimal(despesas, 2),
    transporte: { modalidade: opcoes.modalidade, "valor-frete": decimal(frete, 2) },
    ...(faturasValidas
      ? { faturas: faturas.map((f) => ({ valor: decimal(inteiro(f.valor, 2), 2), data: f.data })) }
      : {}),
    ...(txt(pedido["observacoes"])
      ? { observacao: txt(pedido["observacoes"]).slice(0, 2000) }
      : {}),
  };
  return {
    cnpj,
    ambiente: txt(liberacao["ambiente"]),
    emissao,
    produtos,
    total: decimal(total, 2),
    avisos: [
      ...(!faturasValidas && faturas.length
        ? [
            "Parcelas não incluídas na NF porque sua soma diverge do total fiscal (por exemplo, crédito de devolução). Os títulos existentes não serão alterados.",
          ]
        : []),
      "A SEFAZ e a FAZNOTAS apuram os impostos conforme as regras cadastradas. Confira o total autorizado no XML/DANFE.",
    ],
  };
}
export type SnapshotNfe = ReturnType<typeof prepararDocumentoNfe>;
export function hashPreviaNfe(snapshot: SnapshotNfe) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
