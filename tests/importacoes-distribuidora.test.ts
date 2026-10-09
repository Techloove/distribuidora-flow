import { expect, test } from "bun:test";
import { gerarPixChave, lerExtratoOfx } from "../src/lib/importacoes-distribuidora";
import { lerPaginas } from "../src/lib/paginacao";
const ofx =
  "<OFX><BANKACCTFROM><BANKID>748<BRANCHID>0165<ACCTID>12345-6</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20261009120000[-3:BRT]<TRNAMT>125.50<FITID>TX001<MEMO>Recebimento</STMTTRN><STMTTRN><DTPOSTED>20261008<TRNAMT>-3.25<FITID>TX002<NAME>Tarifa</STMTTRN></BANKTRANLIST></OFX>";
test("OFX preserva FITID, data e sinal e confere conta Sicredi", () => {
  const rows = lerExtratoOfx(ofx, { banco: "748", agencia: "0165", numero: "123456" });
  expect(rows).toEqual([
    { referencia: "TX001", data: "2026-10-09", valor: 125.5, descricao: "Recebimento" },
    { referencia: "TX002", data: "2026-10-08", valor: -3.25, descricao: "Tarifa" },
  ]);
  expect(() => lerExtratoOfx(ofx, { banco: "748", agencia: "0165", numero: "9999" })).toThrow();
  expect(() => lerExtratoOfx(ofx.replace("20261008", "20260230"))).toThrow();
  expect(() => lerExtratoOfx(ofx.replace("TX002", "TX001"))).toThrow();
  expect(() => lerExtratoOfx("<!DOCTYPE OFX>" + ofx)).toThrow();
});
test("Pix por chave tem valor e identificação, CRC independente e rejeita valores imprecisos", () => {
  const payload = gerarPixChave(
    "financeiro@example.test",
    "Distribuidora Caparaó",
    "Cachoeiro",
    125.5,
    "PEDIDO123",
  );
  expect(payload).toContain("5406125.50");
  expect(payload).toContain("PEDIDO123");
  expect(payload).toContain("DISTRIBUIDORA CAPARAO");
  // CRC independente, bit a bit.
  let crc = 65535;
  for (const c of new TextEncoder().encode(payload.slice(0, -4))) {
    crc ^= c << 8;
    for (let j = 0; j < 8; j++)
      crc = crc & 32768 ? ((crc << 1) ^ 4129) & 65535 : (crc << 1) & 65535;
  }
  expect(payload.slice(-4)).toBe(crc.toString(16).toUpperCase().padStart(4, "0"));
  expect(() => gerarPixChave("invalida", "Nome", "Cidade", 1, "ABC")).toThrow();
  expect(() => gerarPixChave("a@b.com", "Nome", "Cidade", 1.234, "ABC")).toThrow();
});
test("paginação lê além de 1000 registros e falha sem devolver dados incompletos", async () => {
  const all = Array.from({ length: 1201 }, (_, id) => ({ id }));
  expect(
    await lerPaginas(async (a, b) => ({ data: all.slice(a, b + 1), error: null })),
  ).toHaveLength(1201);
  await expect(
    lerPaginas(async (a, b) =>
      a === 0
        ? { data: all.slice(a, b + 1), error: null }
        : { data: null, error: { message: "Conexão interrompida" } },
    ),
  ).rejects.toThrow("Conexão interrompida");
});
