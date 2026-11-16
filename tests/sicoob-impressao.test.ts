import { test, expect } from "bun:test";
import { PDFDocument, PDFArray, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { condicoesImpressaoSicoob } from "../src/lib/sicoob-impressao-condicoes";
import { incluirCondicoesPdfSicoob } from "../src/lib/sicoob-impressao-pdf";

const banco = {
  tipoJurosMora: 2,
  valorJurosMora: 5,
  dataJurosMora: "2026-11-15",
  tipoMulta: 2,
  valorMulta: 2,
  dataMulta: "2026-11-15",
  numeroDiasProtesto: 30,
  codigoProtesto: 1,
};
test("imprime taxas e datas bancárias com unidades corretas", () => {
  expect(condicoesImpressaoSicoob(banco)).toEqual([
    "Juros: 5,00% ao mês a partir de 15/11/2026.",
    "Multa: 2,00% a partir de 15/11/2026.",
    "Protesto: prazo de 30 dias corridos após o vencimento.",
  ]);
  const fixos = condicoesImpressaoSicoob({
    ...banco,
    tipoJurosMora: 1,
    tipoMulta: 1,
    codigoProtesto: 2,
  });
  expect(fixos[0]).toContain("por dia");
  expect(fixos[1]).toContain("R$");
  expect(fixos[2]).toContain("dias úteis");
});
test("campos ausentes ou inválidos não viram isenção nem taxas presumidas", () => {
  expect(condicoesImpressaoSicoob({})).toEqual([
    "Juros: condição não informada pelo banco.",
    "Multa: condição não informada pelo banco.",
    "Protesto: prazo não informado pelo banco.",
  ]);
  expect(condicoesImpressaoSicoob({ ...banco, valorMulta: null })[1]).toContain("não informada");
  expect(condicoesImpressaoSicoob({ ...banco, dataMulta: null })[1]).toContain(
    "início não informado",
  );
  expect(condicoesImpressaoSicoob({ numeroDiasProtesto: 30 })[2]).toContain(
    "contagem não informada",
  );
  expect(condicoesImpressaoSicoob({ tipoMulta: 0, tipoJurosMora: 3, codigoProtesto: 3 })).toEqual([
    "Juros: isento.",
    "Multa: isento.",
    "Protesto: não protestar.",
  ]);
});
async function original(largura = 595, altura = 842) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([largura, altura]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Instrucoes bancarias existentes", { x: 33, y: 260, font, size: 8 });
  // Marca o limite inferior do código, sem deixar que o rodapé o desloque.
  page.drawRectangle({ x: 33, y: 73, width: 250, height: 38 });
  return doc.save();
}
function conteudos(doc: PDFDocument) {
  const contents = doc.getPages()[0].node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents!];
  return streams.map((r) => {
    const stream = doc.context.lookup(r) as PDFRawStream;
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  });
}
test("mantém página, geometria e operadores originais; acrescenta só rodapé", async () => {
  const bytes = await original();
  const antes = await PDFDocument.load(bytes);
  const depois = await PDFDocument.load(await incluirCondicoesPdfSicoob(bytes, banco, 1));
  expect(depois.getPageCount()).toBe(1);
  expect(depois.getPages()[0].getSize()).toEqual(antes.getPages()[0].getSize());
  const streams = conteudos(depois);
  for (const stream of conteudos(antes)) expect(streams).toContain(stream);
  // Sem transformação de escala ou translação em torno do conteúdo original.
  expect(streams.join("\n")).not.toContain("0.9 0 0 0.9");
});
test("recusa formulários e páginas fora do layout verificado", async () => {
  await expect(incluirCondicoesPdfSicoob(await original(), banco, 2)).rejects.toThrow("A4 padrão");
  await expect(incluirCondicoesPdfSicoob(await original(612, 792), banco, 1)).rejects.toThrow(
    "A4 padrão",
  );
});
