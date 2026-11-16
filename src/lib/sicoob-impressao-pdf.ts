import { PDFDocument, StandardFonts } from "pdf-lib";
import { condicoesImpressaoSicoob } from "./sicoob-impressao-condicoes";

/** Rodapé do formulário A4 padrão Sicoob. Não escala, move ou redesenha o boleto bancário. */
export async function incluirCondicoesPdfSicoob(
  original: Uint8Array,
  condicoes: Record<string, unknown>,
  formulario: number,
) {
  const pdf = await PDFDocument.load(original);
  const paginas = pdf.getPages();
  if (
    formulario !== 1 ||
    paginas.length !== 1 ||
    paginas.some((p) => {
      const box = p.getCropBox();
      return (
        p.getRotation().angle !== 0 ||
        Math.abs(p.getWidth() - 595) > 1 ||
        Math.abs(p.getHeight() - 842) > 1 ||
        box.x !== 0 ||
        box.y !== 0 ||
        Math.abs(box.width - p.getWidth()) > 0.01 ||
        Math.abs(box.height - p.getHeight()) > 0.01
      );
    })
  )
    throw Error(
      "Para imprimir as condições na mesma folha, utilize o formulário A4 padrão (1) do Sicoob.",
    );
  const pagina = paginas[0];
  if (!pagina) throw Error("PDF bancário sem página.");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const linhas = condicoesImpressaoSicoob(condicoes);
  for (const [i, linha] of linhas.entries()) {
    if (fonte.widthOfTextAtSize(linha, 8) > 529)
      throw Error("As condições bancárias ultrapassam o espaço reservado para impressão.");
    pagina.drawText(linha, { x: 33, y: 44 - i * 11, size: 8, font: fonte });
  }
  return pdf.save();
}
