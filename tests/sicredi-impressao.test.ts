import { expect, test } from "bun:test";
import {
  PDFArray,
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import {
  alinharInstrucoesPdfSicredi,
  prepararPdfSicrediParaImpressao,
} from "../src/lib/sicredi-impressao-pdf";
import { pdfFixtureSicredi } from "./fixtures/sicredi-pdf";
function conteudos(doc: PDFDocument) {
  const c = doc.getPages()[0]!.node.Contents();
  const refs = c instanceof PDFArray ? c.asArray() : [c!];
  return refs.map((r) =>
    Buffer.from(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()).toString(
      "latin1",
    ),
  );
}
function textos(src: string) {
  return [...src.matchAll(/<([\da-f]+)>\s*Tj/gi)].map((m) => PDFHexString.of(m[1]!).decodeText());
}
test("alinha as duas vias e preserva todas as condições bancárias, sem taxas fixas", async () => {
  for (const [multa, juros, prazo] of [
    ["2,00", "5,00", "10"],
    ["1,35", "3,75", "7"],
  ]) {
    const original = await pdfFixtureSicredi([
      `PROTESTAR APOS ${prazo} DIAS CORRIDOS DE VENCIDO.                         APÓS VENCIMENTO COBRAR`,
      `MULTA DE ${multa}%.`,
      `APÓS VENCIMENTO COBRAR MORA MENSAL DE ${juros}%.`,
    ]);
    const antes = await PDFDocument.load(original),
      depois = await PDFDocument.load(await alinharInstrucoesPdfSicredi(original));
    expect(depois.getPageCount()).toBe(1);
    expect(depois.getPages()[0]!.getSize()).toEqual(antes.getPages()[0]!.getSize());
    const streams = conteudos(depois),
      novo = streams.at(-1)!;
    expect(textos(novo)).toEqual([
      `PROTESTAR APOS ${prazo} DIAS CORRIDOS DE VENCIDO.`,
      `APÓS VENCIMENTO COBRAR MULTA DE ${multa}%.`,
      `APÓS VENCIMENTO COBRAR MORA MENSAL DE ${juros}%.`,
      `PROTESTAR APOS ${prazo} DIAS CORRIDOS DE VENCIDO.`,
      `APÓS VENCIMENTO COBRAR MULTA DE ${multa}%.`,
      `APÓS VENCIMENTO COBRAR MORA MENSAL DE ${juros}%.`,
    ]);
    expect(novo).toContain("1 0 0 1 23 557.5 Tm");
    expect(novo).toContain("1 0 0 1 23 269.5 Tm");
    // Textos e operadores fora das instruções são preservados literalmente.
    for (const stream of conteudos(antes)) {
      for (const block of stream.matchAll(/BT[\s\S]*?ET/g)) {
        if (block[0].includes(" 7 Tf")) continue;
        expect(streams.join("\n")).toContain(block[0]);
      }
    }
  }
});
test("preserva a imagem Pix à direita; não permite sobreposição nem perda de mensagens", async () => {
  const original = await pdfFixtureSicredi(undefined, "direita");
  const antes = await PDFDocument.load(original),
    depois = await PDFDocument.load(await alinharInstrucoesPdfSicredi(original));
  expect(depois.getPages()[0]!.node.Resources()!.get(PDFName.of("XObject"))?.toString()).toBe(
    antes.getPages()[0]!.node.Resources()!.get(PDFName.of("XObject"))?.toString(),
  );
  await expect(
    alinharInstrucoesPdfSicredi(await pdfFixtureSicredi(undefined, "sobreposto")),
  ).rejects.toThrow("Nenhuma cobrança foi alterada");
  const mensagem = "Contato: (27) 9999-9999. Mensagem com acentuação e taxa de 1,25%.";
  const comMensagem = await PDFDocument.load(
    await alinharInstrucoesPdfSicredi(await pdfFixtureSicredi([mensagem])),
  );
  expect(textos(conteudos(comMensagem).at(-1)!)).toEqual([
    "Contato: (27) 9999-9999.",
    "Mensagem com acentuação e taxa de 1,25%.",
    "Contato: (27) 9999-9999.",
    "Mensagem com acentuação e taxa de 1,25%.",
  ]);
  await expect(
    alinharInstrucoesPdfSicredi(
      await pdfFixtureSicredi([
        Array(30).fill("Mensagem extensa que deve ser preservada.").join(" "),
      ]),
    ),
  ).rejects.toThrow();
});
test("preserva campo vazio e rejeita PDF sem os limites reconhecidos", async () => {
  const vazio = await pdfFixtureSicredi([]);
  expect(await alinharInstrucoesPdfSicredi(vazio)).toBe(vazio);
  const semCampos = await PDFDocument.create();
  semCampos.addPage([595, 842]);
  await expect(alinharInstrucoesPdfSicredi(await semCampos.save())).rejects.toThrow(
    "modelo de PDF Sicredi",
  );
});

test("decodifica as fontes CID do PDF bancário sem perder acentos, números ou escapes", async () => {
  const original = await PDFDocument.load(await pdfFixtureSicredi([]));
  const page = original.getPages()[0]!;
  const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const frase = "APÓS VENCIMENTO COBRAR MULTA DE 1,35%.";
  const caracteres = [...new Set(frase)],
    mapa = new Map(caracteres.map((c, i) => [c, i + 0x128]));
  const entradas = caracteres
    .map(
      (c) =>
        `<${mapa.get(c)!.toString(16).padStart(4, "0")}> <${mapa.get(c)!.toString(16).padStart(4, "0")}> <${c.charCodeAt(0).toString(16).padStart(4, "0")}>`,
    )
    .join("\n");
  const cmap = original.context.register(
    original.context.flateStream(`${caracteres.length} beginbfrange\n${entradas}\nendbfrange`),
  );
  const font = original.context.register(
    original.context.obj({
      Type: "Font",
      Subtype: "Type0",
      Encoding: "Identity-H",
      ToUnicode: cmap,
    }),
  );
  fonts.set(PDFName.of("CID"), font);
  // Literal CID com bytes, incluindo o byte 0x28 que precisa ser escapado.
  const bytes = frase.split("").flatMap((c) => [mapa.get(c)! >> 8, mapa.get(c)! & 255]);
  const literal = bytes
    .map((b) => ([40, 41, 92].includes(b) ? "\\" + String.fromCharCode(b) : String.fromCharCode(b)))
    .join("");
  const src = [557.5, 269.5]
    .map((y) => `BT\n1 0 0 1 23 ${y} Tm\n/CID 7 Tf\n(${literal})Tj\nET`)
    .join("\n");
  const contents = page.node.Contents() as PDFArray;
  contents.push(
    original.context.register(original.context.flateStream(Buffer.from(src, "latin1"))),
  );
  const depois = await PDFDocument.load(await alinharInstrucoesPdfSicredi(await original.save()));
  expect(textos(conteudos(depois).at(-1)!)).toEqual([frase, frase]);
});

test("respeita o BBox de um QR Code vetorial, além de imagens raster", async () => {
  const doc = await PDFDocument.load(await pdfFixtureSicredi());
  const page = doc.getPages()[0]!;
  const recursos = page.node.Resources()!;
  recursos.set(PDFName.of("XObject"), doc.context.obj({}));
  const objetos = recursos.lookup(PDFName.of("XObject"), PDFDict);
  objetos.set(
    PDFName.of("QrForm"),
    doc.context.register(
      doc.context.flateStream("0 0 60 28 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 60, 28],
        Resources: {},
      }),
    ),
  );
  (page.node.Contents() as PDFArray).push(
    doc.context.register(doc.context.flateStream("q 1 0 0 1 50 245 cm /QrForm Do Q")),
  );
  await expect(alinharInstrucoesPdfSicredi(await doc.save())).rejects.toThrow(
    "Nenhuma cobrança foi alterada",
  );
});

test("preenche instruções superiores vazias com as condições da outra via do mesmo boleto", async () => {
  const original = await pdfFixtureSicredi(undefined, "direita", true);
  const doc = await PDFDocument.load(await alinharInstrucoesPdfSicredi(original));
  const instrucoes = textos(conteudos(doc).at(-1)!);
  expect(instrucoes).toHaveLength(6);
  expect(instrucoes.slice(0, 3)).toEqual(instrucoes.slice(3));
  expect(instrucoes[0]).toContain("10 DIAS");
  expect(conteudos(doc).at(-1)).toContain("1 0 0 1 23 557.5 Tm");
});

test("modelo incompatível imprime o original byte a byte, preservando imagem Pix e instruções", async () => {
  const original = await pdfFixtureSicredi(undefined, "sobreposto");
  const copia = original.slice();
  const resultado = await prepararPdfSicrediParaImpressao(original);
  expect(resultado.pdf).toBe(original);
  expect(resultado.pdf).toEqual(copia);
  expect(resultado.aviso).toContain("PDF original do Sicredi");
  const antes = await PDFDocument.load(original),
    depois = await PDFDocument.load(resultado.pdf);
  expect(conteudos(depois)).toEqual(conteudos(antes));
  expect(depois.getPages()[0]!.node.Resources()!.get(PDFName.of("XObject"))?.toString()).toBe(
    antes.getPages()[0]!.node.Resources()!.get(PDFName.of("XObject"))?.toString(),
  );
});

test("modelo reconhecido continua alinhado, e layout diferente preserva todas as páginas", async () => {
  const alinhado = await prepararPdfSicrediParaImpressao(await pdfFixtureSicredi());
  expect(alinhado.aviso).toBeNull();
  const diferente = await PDFDocument.create();
  diferente.addPage([612, 792]);
  diferente.addPage([612, 792]);
  const original = await diferente.save();
  const preservado = await prepararPdfSicrediParaImpressao(original);
  expect(preservado.pdf).toBe(original);
  expect((await PDFDocument.load(preservado.pdf)).getPageCount()).toBe(2);
  expect(preservado.aviso).toBeTruthy();
});

test("arquivo corrompido, sem páginas ou acima do limite continua recusado", async () => {
  await expect(
    prepararPdfSicrediParaImpressao(new TextEncoder().encode("%PDF-1.7 arquivo incompleto")),
  ).rejects.toThrow("não pôde ser lido");
  const vazio = await PDFDocument.create();
  await expect(
    prepararPdfSicrediParaImpressao(await vazio.save({ addDefaultPage: false })),
  ).rejects.toThrow("não pôde ser lido");
  await expect(prepararPdfSicrediParaImpressao(new Uint8Array(12000001))).rejects.toThrow("limite");
});
