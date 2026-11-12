import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dinheiroSicoob, dataSicoob } from "./sicoob-api";

type Row = Record<string, unknown>;
const objeto = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("LIQUI_OBJETO_INVALIDO");
  return v as Row;
};
const inteiro = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^[0-9]{1,18}$/.test(s) || (typeof v === "number" && !Number.isSafeInteger(v)))
    throw Error("LIQUI_IDENTIFICACAO_INVALIDA");
  return s.replace(/^0+(?=\d)/, "");
};
export function referenciaLiquiSicoob(v: unknown) {
  const r = objeto(v);
  if (r["siglaMovimento"] !== "LIQUI") throw Error("LIQUI_MOVIMENTO_DIVERGENTE");
  const seuNumero = String(r["seuNumero"] ?? "");
  if (!/^[a-zA-Z0-9._/-]{0,50}$/.test(seuNumero)) throw Error("LIQUI_IDENTIFICACAO_INVALIDA");
  return {
    numeroCliente: inteiro(r["numeroCliente"]),
    numeroConta: inteiro(r["numeroContaCorrente"]),
    nossoNumero: inteiro(r["numeroTitulo"]),
    seuNumero,
    modalidade: inteiro(r["modalidade"]),
  };
}
export function normalizarLiquiSicoob(v: unknown, inicio: string, fim: string) {
  const r = objeto(v);
  if (r["siglaMovimento"] !== "LIQUI") throw Error("LIQUI_MOVIMENTO_DIVERGENTE");
  const calendario = (v: unknown) => {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(v) ||
      !Number.isFinite(Date.parse(v))
    )
      throw Error("LIQUI_DATA_INVALIDA");
    return dataSicoob(v);
  };
  const data = calendario(r["dataLiquidacao"]);
  const dataMovimento = calendario(r["dataMovimentoLiquidacao"]);
  if (dataMovimento < inicio || dataMovimento > fim) throw Error("LIQUI_DATA_FORA_PERIODO");
  const valor = dinheiroSicoob(r["valorLiquido"]),
    nominal = dinheiroSicoob(r["valorTitulo"]),
    mora = dinheiroSicoob(r["valorMora"]),
    desconto = dinheiroSicoob(r["valorDesconto"]),
    abatimento = dinheiroSicoob(r["valorAbatimento"]),
    tarifa = r["valorTarifaMovimento"] == null ? null : dinheiroSicoob(r["valorTarifaMovimento"]);
  // O valor liquidado precisa fechar com o título/encargos; tarifa é separada, nunca deduzida por suposição.
  if (
    valor <= 0 ||
    nominal <= 0 ||
    Math.round(valor * 100) !==
      Math.round(nominal * 100) +
        Math.round(mora * 100) -
        Math.round(desconto * 100) -
        Math.round(abatimento * 100)
  )
    throw Error("LIQUI_VALORES_DIVERGENTES");
  const codigo = String(r["codigoBarras"] ?? "");
  const seuNumero = String(r["seuNumero"] ?? "");
  if (
    !/^756\d{41}$/.test(codigo) ||
    !/^[a-zA-Z0-9._/-]{1,50}$/.test(seuNumero) ||
    inteiro(r["modalidade"]) !== "1"
  )
    throw Error("LIQUI_TITULO_INVALIDO");
  const registro = {
    numeroCliente: inteiro(r["numeroCliente"]),
    numeroConta: inteiro(r["numeroContaCorrente"]),
    nossoNumero: inteiro(r["numeroTitulo"]),
    seuNumero,
    codigoBarras: codigo,
    contratoCobranca:
      r["numeroContratoCobranca"] == null ? null : inteiro(r["numeroContratoCobranca"]),
    data,
    dataMovimento,
    nominal,
    valor,
    mora,
    desconto,
    abatimento,
    tarifa,
  };
  const {
    tarifa: _tarifa,
    dataMovimento: _movimento,
    contratoCobranca: _contrato,
    ...pagamento
  } = registro;
  return {
    ...registro,
    chave: createHash("sha256").update(JSON.stringify(pagamento)).digest("hex"),
  };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** ZIP em memória, sem extrair caminhos ou executar conteúdo. Limites e CRC são obrigatórios. */
export function registrosZipSicoob(base64: unknown): unknown[] {
  if (
    typeof base64 !== "string" ||
    base64.length > 8_000_000 ||
    !/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)
  )
    throw Error("LIQUI_BASE64_INVALIDO");
  const zip = Buffer.from(base64, "base64");
  if (zip.toString("base64") !== base64 || zip.length < 22) throw Error("LIQUI_ZIP_INVALIDO");
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
      eocd = i;
      break;
    }
  if (eocd < 0 || zip.readUInt16LE(eocd + 4) || zip.readUInt16LE(eocd + 6))
    throw Error("LIQUI_ZIP_INVALIDO");
  const total = zip.readUInt16LE(eocd + 10),
    tamanho = zip.readUInt32LE(eocd + 12),
    inicio = zip.readUInt32LE(eocd + 16);
  if (!total || total > 20 || total !== zip.readUInt16LE(eocd + 8) || inicio + tamanho !== eocd)
    throw Error("LIQUI_ZIP_LIMITE");
  let pos = inicio,
    descompactado = 0;
  const registros: unknown[] = [];
  for (let n = 0; n < total; n++) {
    if (pos + 46 > eocd || zip.readUInt32LE(pos) !== 0x02014b50) throw Error("LIQUI_ZIP_INVALIDO");
    const flags = zip.readUInt16LE(pos + 8),
      metodo = zip.readUInt16LE(pos + 10),
      crc = zip.readUInt32LE(pos + 16),
      compactado = zip.readUInt32LE(pos + 20),
      tamanhoReal = zip.readUInt32LE(pos + 24),
      nomeLen = zip.readUInt16LE(pos + 28),
      extra = zip.readUInt16LE(pos + 30),
      comentario = zip.readUInt16LE(pos + 32),
      offset = zip.readUInt32LE(pos + 42);
    const nome = zip.subarray(pos + 46, pos + 46 + nomeLen).toString("utf8");
    if (
      pos + 46 + nomeLen + extra + comentario > eocd ||
      !/^[\w.-]+\.json$/i.test(nome) ||
      flags & 1 ||
      ![0, 8].includes(metodo) ||
      tamanhoReal > 20_000_000 ||
      descompactado + tamanhoReal > 20_000_000 ||
      zip.readUInt16LE(pos + 34)
    )
      throw Error("LIQUI_ZIP_LIMITE");
    if (
      offset + 30 > inicio ||
      zip.readUInt32LE(offset) !== 0x04034b50 ||
      zip.readUInt16LE(offset + 6) !== flags ||
      zip.readUInt16LE(offset + 8) !== metodo
    )
      throw Error("LIQUI_ZIP_INVALIDO");
    const nomeLocal = zip.readUInt16LE(offset + 26),
      inicioDados = offset + 30 + nomeLocal + zip.readUInt16LE(offset + 28);
    if (
      inicioDados + compactado > inicio ||
      zip.subarray(offset + 30, offset + 30 + nomeLocal).toString("utf8") !== nome
    )
      throw Error("LIQUI_ZIP_INVALIDO");
    const dados = zip.subarray(inicioDados, inicioDados + compactado);
    const texto = metodo === 8 ? inflateRawSync(dados, { maxOutputLength: 20_000_000 }) : dados;
    if (texto.length !== tamanhoReal || crc32(texto) !== crc) throw Error("LIQUI_ZIP_CRC_INVALIDO");
    const lista: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(texto));
    if (!Array.isArray(lista) || registros.length + lista.length > 10000)
      throw Error("LIQUI_REGISTROS_LIMITE");
    registros.push(...lista);
    descompactado += tamanhoReal;
    pos += 46 + nomeLen + extra + comentario;
  }
  if (pos !== eocd) throw Error("LIQUI_ZIP_INVALIDO");
  return registros;
}
export type LiquidacaoSicoob = ReturnType<typeof normalizarLiquiSicoob>;
