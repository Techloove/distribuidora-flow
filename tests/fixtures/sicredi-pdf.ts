import { PDFDocument, StandardFonts } from "pdf-lib";
export const instrucoesFixtureSicredi = [
  "PROTESTAR APOS 10 DIAS CORRIDOS DE VENCIDO.                         APÓS VENCIMENTO COBRAR",
  "MULTA DE 2,00%.",
  "APÓS VENCIMENTO COBRAR MORA MENSAL DE 5,00%.",
];
/** PDF sintético, sem dados de cliente, no formato de texto do formulário bancário. */
export async function pdfFixtureSicredi(
  instrucoes = instrucoesFixtureSicredi,
  pix: "nenhum" | "direita" | "sobreposto" = "nenhum",
) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Beneficiário de teste", { x: 30, y: 620, font, size: 8 });
  for (const y of [570.36, 282.36]) {
    page.drawText("Instruções", { x: 22, y, font, size: 5 });
    page.drawText("Pagador", { x: 22, y: y - 96, font, size: 5 });
    page.drawText("(-) Desconto / Abatimento", { x: 411, y, font, size: 5 });
    instrucoes.forEach((texto, i) =>
      page.drawText(texto, { x: 23, y: y - 12.86 - i * 8.15, font, size: 7 }),
    );
    page.drawLine({ start: { x: 20, y: y - 90 }, end: { x: 575, y: y - 90 } });
  }
  page.drawRectangle({ x: 30, y: 98, width: 292, height: 34 });
  if (pix !== "nenhum") {
    const png = await doc.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV3sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    page.drawImage(png, { x: pix === "direita" ? 310 : 50, y: 245, width: 60, height: 28 });
  }
  return doc.save();
}
