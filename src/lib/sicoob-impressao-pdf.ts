import { estiloInstrucoesBoleto as estilo } from "./boleto-instrucoes-estilo";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
  // deste campo. A lista bancária é necessária para preservar as mensagens
  // ao organizar o recibo superior. O QR Code ocupa a coluna inferior à direita.
  const mensagens = condicoes["mensagensInstrucao"];
  if (!Array.isArray(mensagens))
    throw Error(
      "Sicoob não informou as mensagens do boleto. Tente consultar a segunda via novamente.",
    );
  const quantidade = mensagens.length;
  if (
    quantidade > 5 ||
    mensagens.some((m) => typeof m !== "string" || m.length > 40 || /[\r\n]/.test(m))
  )
    throw Error("As instruções bancárias ultrapassam o espaço reservado no boleto.");
  const inicio = 255 - quantidade * 10;
  for (const [i, linha] of linhas.entries()) {
    if (fonte.widthOfTextAtSize(linha, estilo.tamanho) > 300)
      throw Error("As condições bancárias ultrapassam o espaço reservado para impressão.");
    pagina.drawText(linha, {
      x: 34,
      y: inicio - i * estilo.entrelinhas,
      size: estilo.tamanho,
      font: fonte,
    });
  }
  // Recibo do pagador: área interna entre o rótulo e a borda inferior (y=653).
  // Reorganiza as mensagens conhecidas do banco para acomodar as mesmas condições.
  const superiores = [...(mensagens as string[]), ...linhas];
  const passoSuperior = Math.min(estilo.entrelinhas, 42 / (superiores.length - 1));
  const fonteSuperior = Math.min(estilo.tamanho, passoSuperior);
  if (quantidade)
    pagina.drawRectangle({ x: 30, y: 654, width: 341, height: 49, color: rgb(1, 1, 1) });
  for (const [i, linha] of superiores.entries()) {
    if (fonte.widthOfTextAtSize(linha, fonteSuperior) > 332)
      throw Error("As instruções ultrapassam o campo superior do boleto.");
    pagina.drawText(linha, {
      x: 34,
      y: 697 - i * passoSuperior,
      size: fonteSuperior,
      font: fonte,
    });
  }
  return pdf.save();
}
