import { estiloInstrucoesBoleto as estilo } from "./boleto-instrucoes-estilo";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";

type Token = { valor: string; inicio: number; fim: number; literal?: boolean };
/** Lexer de conteúdo PDF: strings e comentários nunca são interpretados como operadores. */
function tokens(src: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < src.length;) {
    if (/\s/.test(src[i]!)) {
      i++;
      continue;
    }
    if (src[i] === "%") {
      while (i < src.length && !/[\r\n]/.test(src[i]!)) i++;
      continue;
    }
    const inicio = i;
    if (src[i] === "(") {
      let nivel = 1;
      i++;
      while (i < src.length && nivel) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "(") nivel++;
        if (src[i] === ")") nivel--;
        i++;
      }
      if (nivel) throw Error("String PDF incompleta.");
      out.push({ valor: src.slice(inicio + 1, i - 1), inicio, fim: i, literal: true });
    } else if (src[i] === "<" && src[i + 1] !== "<") {
      const fim = src.indexOf(">", i + 1);
      if (fim < 0) throw Error("String hexadecimal PDF incompleta.");
      i = fim + 1;
      out.push({ valor: src.slice(inicio, i), inicio, fim: i });
    } else {
      i++;
      if (!["[", "]", "<", ">"].includes(src[inicio]!))
        while (i < src.length && !/[\s()[\]<>/%]/.test(src[i]!)) i++;
      out.push({ valor: src.slice(inicio, i), inicio, fim: i });
    }
  }
  return out;
}
const numero = (t: Token | undefined) =>
  t && !t.literal && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t.valor);
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
const identidade = (m: number[]) =>
  m.every((n, i) => Math.abs(n - [1, 0, 0, 1, 0, 0][i]!) < 0.00001);
const textoStream = (s: unknown) => {
  if (!(s instanceof PDFRawStream)) throw Error("Conteúdo PDF não reconhecido.");
  return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
};

function decodificador(fonts: PDFDict, nome: string) {
  const font = fonts.lookup(PDFName.of(nome), PDFDict);
  const encoding = font.get(PDFName.of("Encoding"))?.toString();
  if (encoding === "/WinAnsiEncoding")
    return (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);
  if (encoding !== "/Identity-H") throw Error("Codificação de fonte não reconhecida.");
  const cmap = font.lookup(PDFName.of("ToUnicode"));
  const src = textoStream(cmap),
    mapa = new Map<number, string>();
  const unicode = (hex: string) => {
    if (hex.length % 4) throw Error("Mapa Unicode inválido.");
    return String.fromCharCode(...hex.match(/.{4}/g)!.map((h) => parseInt(h, 16)));
  };
  for (const bloco of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of bloco[1]!.matchAll(/<([\da-f]{4})>\s*<([\da-f]+)>/gi))
      mapa.set(parseInt(m[1]!, 16), unicode(m[2]!));
  for (const bloco of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    if (bloco[1]!.includes("[")) throw Error("Mapa Unicode não reconhecido.");
    for (const m of bloco[1]!.matchAll(/<([\da-f]{4})>\s*<([\da-f]{4})>\s*<([\da-f]{4})>/gi)) {
      const a = parseInt(m[1]!, 16),
        b = parseInt(m[2]!, 16),
        c = parseInt(m[3]!, 16);
      if (b < a || b - a > 65535) throw Error("Mapa Unicode inválido.");
      for (let n = a; n <= b; n++) mapa.set(n, String.fromCharCode(c + n - a));
    }
  }
  return (bytes: Uint8Array) => {
    if (bytes.length % 2) throw Error("Texto bancário incompleto.");
    let texto = "";
    for (let i = 0; i < bytes.length; i += 2) {
      const letra = mapa.get(bytes[i]! * 256 + bytes[i + 1]!);
      if (letra === undefined) throw Error("Caractere bancário não reconhecido.");
      texto += letra;
    }
    return texto;
  };
}

type Trecho = { x: number; y: number; texto: string };
type Bloco = { inicio: number; fim: number; stream: number; trechos: Trecho[] };
/** Reorganiza apenas o texto original do campo Instruções. Não consulta padrões da conta. */
export async function alinharInstrucoesPdfSicredi(original: Uint8Array): Promise<Uint8Array> {
  try {
    if (original.length > 12000000) throw Error("PDF bancário excede o limite de impressão.");
    const doc = await PDFDocument.load(original),
      paginas = doc.getPages(),
      page = paginas[0];
    if (
      !page ||
      paginas.length !== 1 ||
      Math.abs(page.getWidth() - 595) > 1 ||
      Math.abs(page.getHeight() - 842) > 1 ||
      page.getRotation().angle !== 0
    )
      throw Error("Formulário fora do A4 padrão.");
    const crop = page.getCropBox();
    if (
      crop.x !== 0 ||
      crop.y !== 0 ||
      Math.abs(crop.width - page.getWidth()) > 0.01 ||
      Math.abs(crop.height - page.getHeight()) > 0.01
    )
      throw Error("Área de impressão diferente do padrão.");
    const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents!];
    const srcs = refs.map((ref) => textoStream(doc.context.lookup(ref)));
    const blocos: Bloco[] = [],
      imagens: { x: number; y: number; w: number; h: number }[] = [];
    const decode = new Map<string, (b: Uint8Array) => string>();
    let matriz = [1, 0, 0, 1, 0, 0];
    const pilha: number[][] = [];
    for (const [stream, src] of srcs.entries()) {
      const ts = tokens(src);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]!;
        if (t.literal) continue;
        if (t.valor === "q") pilha.push([...matriz]);
        if (t.valor === "Q") {
          const anterior = pilha.pop();
          if (!anterior) throw Error("Estado gráfico inválido.");
          matriz = anterior;
        }
        if (t.valor === "cm") {
          const nums = ts.slice(i - 6, i);
          if (nums.length !== 6 || nums.some((n) => !numero(n)))
            throw Error("Transformação inválida.");
          const [a, b, c, d, e, f] = nums.map((n) => Number(n.valor)) as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const [A, B, C, D, E, F] = matriz as [number, number, number, number, number, number];
          matriz = [
            A * a + C * b,
            B * a + D * b,
            A * c + C * d,
            B * c + D * d,
            A * e + C * f + E,
            B * e + D * f + F,
          ];
        }
        if (t.valor === "Do") {
          const [a, b, c, d, e, f] = matriz as [number, number, number, number, number, number];
          if (b !== 0 || c !== 0) throw Error("Imagem com rotação não suportada.");
          const nome = ts[i - 1]?.valor;
          if (!nome?.startsWith("/")) throw Error("Imagem bancária não reconhecida.");
          const recurso = page.node
            .Resources()!
            .lookup(PDFName.of("XObject"), PDFDict)
            .lookup(PDFName.of(nome.slice(1)));
          if (!(recurso instanceof PDFRawStream)) throw Error("Imagem bancária não reconhecida.");
          const tipo = recurso.dict.get(PDFName.of("Subtype"))?.toString();
          let box = { x: 0, y: 0, width: 1, height: 1 };
          if (tipo === "/Form") {
            box = recurso.dict.lookup(PDFName.of("BBox"), PDFArray).asRectangle();
            const propria = recurso.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
            if (propria && !identidade(propria.asArray().map((n) => Number(n.toString()))))
              throw Error("Imagem bancária transformada.");
          } else if (tipo !== "/Image") throw Error("Imagem bancária não reconhecida.");
          const x = e + a * box.x,
            y = f + d * box.y;
          imagens.push({
            x: Math.min(x, x + a * box.width),
            y: Math.min(y, y + d * box.height),
            w: Math.abs(a * box.width),
            h: Math.abs(d * box.height),
          });
        }
        if (t.valor !== "BT") continue;
        if (!identidade(matriz)) throw Error("Texto com transformação não suportada.");
        const bloco: Bloco = { inicio: t.inicio, fim: 0, stream, trechos: [] };
        let operacaoIncompativel = false;
        let x = 0,
          y = 0,
          font = "",
          tamanho = 0,
          posicionou = false;
        for (i++; i < ts.length && (ts[i]!.literal || ts[i]!.valor !== "ET"); i++) {
          const op = ts[i]!;
          if (op.literal) continue;
          if (op.valor === "Tm") {
            const nums = ts.slice(i - 6, i);
            if (nums.length !== 6 || nums.some((n) => !numero(n))) throw Error("Posição inválida.");
            const m = nums.map((n) => Number(n.valor));
            if (!identidade([...m.slice(0, 4), 0, 0])) throw Error("Texto rotacionado.");
            x = m[4]!;
            y = m[5]!;
            posicionou = true;
          } else if (op.valor === "Tf") {
            font = ts[i - 2]!.valor.slice(1);
            tamanho = Number(ts[i - 1]!.valor);
          } else if (op.valor === "Tj") {
            const s = ts[i - 1]!;
            const hexadecimal = !s.literal && /^<[0-9a-f\s]*>$/i.test(s.valor);
            if ((!s.literal && !hexadecimal) || !posicionou || !font || !(tamanho > 0))
              throw Error("Objeto de texto não reconhecido.");
            if (!decode.has(font)) decode.set(font, decodificador(fonts, font));
            bloco.trechos.push({
              x,
              y,
              texto: decode.get(font)!(
                s.literal
                  ? PDFString.of(s.valor).asBytes()
                  : PDFHexString.of(s.valor.slice(1, -1).replace(/\s/g, "")).asBytes(),
              ),
            });
            posicionou = false;
          } else if (["TJ", "Td", "TD", "'", '"', "Tc", "Tw", "Tz", "Ts", "Tr"].includes(op.valor))
            operacaoIncompativel = true;
        }
        if (i === ts.length) throw Error("Objeto de texto incompleto.");
        if (operacaoIncompativel && bloco.trechos.some((t) => t.texto))
          throw Error("Operação de texto não suportada.");
        bloco.fim = ts[i]!.fim;
        blocos.push(bloco);
      }
    }
    if (pilha.length) throw Error("Estado gráfico incompleto.");
    const trechos = blocos.flatMap((b) => b.trechos);
    const titulos = trechos
      .filter((t) => normalizar(t.texto) === "INSTRUCOES")
      .sort((a, b) => b.y - a.y);
    if (titulos.length !== 2 || titulos.some((t) => Math.abs(t.x - 22) > 1))
      throw Error("Campo de instruções não reconhecido.");
    const fonte = await doc.embedFont(StandardFonts.Helvetica),
      removidos = new Set<Bloco>();
    const desenhos: { texto: string; x: number; y: number }[] = [];
    const campos = titulos.map((titulo) => {
      const pagador = trechos
        .filter(
          (t) =>
            normalizar(t.texto) === "PAGADOR" && Math.abs(t.x - titulo.x) < 1 && t.y < titulo.y,
        )
        .sort((a, b) => b.y - a.y)[0];
      if (!pagador || titulo.y - pagador.y < 60 || titulo.y - pagador.y > 120)
        throw Error("Limites das instruções não reconhecidos.");
      const dentro = (t: Trecho) =>
        t.x >= titulo.x && t.x < 409 && t.y < titulo.y - 3 && t.y > pagador.y + 5;
      const escolhidos = blocos.filter((b) => b.trechos.some(dentro));
      if (escolhidos.some((b) => b.trechos.some((t) => !dentro(t))))
        throw Error("Objeto de texto atravessa outro campo.");
      const texto = escolhidos
        .flatMap((b) => b.trechos)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((t) => t.texto)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { titulo, pagador, escolhidos, texto };
    });
    for (const { titulo, pagador, escolhidos, texto: proprio } of campos) {
      // Alguns PDFs trazem as condições em somente uma das vias do mesmo boleto.
      const texto = proprio || campos.find((c) => c.texto)?.texto || "";
      if (!texto) continue;
      const frases = texto.split(/(?<=[.!?])\s+/),
        linhas: string[] = [];
      for (const frase of frases) {
        let linha = "";
        for (const palavra of frase.split(" ")) {
          const tentativa = linha ? `${linha} ${palavra}` : palavra;
          if (fonte.widthOfTextAtSize(tentativa, estilo.tamanho) > 260) {
            if (!linha) throw Error("Palavra ultrapassa o campo.");
            linhas.push(linha);
            linha = palavra;
            if (fonte.widthOfTextAtSize(linha, estilo.tamanho) > 260)
              throw Error("Palavra ultrapassa o campo.");
          } else linha = tentativa;
        }
        if (linha) linhas.push(linha);
      }
      const x = titulo.x + 1,
        inicio = titulo.y - 12.86,
        fim = inicio - (linhas.length - 1) * estilo.entrelinhas;
      if (fim < pagador.y + 10) throw Error("Instruções ultrapassam o campo.");
      if (
        imagens.some(
          (im) => im.x < x + 260 && im.x + im.w > x && im.y < inicio + 7 && im.y + im.h > fim - 2,
        )
      )
        throw Error("Imagem ocupa o campo de instruções.");
      escolhidos.forEach((b) => removidos.add(b));
      linhas.forEach((texto, i) => desenhos.push({ texto, x, y: inicio - i * estilo.entrelinhas }));
    }
    if (!desenhos.length) return original;
    const novos = srcs.map((src, stream) => {
      const apagar = [...removidos]
        .filter((b) => b.stream === stream)
        .sort((a, b) => b.inicio - a.inicio);
      for (const b of apagar) src = src.slice(0, b.inicio) + src.slice(b.fim);
      return doc.context.register(doc.context.flateStream(Buffer.from(src, "latin1")));
    });
    page.node.set(PDFName.of("Contents"), doc.context.obj(novos));
    for (const d of desenhos)
      page.drawText(d.texto, {
        x: d.x,
        y: d.y,
        size: estilo.tamanho,
        font: fonte,
        lineHeight: estilo.entrelinhas,
      });
    return await doc.save();
  } catch (cause) {
    throw Error(
      "Não foi possível alinhar as instruções neste modelo de PDF Sicredi. Nenhuma cobrança foi alterada.",
      { cause },
    );
  }
}

/** O ajuste visual nunca impede a impressão de um PDF bancário original legível. */
export async function prepararPdfSicrediParaImpressao(original: Uint8Array): Promise<{
  pdf: Uint8Array;
  aviso: string | null;
}> {
  if (original.length > 12000000) throw Error("PDF bancário excede o limite de impressão.");
  try {
    return { pdf: await alinharInstrucoesPdfSicredi(original), aviso: null };
  } catch {
    try {
      const doc = await PDFDocument.load(original, { updateMetadata: false });
      if (doc.getPageCount() === 0) throw Error("PDF sem páginas.");
      for (const pagina of doc.getPages()) {
        const { width, height } = pagina.getSize();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
          throw Error("Página inválida.");
      }
    } catch {
      throw Error(
        "O PDF retornado pelo Sicredi não pôde ser lido. Tente consultar o PDF novamente, sem emitir outro boleto.",
      );
    }
    // Devolve exatamente os bytes recebidos do banco, sem apagar ou reescrever campos.
    return {
      pdf: original,
      aviso:
        "Neste modelo de boleto, foi mantido o PDF original do Sicredi, com as instruções e informações no formato fornecido pelo banco.",
    };
  }
}
