import { PDFDocument, StandardFonts } from "pdf-lib";
import { condicoesImpressaoSicoob } from "./sicoob-impressao-condicoes";

/** Campo de instruções do formulário A4 padrão Sicoob. Preserva conteúdo e códigos bancários. */
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
  // O banco reserva até cinco mensagens (40 caracteres cada) na parte superior
  // deste campo. Sem a lista, reserve todas as cinco linhas para não sobrepor
  // instruções já existentes no PDF. O QR Code ocupa a coluna à direita.
  const mensagens = condicoes["mensagensInstrucao"];
  const quantidade = Array.isArray(mensagens) ? mensagens.length : 5;
  if (
    quantidade > 5 ||
    (Array.isArray(mensagens) &&
      mensagens.some((m) => typeof m !== "string" || m.length > 40 || /[\r\n]/.test(m)))
  )
    throw Error("As instruções bancárias ultrapassam o espaço reservado no boleto.");
  const inicio = 255 - quantidade * 10;
  for (const [i, linha] of linhas.entries()) {
    if (fonte.widthOfTextAtSize(linha, 7) > 300)
      throw Error("As condições bancárias ultrapassam o espaço reservado para impressão.");
    pagina.drawText(linha, { x: 34, y: inicio - i * 8, size: 7, font: fonte });
  }
  return pdf.save();
}
