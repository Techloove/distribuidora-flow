import { crc16 } from "./sicredi-cnab";

/** Manual API da Cobrança Sicredi 4.0: datas de carência retiram o Pix. */
export function validarModalidadeSicredi(tipo: unknown, multa: number, diasMulta: number) {
  if (tipo !== "NORMAL" && tipo !== "HIBRIDO") throw new Error("Modalidade Sicredi inválida.");
  if (tipo === "HIBRIDO" && multa > 0 && diasMulta > 0)
    throw new Error(
      "No híbrido, configure dias da multa como zero (sem carência adicional). Juros e multa começam após o vencimento.",
    );
}

/** TLV em bytes: os tamanhos EMV não são contagens de caracteres Unicode. */
function camposEmv(texto: string) {
  const bytes = new TextEncoder().encode(texto),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const campos = new Map<string, string>();
  for (let p = 0; p < bytes.length;) {
    const id = decoder.decode(bytes.slice(p, p + 2)),
      tamanho = decoder.decode(bytes.slice(p + 2, p + 4));
    if (
      !/^\d{2}$/.test(id) ||
      !/^\d{2}$/.test(tamanho) ||
      campos.has(id) ||
      p + 4 + Number(tamanho) > bytes.length
    )
      throw new Error("BR Code inválido.");
    campos.set(id, decoder.decode(bytes.slice(p + 4, p + 4 + Number(tamanho))));
    p += 4 + Number(tamanho);
  }
  return campos;
}

/** Usa exclusivamente o BR Code devolvido pelo banco; TXID nunca substitui QR Code. */
export function pixSicredi(json: Record<string, unknown>, modalidade: string) {
  const qrCode = String(json["qrCode"] ?? json["codigoQrCode"] ?? "").trim();
  const txid = String(json["txid"] ?? json["txId"] ?? "").trim();
  if (modalidade !== "HIBRIDO") return { qrCode: "", txid: "" };
  const campos = camposEmv(qrCode);
  const conta = camposEmv(campos.get("26") ?? "");
  if (
    campos.get("00") !== "01" ||
    (campos.has("01") && campos.get("01") !== "12") ||
    conta.get("00") !== "br.gov.bcb.pix" ||
    !/^pix-qrcodeh?\.sicredi\.com\.br\/qr\/[a-zA-Z0-9/._-]+$/.test(conta.get("25") ?? "") ||
    !/^[a-zA-Z0-9]{32}$/.test(txid) ||
    qrCode.length > 365 ||
    !qrCode.includes("br.gov.bcb.pix") ||
    !/6304[0-9A-Fa-f]{4}$/.test(qrCode) ||
    crc16(qrCode.slice(0, -4)) !== qrCode.slice(-4).toUpperCase()
  )
    throw new Error("Pix dinâmico Sicredi incompleto ou inválido.");
  return { qrCode, txid };
}
