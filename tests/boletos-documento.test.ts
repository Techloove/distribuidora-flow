import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  boletoAtual,
  boletoImprimivel,
  saldoTituloBoleto,
  unirPdfsBoletos,
  type BoletoDocumento,
} from "../src/lib/boletos-documento";
const b = (id: string, status: string, date: string): BoletoDocumento => ({
  id,
  conta_receber_id: "conta1",
  status,
  created_at: date,
  banco: "sicredi",
  canal: "api",
  linha_digitavel: "748" + "1".repeat(44),
  ambiente: "producao",
  valor: 100,
});
test("reimpressão seleciona o ciclo ativo e não revive boleto encerrado nem de outra parcela", () => {
  const atual = b("atual", "registrado", "2026-10-16"),
    cancelado = b("cancelado", "cancelado", "2026-10-17");
  expect(
    boletoAtual(
      [cancelado, atual, { ...b("outra", "registrado", "2026-10-18"), conta_receber_id: "conta2" }],
      "conta1",
    )?.id,
  ).toBe("atual");
  expect(boletoImprimivel(atual)).toBe(true);
  expect(boletoImprimivel({ ...atual, status: "liquidado" })).toBe(true);
  for (const status of ["cancelado", "baixado", "erro", "pendente", "em_processamento"])
    expect(boletoImprimivel({ ...atual, status })).toBe(false);
  expect(boletoImprimivel({ ...atual, canal: "cnab240" })).toBe(false);
  expect(boletoImprimivel({ ...atual, banco: "sicoob" })).toBe(false);
  expect(boletoImprimivel({ ...atual, linha_digitavel: null })).toBe(false);
  expect(boletoAtual([], "conta1")).toBeNull();
});
test("ciclo pendente mais recente impede reimprimir um registro antigo como se fosse atual", () => {
  const atual = boletoAtual(
    [b("antigo", "baixado", "2026-10-15"), b("novo", "em_processamento", "2026-10-16")],
    "conta1",
  );
  expect(atual?.id).toBe("novo");
  expect(boletoImprimivel(atual)).toBe(false);
  expect(
    saldoTituloBoleto({
      id: "c",
      parcela: 1,
      vencimento: "2026-12-01",
      status: "parcial",
      valor: 100,
      juros: 3,
      multa: 2,
      acrescimo: 1,
      desconto: 4,
      valor_pago: 20,
    }),
  ).toBe(82);
});
test("PDF conjunto conserva as páginas dos boletos bancários na ordem selecionada", async () => {
  const um = await PDFDocument.create();
  um.addPage([200, 300]);
  const dois = await PDFDocument.create();
  dois.addPage([400, 500]);
  dois.addPage([600, 700]);
  const bytes = await unirPdfsBoletos([await um.saveAsBase64(), await dois.saveAsBase64()]);
  const combinado = await PDFDocument.load(bytes);
  expect(combinado.getPageCount()).toBe(3);
  expect(combinado.getPages().map((p) => p.getWidth())).toEqual([200, 400, 600]);
  await expect(unirPdfsBoletos([])).rejects.toThrow("Selecione");
  await expect(
    unirPdfsBoletos([await um.saveAsBase64(), btoa("resposta inválida")]),
  ).rejects.toThrow();
});
