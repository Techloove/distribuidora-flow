/** Sicredi CNAB 240, manual v2.9 (02/2026), arquivo 081 / lote 040.
 * Posições abaixo são inclusivas e começam em 1, como no manual do banco.
 */
export const CNAB_LAYOUT = "SICREDI-081-040";
export const CNAB_MANUAL_VERSION = "2.9";
export type CnabConfig = {
  conta_financeira_id: string;
  categoria_tarifa_id: string | null;
  centro_id: string;
  nome: string;
  documento: string;
  cooperativa: string;
  posto: string;
  beneficiario: string;
  conta: string;
  conta_dv: string;
  proxima_remessa: number;
  proximo_nosso_numero: number;
  homologado: boolean;
  juros_mensal: number;
  multa_percentual: number;
  tipo_cobranca?: "NORMAL" | "HIBRIDO";
  chave_pix?: string | null;
};
export type CnabTitulo = {
  conta_id: string;
  documento: string;
  nosso_numero: string;
  valor: string;
  vencimento: string;
  emissao: string;
  nome: string;
  cpf_cnpj: string;
  endereco: string;
  bairro: string;
  cep: string;
  cidade: string;
  uf: string;
};
export type CnabEvento = {
  nosso_numero: string;
  documento: string;
  ocorrencia: string;
  motivos: string;
  valor_titulo: string;
  valor_recebido: string;
  valor_liquido: string;
  juros: string;
  desconto: string;
  abatimento: string;
  iof: string;
  tarifas: string;
  outras_despesas: string;
  outros_creditos: string;
  pix?: { url: string; txid: string; movimento: string };
  vencimento: string | null;
  data_ocorrencia: string | null;
  data_credito: string | null;
};

export function digits(value: string) {
  return value.replace(/[.\-/\s]/g, "");
}
function numeric(value: string | number, size: number) {
  const s = String(value);
  if (!/^\d+$/.test(s) || s.length > size)
    throw new Error(`Campo numérico inválido: ${size} posições.`);
  return s.padStart(size, "0");
}
export function ascii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\x20-\x7e]/g, " ");
}
export function cents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Valor monetário inválido; use até duas casas decimais.");
  const [whole = "", fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > 999999999999999n) throw new Error("Valor excede o limite CNAB.");
  return result;
}
function moneyField(value: string, width = 15) {
  return numeric(cents(value).toString(), width);
}
function readMoney(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Valor não numérico no retorno.");
  return `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;
}
function dateField(iso: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) !== iso
  )
    throw new Error("Data inválida no CNAB.");
  return iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(0, 4);
}
function readDate(s: string) {
  if (s === "00000000") return null;
  const iso = `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
  if (dateField(iso) !== s) throw new Error("Data inválida no retorno.");
  return iso;
}
class Record240 {
  private chars = Array<string>(240).fill(" ");
  put(start: number, end: number, value: string | number, kind: "text" | "num" | "raw" = "text") {
    const size = end - start + 1;
    const formatted =
      kind === "num" ? numeric(value, size) : kind === "raw" ? String(value) : ascii(String(value));
    if (formatted.length > size) throw new Error(`Campo excede posições ${start}-${end}.`);
    this.chars.splice(start - 1, size, ...formatted.padEnd(size, " "));
    return this;
  }
  text() {
    return this.chars.join("");
  }
}
function base(type: string, lote: number) {
  return new Record240().put(1, 3, 748, "num").put(4, 7, lote, "num").put(8, 8, type);
}
function detail(segment: string, seq: number) {
  return base("3", 1).put(9, 13, seq, "num").put(14, 14, segment).put(16, 17, "01");
}

export function validateConfig(c: CnabConfig) {
  if (!/^[a-f0-9-]{36}$/i.test(c.conta_financeira_id))
    throw new Error("Selecione a conta financeira para os recebimentos.");
  if (!c.nome.trim() || c.nome.length > 30)
    throw new Error("Nome do beneficiário deve ter até 30 caracteres.");
  if (!/^(\d{11}|\d{14})$/.test(digits(c.documento)))
    throw new Error("CPF/CNPJ do beneficiário inválido.");
  for (const [name, value, size] of [
    ["Cooperativa", c.cooperativa, 4],
    ["Posto", c.posto, 2],
    ["Beneficiário", c.beneficiario, 5],
  ] as const)
    if (!new RegExp(`^\\d{${size}}$`).test(value))
      throw new Error(`${name} deve ter ${size} dígitos.`);
  if (!/^\d{1,12}$/.test(c.conta) || !/^\d$/.test(c.conta_dv))
    throw new Error("Informe a conta sem DV e o DV separado.");
  if (!Number.isInteger(c.proxima_remessa) || c.proxima_remessa < 1 || c.proxima_remessa > 999999)
    throw new Error("Sequencial de remessa inválido.");
  if (
    !Number.isInteger(c.proximo_nosso_numero) ||
    c.proximo_nosso_numero < 1 ||
    c.proximo_nosso_numero > 99999
  )
    throw new Error("Sequencial de nosso número inválido.");
  if (c.tipo_cobranca && !["NORMAL", "HIBRIDO"].includes(c.tipo_cobranca))
    throw new Error("Tipo de cobrança inválido.");
  if (
    c.tipo_cobranca === "HIBRIDO" &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.chave_pix ?? "")
  )
    throw new Error("Informe a chave PIX aleatória do convênio híbrido, em minúsculas.");
  for (const value of [c.juros_mensal, c.multa_percentual])
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      Math.round(value * 100) / 100 !== value
    )
      throw new Error("Percentual inválido (0–100, até duas casas).");
}

export function nossoNumero(
  c: Pick<CnabConfig, "cooperativa" | "posto" | "beneficiario">,
  year: number,
  seq: number,
) {
  const stem = numeric(year % 100, 2) + "2" + numeric(seq, 5);
  const full = c.cooperativa + c.posto + c.beneficiario + stem;
  let sum = 0,
    weight = 2;
  for (let i = full.length - 1; i >= 0; i--) {
    sum += Number(full[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return stem + (dv > 9 ? "0" : String(dv));
}

export function gerarRemessa(c: CnabConfig, titulos: CnabTitulo[], isoDate: string, time: string) {
  validateConfig(c);
  if (!titulos.length || titulos.length > 500) throw new Error("Selecione de 1 a 500 títulos.");
  if (!/^\d{6}$/.test(time)) throw new Error("Hora inválida.");
  const doc = digits(c.documento),
    type = doc.length === 14 ? "2" : "1",
    date = dateField(isoDate);
  const header = base("0", 0)
    .put(18, 18, type)
    .put(19, 32, doc, "num")
    .put(53, 57, c.cooperativa, "num")
    .put(59, 70, c.conta, "num")
    .put(71, 71, c.conta_dv)
    .put(73, 102, c.nome)
    .put(103, 132, "SICREDI")
    .put(143, 143, "1")
    .put(144, 151, date)
    .put(152, 157, time)
    .put(158, 163, c.proxima_remessa, "num")
    .put(164, 166, "081")
    .put(167, 171, "01600");
  const lot = base("1", 1)
    .put(9, 9, "R")
    .put(10, 11, "01")
    .put(14, 16, "040")
    .put(18, 18, type)
    .put(19, 33, doc, "num")
    .put(54, 58, c.cooperativa, "num")
    .put(60, 71, c.conta, "num")
    .put(72, 72, c.conta_dv)
    .put(74, 103, c.nome)
    .put(184, 191, c.proxima_remessa, "num")
    .put(192, 199, date)
    .put(200, 207, 0, "num");
  const records = [header.text(), lot.text()];
  let seq = 0;
  const seen = new Set<string>();
  for (const t of titulos) {
    if (seen.has(t.nosso_numero)) throw new Error("Nosso número duplicado.");
    seen.add(t.nosso_numero);
    if (!/^\d{9}$/.test(t.nosso_numero) || !t.documento || t.documento.length > 10)
      throw new Error(
        "Nosso número ou documento do título inválido (documento: até 10 caracteres).",
      );
    if (cents(t.valor) <= 0n) throw new Error("Título sem valor para cobrança.");
    if (t.documento.includes(" ")) throw new Error("Seu número não pode conter espaços.");
    if (
      new Date(`${t.vencimento}T12:00:00Z`).getTime() -
        new Date(`${t.emissao}T12:00:00Z`).getTime() <
      7 * 86400000
    )
      throw new Error(
        "Na emissão pelo Sicredi, o vencimento deve ser pelo menos 7 dias após a emissão.",
      );
    if (
      !/^(\d{11}|\d{14})$/.test(digits(t.cpf_cnpj)) ||
      !/^\d{8}$/.test(digits(t.cep)) ||
      !/^[A-Z]{2}$/.test(t.uf)
    )
      throw new Error("CPF/CNPJ, CEP ou UF do pagador inválido.");
    if (![t.nome, t.endereco, t.bairro, t.cidade].every((s) => s.trim()))
      throw new Error("Complete nome e endereço do pagador.");
    const p = detail("P", ++seq)
      .put(18, 22, c.cooperativa, "num")
      .put(24, 35, c.conta, "num")
      .put(36, 36, c.conta_dv)
      .put(38, 57, t.nosso_numero)
      .put(58, 62, "11112") // Sicredi emite; beneficiário distribui.
      .put(63, 77, t.documento)
      .put(78, 85, dateField(t.vencimento))
      .put(86, 100, moneyField(t.valor))
      .put(101, 105, 0, "num")
      .put(107, 108, "03")
      .put(109, 109, "N")
      .put(110, 117, dateField(t.emissao))
      .put(118, 118, c.juros_mensal ? "2" : "3")
      .put(
        119,
        126,
        c.juros_mensal
          ? dateField(
              new Date(new Date(`${t.vencimento}T12:00:00Z`).getTime() + 86400000)
                .toISOString()
                .slice(0, 10),
            )
          : "00000000",
      )
      .put(127, 141, moneyField(String(c.juros_mensal)))
      .put(142, 142, "0")
      .put(143, 150, 0, "num")
      .put(151, 165, 0, "num")
      .put(166, 180, 0, "num")
      .put(181, 195, 0, "num")
      .put(221, 221, "3")
      .put(222, 223, 0, "num")
      .put(224, 224, "1")
      .put(225, 227, "000")
      .put(228, 229, "09")
      .put(230, 239, 0, "num");
    const q = detail("Q", ++seq)
      .put(18, 18, digits(t.cpf_cnpj).length === 14 ? "2" : "1")
      .put(19, 33, digits(t.cpf_cnpj), "num")
      .put(34, 73, ascii(t.nome).slice(0, 40))
      .put(74, 113, ascii(t.endereco).slice(0, 40))
      .put(114, 128, ascii(t.bairro).slice(0, 15))
      .put(129, 136, digits(t.cep), "num")
      .put(137, 151, ascii(t.cidade).slice(0, 15))
      .put(152, 153, t.uf)
      .put(154, 154, "0")
      .put(155, 169, 0, "num")
      .put(210, 212, 0, "num");
    records.push(p.text(), q.text());
    if (c.multa_percentual)
      records.push(
        detail("R", ++seq)
          .put(18, 18, "0")
          .put(19, 26, 0, "num")
          .put(27, 41, 0, "num")
          .put(42, 42, "0")
          .put(43, 50, 0, "num")
          .put(51, 65, 0, "num")
          .put(66, 66, "2")
          .put(
            67,
            74,
            dateField(
              new Date(new Date(`${t.vencimento}T12:00:00Z`).getTime() + 86400000)
                .toISOString()
                .slice(0, 10),
            ),
          )
          .put(75, 89, moneyField(String(c.multa_percentual)))
          .put(200, 207, 0, "num")
          .put(208, 210, 0, "num")
          .put(211, 215, 0, "num")
          .put(216, 216, "0")
          .put(217, 228, 0, "num")
          .put(231, 231, "0")
          .text(),
      );
    if (c.tipo_cobranca === "HIBRIDO")
      records.push(detail("Y", ++seq).put(18, 19, "04").put(82, 158, c.chave_pix!, "raw").text());
  }
  records.push(
    base("5", 1)
      .put(18, 23, seq + 2, "num")
      .put(24, 29, 0, "num")
      .put(30, 46, 0, "num")
      .put(47, 115, 0, "num")
      .text(),
  );
  records.push(
    base("9", 9999)
      .put(18, 23, 1, "num")
      .put(24, 29, records.length + 1, "num")
      .put(30, 35, 0, "num")
      .text(),
  );
  const month = "123456789ABC"[Number(isoDate.slice(5, 7)) - 1];
  return {
    content: records.join("\r\n") + "\r\n",
    filename: `${c.beneficiario}${month}${isoDate.slice(8, 10)}.${numeric(c.proxima_remessa, 6)}`,
  };
}

export const OCORRENCIAS: Record<string, string> = {
  "02": "Entrada confirmada",
  "03": "Entrada rejeitada",
  "06": "Liquidação",
  "09": "Baixa confirmada",
  "14": "Alteração de vencimento confirmada",
  "26": "Instrução rejeitada",
  "17": "Liquidação após baixa",
  "61": "Liquidação PIX",
};
export function parseRetorno(content: string, c: CnabConfig) {
  if (content.length > 2_000_000) throw new Error("Arquivo excede 2 MB.");
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\n/);
  while (lines.at(-1) === "") lines.pop();
  if (lines.length < 6 || lines.some((l) => l.length !== 240 || /[^\x20-\xff]/.test(l)))
    throw new Error("Cada registro deve conter exatamente 240 posições.");
  const field = (s: string, a: number, b: number) => s.slice(a - 1, b);
  const h = lines[0]!;
  if (field(h, 1, 8) !== "74800000" || field(h, 143, 143) !== "2" || field(h, 164, 166) !== "081")
    throw new Error("Retorno deve ser Sicredi, arquivo 081, código retorno 2.");
  if (
    BigInt(field(h, 19, 32)) !== BigInt(digits(c.documento)) ||
    field(h, 53, 57) !== numeric(c.cooperativa, 5) ||
    field(h, 59, 70) !== numeric(c.conta, 12) ||
    field(h, 71, 71) !== c.conta_dv
  )
    throw new Error("Arquivo de outro beneficiário ou conta bancária.");
  const events: CnabEvento[] = [];
  let lot = "",
    count = 0,
    lots = 0,
    seq = 0,
    pending: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!,
      type = field(l, 8, 8),
      lotId = field(l, 4, 7);
    if (field(l, 1, 3) !== "748") throw new Error("Banco divergente no retorno.");
    if (type === "1") {
      if (
        lot ||
        pending ||
        lotId === "0000" ||
        lotId === "9999" ||
        Number(lotId) !== lots + 1 ||
        field(l, 9, 11) !== "T01" ||
        field(l, 14, 16) !== "040"
      )
        throw new Error("Header de lote inválido.");
      if (
        BigInt(field(l, 19, 33)) !== BigInt(digits(c.documento)) ||
        field(l, 54, 58) !== numeric(c.cooperativa, 5) ||
        field(l, 60, 71) !== numeric(c.conta, 12) ||
        field(l, 72, 72) !== c.conta_dv
      )
        throw new Error("Conta divergente no lote.");
      lot = lotId;
      count = 1;
      seq = 0;
      lots++;
      continue;
    }
    if (type === "3") {
      if (
        !lot ||
        lotId !== lot ||
        !/^\d{5}$/.test(field(l, 9, 13)) ||
        Number(field(l, 9, 13)) !== ++seq
      )
        throw new Error("Sequência de detalhes inválida.");
      count++;
      const segment = field(l, 14, 14);
      if (segment === "T") {
        if (pending) throw new Error("Segmento T sem U correspondente.");
        pending = l;
      } else if (segment === "U") {
        if (!pending || field(pending, 16, 17) !== field(l, 16, 17))
          throw new Error("Par T/U incompatível.");
        const nn = field(pending, 38, 57).trim();
        if (!/^\d{9}$/.test(nn)) throw new Error("Nosso número inválido no retorno.");
        events.push({
          nosso_numero: nn,
          documento: field(pending, 59, 73).trim(),
          ocorrencia: field(l, 16, 17),
          motivos: field(pending, 214, 223).trim(),
          vencimento: readDate(field(pending, 74, 81)),
          valor_titulo: readMoney(field(pending, 82, 96)),
          valor_recebido: readMoney(field(l, 78, 92)),
          valor_liquido: readMoney(field(l, 93, 107)),
          juros: readMoney(field(l, 18, 32)),
          desconto: readMoney(field(l, 33, 47)),
          abatimento: readMoney(field(l, 48, 62)),
          iof: readMoney(field(l, 63, 77)),
          tarifas: readMoney(field(pending, 199, 213)),
          outras_despesas: readMoney(field(l, 108, 122)),
          outros_creditos: readMoney(field(l, 123, 137)),
          data_ocorrencia: readDate(field(l, 138, 145)),
          data_credito: readDate(field(l, 146, 153)),
        });
        pending = null;
      } else if (segment === "Y" && field(l, 18, 19) === "04") {
        const previous = events.at(-1);
        if (pending || !previous || previous.pix || field(lines[i - 1]!, 14, 14) !== "U")
          throw new Error("Segmento Y04 sem par T/U correspondente.");
        previous.pix = {
          url: field(l, 82, 158).trim(),
          txid: field(l, 159, 193).trim(),
          movimento: field(l, 16, 17),
        };
        if (previous.pix.url || previous.pix.txid) {
          if (!/^[a-zA-Z0-9]{26,35}$/.test(previous.pix.txid))
            throw new Error("TXID inválido no retorno Y04.");
          gerarBrCode(previous.pix.url);
        }
      } else throw new Error(`Segmento de retorno não suportado: ${segment}.`);
      continue;
    }
    if (type === "5") {
      if (!lot || lotId !== lot || pending || Number(field(l, 18, 23)) !== count + 1)
        throw new Error("Trailer de lote inconsistente.");
      lot = "";
      continue;
    }
    if (
      type === "9" &&
      i === lines.length - 1 &&
      lotId === "9999" &&
      !lot &&
      !pending &&
      Number(field(l, 18, 23)) === lots &&
      Number(field(l, 24, 29)) === lines.length
    )
      continue;
    throw new Error("Estrutura ou totalizadores do arquivo inválidos.");
  }
  if (field(lines.at(-1)!, 8, 8) !== "9" || !events.length || events.length > 500)
    throw new Error("Retorno sem trailer ou fora do limite de 500 títulos.");
  return events;
}

/** CRC-16/CCITT-FALSE: polinômio 1021, inicial FFFF, sem reflexão. */
export function crc16(payload: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
/** QR dinâmico: os dados de cobrança e o TXID são obtidos pelo app pagador na URL do banco. */
export function gerarBrCode(location: string) {
  const url = location.replace(/^https:\/\//, "");
  if (url.length > 77 || !/^pix-qrcode\.sicredi\.com\.br\/qr\/[a-z0-9/._-]+$/.test(url))
    throw new Error("URL PIX Sicredi inválida no retorno Y04.");
  const tlv = (id: string, value: string) => {
    const length = new TextEncoder().encode(value).length;
    if (length > 99) throw new Error("Campo BR Code excede 99 bytes.");
    return id + String(length).padStart(2, "0") + value;
  };
  const payload =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("25", url)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("58", "BR") +
    tlv("59", "PIX") +
    tlv("60", "Cidade") +
    tlv("62", tlv("05", "***")) +
    "6304";
  return payload + crc16(payload);
}

/** Instrução 06: preserva os dados do boleto original e não aloca outro nosso número. */
export function gerarAlteracaoVencimento(
  c: CnabConfig,
  original: string,
  nn: string,
  novaData: string,
  isoDate: string,
  time: string,
) {
  validateConfig(c);
  dateField(novaData);
  const lines = original.split(/\r\n|\n/).filter(Boolean);
  if (lines.some((line) => line.length !== 240) || lines[0]?.slice(0, 8) !== "74800000")
    throw new Error("Remessa original inválida.");
  const index = lines.findIndex(
    (line) => line[7] === "3" && line[13] === "P" && line.slice(37, 57).trim() === nn,
  );
  if (index < 0) throw new Error("Boleto não encontrado na remessa original.");
  const replace = (line: string, start: number, end: number, value: string) => {
    if (value.length !== end - start + 1) throw new Error("Tamanho inválido na instrução CNAB.");
    return line.slice(0, start - 1) + value + line.slice(end);
  };
  const emissao = readDate(lines[index]!.slice(109, 117));
  if (!emissao || Date.parse(novaData) - Date.parse(emissao) < 7 * 86400000)
    throw new Error("Vencimento deve respeitar 7 dias após a emissão pelo Sicredi.");
  const seguinte = dateField(new Date(Date.parse(novaData) + 86400000).toISOString().slice(0, 10));
  const detalhes: string[] = [];
  for (let i = index; i < lines.length && lines[i]![7] === "3"; i++) {
    if (i > index && lines[i]![13] === "P") break;
    if (lines[i]![13] === "Y") continue; // Y04 é exclusivo de entrada (movimento 01).
    let line = replace(replace(lines[i]!, 9, 13, numeric(detalhes.length + 1, 5)), 16, 17, "06");
    if (line[13] === "P") {
      line = replace(line, 78, 85, dateField(novaData));
      if (line[117] !== "3") line = replace(line, 119, 126, seguinte);
    }
    if (line[13] === "R" && line[65] !== "0") line = replace(line, 67, 74, seguinte);
    detalhes.push(line);
  }
  if (detalhes[1]?.[13] !== "Q") throw new Error("Remessa original sem segmento Q.");
  let header = replace(lines[0]!, 144, 151, dateField(isoDate));
  header = replace(replace(header, 152, 157, time), 158, 163, numeric(c.proxima_remessa, 6));
  let lote = replace(lines[1]!, 184, 191, numeric(c.proxima_remessa, 8));
  lote = replace(lote, 192, 199, dateField(isoDate));
  const trailer = replace(lines.at(-2)!, 18, 23, numeric(detalhes.length + 2, 6));
  const final = replace(lines.at(-1)!, 24, 29, numeric(detalhes.length + 4, 6));
  const month = "123456789ABC"[Number(isoDate.slice(5, 7)) - 1];
  return {
    content: [header, lote, ...detalhes, trailer, final].join("\r\n") + "\r\n",
    filename: `${c.beneficiario}${month}${isoDate.slice(8, 10)}.${numeric(c.proxima_remessa, 6)}`,
  };
}
