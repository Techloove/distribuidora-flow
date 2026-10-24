import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  conferirXmlHomologacao,
  conferirPdfHomologacao,
  baixarDocumentoForecast,
  bytesBase64,
  base64Bytes,
  hashDocumento,
  LIMITE_DOCUMENTO_HML,
  type IdentidadeDocumentoHml,
} from "../src/lib/server-forecast-documentos";

const esperado: IdentidadeDocumentoHml = {
  ref: "CPRHML00000000000040008000000000000001",
  cnpj: "12345678000195",
  serie: "1",
  payload: { valor_total: "100.00", cnpj_destinatario: "12345678000195" },
};
function chave() {
  const base = "3226101234567800019555001000000001112345678";
  let soma = 0;
  for (let i = 42, p = 2; i >= 0; i--, p = p === 9 ? 2 : p + 1) soma += Number(base[i]) * p;
  const dv = 11 - (soma % 11);
  return base + (dv >= 10 ? 0 : dv);
}
const encode = (s: string) => new TextEncoder().encode(s);
function xml() {
  const key = chave();
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>1</nNF><tpAmb>2</tpAmb></ide><emit><CNPJ>12345678000195</CNPJ></emit><dest><CNPJ>12345678000195</CNPJ><xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome></dest><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>123456789012345</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}
test("XML processado confere identidade, ambiente e total sem alegar assinatura validada", () => {
  const r = conferirXmlHomologacao(encode(xml()), esperado);
  expect(r).toMatchObject({
    chave: chave(),
    cnpj: esperado.cnpj,
    protocolo: "123456789012345",
    valor_total: "100.00",
    ambiente: "homologacao",
    validacao: "estrutura_identidade_sem_assinatura",
  });
  const prefixado = xml()
    .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, "<$1n:$2")
    .replace('xmlns="', 'xmlns:n="');
  expect(conferirXmlHomologacao(encode(prefixado), esperado).chave).toBe(chave());
  const bom = new Uint8Array([239, 187, 191, ...encode(xml())]);
  expect(conferirXmlHomologacao(bom, esperado).chave).toBe(chave());
});
test("recusa produção, rejeição, outro valor, destinatário ou identidade", () => {
  for (const s of [
    xml().replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"),
    xml().replace("<cStat>100</cStat>", "<cStat>999</cStat>"),
    xml().replace("<vNF>100.00</vNF>", "<vNF>100.01</vNF>"),
    xml().replace("<emit><CNPJ>12345678000195", "<emit><CNPJ>99999999000199"),
    xml().replace("<dest><CNPJ>12345678000195", "<dest><CNPJ>99999999000199"),
    xml().replace("<nNF>1</nNF>", "<nNF>2</nNF>"),
    xml().replace("<nProt>123456789012345</nProt>", ""),
    xml().replace('Id="NFe', 'Id="ERRO'),
    xml().replace("http://www.portalfiscal.inf.br/nfe", "https://nao-fiscal.example.test"),
  ])
    expect(() => conferirXmlHomologacao(encode(s), esperado)).toThrow("XML recusado");
  expect(() =>
    conferirXmlHomologacao(encode(xml()), { ...esperado, chave_confirmada: "0".repeat(44) }),
  ).toThrow("XML recusado");
  expect(() =>
    conferirXmlHomologacao(encode(xml()), { ...esperado, protocolo_confirmado: "999999999999999" }),
  ).toThrow("XML recusado");
});
test("recusa DTD, entidades, campos repetidos, namespaces trocados, XML inválido e UTF-8 inválido", () => {
  for (const s of [
    xml().replace(
      "<nfeProc ",
      "<!DOCTYPE nfeProc [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><nfeProc ",
    ),
    xml().replace("<vNF>100.00</vNF>", "<vNF>&nao_definida;</vNF>"),
    xml().replace("<vNF>100.00</vNF>", "<vNF>100.00</vNF><vNF>100.00</vNF>"),
    xml().replace("<vNF>100.00</vNF>", "<vNF>100.<x>00</x></vNF>"),
    xml().replace("<dest>", "<dest xmlns='https://outro.example.test'>"),
    xml().replace("</protNFe>", "<infProt/></protNFe>"),
    xml().replace("</NFe>", "</NFe><NFe/>"),
    xml().replace("</nfeProc>", ""),
    "<html>SEGREDO-REMOTO</html>",
  ])
    expect(() => conferirXmlHomologacao(encode(s), esperado)).toThrow("XML recusado");
  expect(() => conferirXmlHomologacao(new Uint8Array([255, 255]), esperado)).toThrow(
    "XML recusado",
  );
  expect(() => conferirXmlHomologacao(new Uint8Array(LIMITE_DOCUMENTO_HML + 1), esperado)).toThrow(
    "tamanho",
  );
});
test("PDF é verificado quanto ao formato e às páginas, sem reescrever o original", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await doc.save();
  const antes = await hashDocumento(bytes);
  await conferirPdfHomologacao(bytes);
  expect(await hashDocumento(bytes)).toBe(antes);
  await expect(conferirPdfHomologacao(encode("<html>erro</html>"))).rejects.toThrow("PDF válido");
  await expect(conferirPdfHomologacao(encode("%PDF-1.7\nINVALIDO"))).rejects.toThrow(
    "PDF inválido",
  );
});
test("download usa somente GET por referência fixa e Basic, sem seguir redirecionamento", async () => {
  let calls = 0;
  const bytes = await baixarDocumentoForecast(
    "TOKEN-FICTICIO",
    esperado.ref,
    "xml",
    async (url, init) => {
      calls++;
      expect(url).toBe(`https://forecastfiscal.com.br/api/v2/nfe/${esperado.ref}.xml`);
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${btoa("TOKEN-FICTICIO:")}`,
      );
      return new Response(xml());
    },
  );
  expect(calls).toBe(1);
  expect(conferirXmlHomologacao(bytes, esperado).chave).toBe(chave());
  await expect(
    baixarDocumentoForecast("TOKEN", "../../", "xml", async () => {
      calls++;
      return new Response();
    }),
  ).rejects.toThrow("Identificação");
  expect(calls).toBe(1);
});
test("limite é imposto no stream mesmo sem Content-Length, e a leitura é cancelada", async () => {
  let cancelado = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelado = true;
    },
  });
  await expect(
    baixarDocumentoForecast("TOKEN", esperado.ref, "pdf", async () => new Response(stream)),
  ).rejects.toThrow("Não foi possível");
  expect(cancelado).toBe(true);
  await expect(
    baixarDocumentoForecast(
      "TOKEN",
      esperado.ref,
      "xml",
      async () =>
        new Response("erro", { headers: { "Content-Length": String(LIMITE_DOCUMENTO_HML + 1) } }),
    ),
  ).rejects.toThrow("Não foi possível");
});
test("erro HTTP, resposta vazia e falha de rede não causam retry ou vazamento", async () => {
  for (const responder of [
    () => new Response("SEGREDO", { status: 401 }),
    () => new Response("SEGREDO", { status: 404 }),
    () => new Response(""),
    () => {
      throw new Error("SEGREDO");
    },
  ]) {
    let calls = 0;
    let mensagem = "";
    try {
      await baixarDocumentoForecast("TOKEN", esperado.ref, "xml", async () => {
        calls++;
        return responder();
      });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(calls).toBe(1);
    expect(mensagem).toContain("Não foi possível");
    expect(mensagem).not.toContain("SEGREDO");
  }
});
test("base64 preserva bytes em blocos e SHA-256 usa o vetor conhecido", async () => {
  const b = new Uint8Array(32769);
  for (let i = 0; i < b.length; i++) b[i] = i % 256;
  expect(base64Bytes(bytesBase64(b))).toEqual(b);
  expect(await hashDocumento(encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
