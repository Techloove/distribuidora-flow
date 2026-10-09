import { crc16 } from "./sicredi-cnab";
import type { LinhaExtrato } from "./rotinas-distribuidora";

export function gerarPixChave(
  chave: string,
  nome: string,
  cidade: string,
  valor: number,
  txid: string,
) {
  if (
    !chave ||
    new TextEncoder().encode(chave).length > 77 ||
    /[\s<>]/.test(chave) ||
    !/^[0-9]{11}$|^[0-9A-Z]{12}[0-9]{2}$|^\+[1-9][0-9]{9,14}$|^[^@\s]+@[^@\s]+\.[^@\s]+$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      chave,
    ) ||
    Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001 ||
    !Number.isFinite(valor) ||
    valor <= 0 ||
    valor > 999999999.99 ||
    !/^[A-Za-z0-9]{1,25}$/.test(txid)
  )
    throw new Error("Dados Pix inválidos.");
  const ascii = (s: string, max: number) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .trim()
      .toUpperCase()
      .slice(0, max);
  const name = ascii(nome, 25),
    city = ascii(cidade, 15);
  if (!name || !city) throw new Error("Informe beneficiário e cidade da conta Pix.");
  const tlv = (id: string, value: string) => {
    const size = new TextEncoder().encode(value).length;
    if (size > 99) throw new Error("Campo Pix excede limite.");
    return id + String(size).padStart(2, "0") + value;
  };
  const payload =
    tlv("00", "01") +
    tlv("01", "11") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", valor.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", tlv("05", txid)) +
    "6304";
  return payload + crc16(payload);
}

/** OFX com FITID estável; aceita SGML e XML sem resolver entidades externas. */
export function lerExtratoOfx(
  texto: string,
  conta?: { banco: string; agencia: string; numero: string },
): LinhaExtrato[] {
  if (texto.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(texto))
    throw new Error("Arquivo OFX inválido ou excede 2 MB.");
  const tag = (s: string, t: string) =>
    s.match(new RegExp(`<${t}>\\s*([^<\\r\\n]+)`, "i"))?.[1]?.trim() ?? "";
  if (
    (texto.match(/<BANKACCTFROM>/gi) ?? []).length > 1 ||
    (texto.match(/<STMTRS>/gi) ?? []).length > 1
  )
    throw new Error("Importe apenas uma conta por arquivo OFX.");
  if (conta) {
    const norm = (v: string) =>
      v
        .replace(/[^A-Za-z0-9]/g, "")
        .replace(/^0+/, "")
        .toUpperCase();
    if (
      !conta.numero ||
      !conta.agencia ||
      !tag(texto, "ACCTID") ||
      norm(tag(texto, "ACCTID")) !== norm(conta.numero) ||
      norm(tag(texto, "BANKID")) !== norm(conta.banco) ||
      (tag(texto, "BRANCHID") && norm(tag(texto, "BRANCHID")) !== norm(conta.agencia))
    )
      throw new Error("Banco, agência ou conta do OFX divergem do cadastro selecionado.");
  }
  const transacoes = [
    ...texto.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi),
  ];
  if (!transacoes.length || transacoes.length > 1000)
    throw new Error("OFX sem lançamentos ou acima de 1000 linhas.");
  const ids = new Set<string>();
  return transacoes.map((m) => {
    const s = m[1]!,
      raw = tag(s, "DTPOSTED").slice(0, 8),
      data = raw.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
      valor = Number(tag(s, "TRNAMT").replace(",", ".")),
      referencia = tag(s, "FITID");
    if (
      !referencia ||
      referencia.length > 120 ||
      ids.has(referencia) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data) ||
      !Number.isFinite(valor) ||
      valor === 0 ||
      new Date(data + "T12:00:00Z").toISOString().slice(0, 10) !== data
    )
      throw new Error("OFX com referência duplicada, data ou valor inválido.");
    ids.add(referencia);
    return {
      referencia,
      data,
      valor,
      descricao: (tag(s, "MEMO") || tag(s, "NAME") || "Lançamento OFX").slice(0, 500),
    };
  });
}
export type XmlCompra = {
  chave: string;
  numero: string;
  data: string;
  documento_emitente: string;
  nome: string;
  frete: number;
  desconto: number;
  total: number;
  extras: number;
  itens: {
    codigo: string;
    descricao: string;
    unidade: string;
    quantidade: number;
    valor: number;
  }[];
};
/** Lê somente dados de compra; o arquivo não executa instruções nem valida assinatura da SEFAZ. */
export function lerXmlCompra(texto: string): XmlCompra {
  if (texto.length > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(texto))
    throw new Error("XML inválido ou acima de 5 MB.");
  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML malformado.");
  const one = (el: Document | Element, name: string) => el.getElementsByTagNameNS("*", name)[0];
  const text = (el: Document | Element, name: string) => one(el, name)?.textContent?.trim() ?? "";
  const n = (el: Document | Element, name: string) => {
    const raw = text(el, name);
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`Valor inválido: ${name}`);
    return v;
  };
  const inf = one(doc, "infNFe"),
    emit = one(doc, "emit"),
    total = one(doc, "ICMSTot"),
    ide = one(doc, "ide"),
    protocolo = one(doc, "infProt");
  if (
    !inf ||
    !emit ||
    !total ||
    !ide ||
    !protocolo ||
    !["100", "150"].includes(text(protocolo, "cStat"))
  )
    throw new Error("Use XML de NF-e de compra com protocolo de autorização.");
  const chave = (inf.getAttribute("Id") ?? "").replace(/^NFe/, "");
  if (!/^\d{44}$/.test(chave) || text(protocolo, "chNFe") !== chave)
    throw new Error("Chave do XML e protocolo divergentes.");
  const itens = Array.from(inf.getElementsByTagNameNS("*", "det")).map((d) => {
    const p = one(d, "prod");
    if (!p) throw new Error("Produto ausente no XML.");
    return {
      codigo: text(p, "cProd"),
      descricao: text(p, "xProd"),
      unidade: text(p, "uCom"),
      quantidade: n(p, "qCom"),
      valor: n(p, "vProd"),
    };
  });
  if (!itens.length || itens.length > 500 || itens.some((i) => i.quantidade <= 0))
    throw new Error("Quantidade ou número de itens inválido.");
  return {
    chave,
    numero: text(ide, "nNF"),
    data: (text(ide, "dhEmi") || text(ide, "dEmi")).slice(0, 10),
    documento_emitente: text(emit, "CNPJ") || text(emit, "CPF"),
    nome: text(emit, "xNome"),
    frete: n(total, "vFrete"),
    desconto: n(total, "vDesc"),
    total: n(total, "vNF"),
    extras: n(total, "vSeg") + n(total, "vOutro") + n(total, "vIPI") + n(total, "vST"),
    itens,
  };
}
