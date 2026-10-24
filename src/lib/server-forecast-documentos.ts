import { SaxesParser } from "saxes";
import { PDFDocument } from "pdf-lib";
import { fetchWithTimeout } from "./fetch-timeout";
import { interpretarRetornoForecast } from "./forecast-emissao";

export const LIMITE_DOCUMENTO_HML = 5 * 1024 * 1024;
export type TipoDocumentoHml = "xml" | "pdf";
export type IdentidadeDocumentoHml = {
  ref: string;
  cnpj: string;
  serie: string;
  chave_confirmada?: string | null;
  protocolo_confirmado?: string | null;
  payload: { valor_total: string; cpf_destinatario?: string; cnpj_destinatario?: string };
};
export type ProvaXmlHml = {
  chave: string;
  protocolo: string;
  numero: string;
  serie: string;
  cnpj: string;
  valor_total: string;
  ambiente: "homologacao";
  validacao: "estrutura_identidade_sem_assinatura";
};
const NS = "http://www.portalfiscal.inf.br/nfe";

export function conferirXmlHomologacao(
  bytes: Uint8Array,
  esperado: IdentidadeDocumentoHml,
): ProvaXmlHml {
  if (bytes.length === 0 || bytes.length > LIMITE_DOCUMENTO_HML)
    throw new Error("XML fora do limite de tamanho.");
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parser = new SaxesParser({ xmlns: true });
    const campos = new Set([
      "nfeProc/NFe/infNFe/ide/tpAmb",
      "nfeProc/NFe/infNFe/ide/mod",
      "nfeProc/NFe/infNFe/ide/nNF",
      "nfeProc/NFe/infNFe/ide/serie",
      "nfeProc/NFe/infNFe/emit/CNPJ",
      "nfeProc/NFe/infNFe/dest/CNPJ",
      "nfeProc/NFe/infNFe/dest/CPF",
      "nfeProc/NFe/infNFe/dest/xNome",
      "nfeProc/NFe/infNFe/total/ICMSTot/vNF",
      "nfeProc/protNFe/infProt/tpAmb",
      "nfeProc/protNFe/infProt/chNFe",
      "nfeProc/protNFe/infProt/nProt",
      "nfeProc/protNFe/infProt/cStat",
    ]);
    const valores = new Map<string, string>();
    const blocos = new Set<string>();
    const unicos = new Set([
      "nfeProc/NFe",
      "nfeProc/NFe/infNFe",
      "nfeProc/NFe/infNFe/ide",
      "nfeProc/NFe/infNFe/emit",
      "nfeProc/NFe/infNFe/dest",
      "nfeProc/NFe/infNFe/total",
      "nfeProc/NFe/infNFe/total/ICMSTot",
      "nfeProc/protNFe",
      "nfeProc/protNFe/infProt",
    ]);
    const pilha: string[] = [];
    let nos = 0,
      ids = 0,
      prots = 0,
      nfes = 0,
      folha: string | null = null,
      id = "";
    const recusar = () => {
      throw new Error("XML divergente");
    };
    parser.on("doctype", recusar);
    parser.on("error", recusar);
    parser.on("processinginstruction", recusar);
    parser.on("xmldecl", (decl) => {
      if (decl.version !== "1.0" || (decl.encoding && decl.encoding.toLowerCase() !== "utf-8"))
        recusar();
    });
    parser.on("opentag", (tag) => {
      if (folha || ++nos > 100000 || pilha.length >= 64) recusar();
      pilha.push(tag.local);
      const path = pilha.join("/");
      if (unicos.has(path)) {
        if (blocos.has(path) || tag.uri !== NS) recusar();
        blocos.add(path);
      }
      if (
        pilha.length === 1 &&
        (tag.local !== "nfeProc" || tag.uri !== NS || tag.attributes["versao"]?.value !== "4.00")
      )
        recusar();
      if (path === "nfeProc/NFe" && ++nfes !== 1) recusar();
      if (path === "nfeProc/protNFe" && ++prots !== 1) recusar();
      if (path === "nfeProc/NFe/infNFe") {
        if (++ids !== 1 || tag.uri !== NS) recusar();
        id = tag.attributes["Id"]?.value ?? "";
      }
      if (campos.has(path)) {
        if (tag.uri !== NS || valores.has(path)) recusar();
        valores.set(path, "");
        folha = path;
      }
      // Campos fiscais não podem ser escondidos em uma troca de namespace.
      if (path.startsWith("nfeProc/NFe/infNFe") || path.startsWith("nfeProc/protNFe")) {
        if (tag.uri !== NS) recusar();
      }
    });
    const textoCampo = (s: string) => {
      if (folha) {
        const valor = (valores.get(folha) ?? "") + s;
        if (valor.length > 1024) recusar();
        valores.set(folha, valor);
      }
    };
    parser.on("text", textoCampo);
    parser.on("cdata", textoCampo);
    parser.on("closetag", () => {
      if (folha === pilha.join("/")) folha = null;
      pilha.pop();
    });
    parser.write(texto).close();
    const ler = (path: string) => valores.get(path)?.trim() ?? "";
    const nfe = "nfeProc/NFe/infNFe/",
      prot = "nfeProc/protNFe/infProt/";
    const chave = ler(prot + "chNFe"),
      numero = ler(nfe + "ide/nNF"),
      serie = ler(nfe + "ide/serie"),
      cnpj = ler(nfe + "emit/CNPJ"),
      protocolo = ler(prot + "nProt");
    if (
      (esperado.chave_confirmada && chave !== esperado.chave_confirmada) ||
      (esperado.protocolo_confirmado && protocolo !== esperado.protocolo_confirmado)
    )
      recusar();
    const valor = ler(nfe + "total/ICMSTot/vNF"),
      docCnpj = ler(nfe + "dest/CNPJ"),
      docCpf = ler(nfe + "dest/CPF");
    if (
      nfes !== 1 ||
      ids !== 1 ||
      prots !== 1 ||
      id !== `NFe${chave}` ||
      ler(nfe + "ide/mod") !== "55" ||
      ler(nfe + "ide/tpAmb") !== "2" ||
      ler(prot + "tpAmb") !== "2" ||
      !["100", "150"].includes(ler(prot + "cStat"))
    )
      recusar();
    if (
      !/^\d+\.\d{2}$/.test(valor) ||
      valor !== esperado.payload.valor_total ||
      (esperado.payload.cnpj_destinatario
        ? docCnpj !== esperado.payload.cnpj_destinatario || !!docCpf
        : docCpf !== esperado.payload.cpf_destinatario || !!docCnpj) ||
      ler(nfe + "dest/xNome") !== "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
    )
      recusar();
    const r = interpretarRetornoForecast(
      {
        ref: esperado.ref,
        cnpj_emitente: cnpj,
        ambiente: "HOMOLOGACAO",
        status: "autorizado",
        chave_nfe: chave,
        protocolo,
        numero,
        serie,
      },
      esperado,
    );
    if (r.estado !== "autorizada") recusar();
    return {
      chave,
      protocolo,
      numero,
      serie,
      cnpj,
      valor_total: valor,
      ambiente: "homologacao",
      validacao: "estrutura_identidade_sem_assinatura",
    };
  } catch {
    throw new Error(
      "XML recusado: confira estrutura, ambiente, CNPJ, chave, protocolo, destinatário e valor. A assinatura digital não foi validada.",
    );
  }
}

export async function conferirPdfHomologacao(bytes: Uint8Array) {
  if (
    bytes.length === 0 ||
    bytes.length > LIMITE_DOCUMENTO_HML ||
    !new TextDecoder().decode(bytes.subarray(0, 8)).startsWith("%PDF-")
  )
    throw new Error("DANFE não contém um PDF válido dentro do limite de tamanho.");
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 1000) throw new Error("Páginas inválidas");
  } catch {
    throw new Error("DANFE recusado: PDF inválido, protegido ou sem páginas.");
  }
}

export async function baixarDocumentoForecast(
  token: string,
  ref: string,
  tipo: TipoDocumentoHml,
  transporte: typeof fetchWithTimeout = fetchWithTimeout,
) {
  if (
    !/^[\x21-\x39\x3b-\x7e]{1,2048}$/.test(token) ||
    !/^CPRHML[a-f0-9]{32}$/.test(ref) ||
    !["xml", "pdf"].includes(tipo)
  )
    throw new Error("Identificação do documento de homologação inválida.");
  try {
    const r = await transporte(
      `https://forecastfiscal.com.br/api/v2/nfe/${ref}.${tipo}`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Basic ${btoa(`${token}:`)}`,
          Accept: tipo === "xml" ? "application/xml, text/xml" : "application/pdf",
        },
      },
      20_000,
    );
    if (!r.ok) throw new Error("HTTP");
    const tamanho = r.headers.get("content-length");
    if (tamanho !== null && (!/^\d+$/.test(tamanho) || Number(tamanho) > LIMITE_DOCUMENTO_HML))
      throw new Error("Tamanho");
    const leitor = r.body?.getReader();
    if (!leitor) throw new Error("Sem conteúdo");
    const partes: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await leitor.read();
        if (done) break;
        total += value.length;
        if (total > LIMITE_DOCUMENTO_HML) throw new Error("Tamanho");
        partes.push(value);
      }
    } catch (e) {
      await leitor.cancel().catch(() => {});
      throw e;
    } finally {
      leitor.releaseLock();
    }
    if (total === 0) throw new Error("Vazio");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const parte of partes) {
      bytes.set(parte, offset);
      offset += parte.length;
    }
    return bytes;
  } catch {
    throw new Error(
      "Não foi possível obter o documento da Forecast. Confira o acesso e consulte a referência; nenhum envio foi repetido.",
    );
  }
}

export function bytesBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function base64Bytes(valor: string) {
  if (valor.length > 7_000_000) throw new Error("Documento excede o limite.");
  const s = atob(valor);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
export async function hashDocumento(bytes: Uint8Array) {
  const copia = new Uint8Array(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copia)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
