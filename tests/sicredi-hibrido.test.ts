import { expect, test } from "bun:test";
import { pixSicredi, validarModalidadeSicredi } from "../src/lib/sicredi-hibrido";
import { gerarBrCode, crc16 } from "../src/lib/sicredi-cnab";
const qr = gerarBrCode("pix-qrcode.sicredi.com.br/qr/v2/cobv/fixture");
const txid = "a".repeat(32);
test("aceita campos documentados na inclusão e na consulta, sem gerar um novo Pix", () => {
  expect(pixSicredi({ qrCode: qr, txid }, "HIBRIDO")).toEqual({ qrCode: qr, txid });
  expect(pixSicredi({ codigoQrCode: qr, txId: txid }, "HIBRIDO")).toEqual({ qrCode: qr, txid });
  expect(pixSicredi({ txid }, "NORMAL")).toEqual({ qrCode: "", txid: "" });
});
test("TXID isolado, CRC inválido e código estático não confirmam híbrido", () => {
  for (const payload of [
    { txid },
    { qrCode: qr.slice(0, -4) + "FFFF", txid },
    { qrCode: qr.replace("010212", "010211"), txid },
    { qrCode: qr, txid: "" },
  ])
    expect(() => pixSicredi(payload, "HIBRIDO")).toThrow();
});
test("normal mantém carência; híbrido exige escolha explícita sem carência adicional", () => {
  expect(() => validarModalidadeSicredi("NORMAL", 2, 3)).not.toThrow();
  expect(() => validarModalidadeSicredi("HIBRIDO", 2, 0)).not.toThrow();
  expect(() => validarModalidadeSicredi("HIBRIDO", 2, 1)).toThrow("zero");
  expect(() => validarModalidadeSicredi("invalido", 0, 0)).toThrow();
});

test("consulta admite BR Code dinâmico sem tag opcional 01 e conserva seu CRC", () => {
  const semTag = qr.replace("010212", "").slice(0, -4);
  const codigo = semTag + crc16(semTag);
  expect(pixSicredi({ codigoQrCode: codigo, txId: txid }, "HIBRIDO").qrCode).toBe(codigo);
});
