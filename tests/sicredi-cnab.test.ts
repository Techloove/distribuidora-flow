import { describe, expect, test } from "bun:test";
import {
  cents,
  documentoFiscal,
  nomeRemessa,
  nomeRemessaHomologacao,
  ascii,
  crc16,
  gerarBrCode,
  gerarRemessa,
  gerarAlteracaoVencimento,
  nossoNumero,
  parseRetorno,
  type CnabConfig,
  type CnabTitulo,
} from "../src/lib/sicredi-cnab";

export const config: CnabConfig = {
  conta_financeira_id: "00000000-0000-4000-8000-000000000003",
  categoria_tarifa_id: null,
  centro_id: "00000000-0000-4000-8000-000000000001",
  nome: "DISTRIBUIDORA TESTE",
  documento: "12345678000195",
  cooperativa: "0165",
  posto: "02",
  beneficiario: "00623",
  conta: "45981",
  conta_dv: "3",
  proxima_remessa: 17,
  proximo_nosso_numero: 3,
  homologado: false,
  juros_mensal: 0,
  multa_percentual: 0,
};
const titulo: CnabTitulo = {
  conta_id: "00000000-0000-4000-8000-000000000002",
  documento: "C123456789",
  nosso_numero: "072000031",
  valor: "1234.56",
  vencimento: "2026-10-30",
  emissao: "2026-10-06",
  nome: "José da Silva",
  cpf_cnpj: "12345678909",
  endereco: "Rua das Flores 10",
  bairro: "Centro",
  cep: "29300000",
  cidade: "Cachoeiro",
  uf: "ES",
};

// Fixture sintética montada pelas posições do manual, sem usar o gerador de remessa.
function line(fields: Array<[number, string]>) {
  const bytes = Array<string>(240).fill(" ");
  for (const [pos, text] of fields) bytes.splice(pos - 1, text.length, ...text);
  return bytes.join("");
}
export function retornoFixture(occ = "06") {
  const h = line([
    [1, "74800000"],
    [18, "2"],
    [19, "12345678000195"],
    [53, "00165"],
    [59, "0000000459813"],
    [143, "2"],
    [144, "06102026"],
    [158, "000001081"],
  ]);
  const l = line([
    [1, "74800011T01"],
    [14, "040"],
    [18, "2"],
    [19, "012345678000195"],
    [54, "00165"],
    [60, "0000000459813"],
  ]);
  const t = line([
    [1, "7480001300001T"],
    [16, occ],
    [38, "072000031"],
    [58, "1"],
    [59, "C123456789"],
    [74, "30102026"],
    [82, "000000000123456"],
    [199, "000000000000300"],
    [214, "0000000000"],
  ]);
  const u = line([
    [1, "7480001300002U"],
    [16, occ],
    [18, "000000000000100"],
    [33, "000000000000050"],
    [48, "000000000000000"],
    [63, "000000000000000"],
    [78, "000000000123506"],
    [93, "000000000123206"],
    [108, "000000000000000"],
    [123, "000000000000000"],
    [138, "30102026"],
    [146, "31102026"],
  ]);
  return (
    [
      h,
      l,
      t,
      u,
      line([
        [1, "74800015"],
        [18, "000004"],
      ]),
      line([
        [1, "74899999"],
        [18, "000001000006"],
      ]),
    ].join("\r\n") + "\r\n"
  );
}
function replaceField(text: string, index: number, start: number, value: string) {
  const lines = text.split("\r\n");
  const s = lines[index]!;
  lines[index] = s.slice(0, start - 1) + value + s.slice(start - 1 + value.length);
  return lines.join("\r\n");
}
describe("Sicredi CNAB 240 — remessa", () => {
  test("calcula DV módulo 11 com cooperativa, posto e beneficiário", () => {
    expect(nossoNumero(config, 2007, 3)).toBe("072000031");
    expect(nossoNumero({ ...config, posto: "03" }, 2007, 3)).not.toBe("072000031");
  });
  test("usa centavos exatos, sem arredondamento silencioso", () => {
    expect(cents("1234.56")).toBe(123456n);
    expect(() => cents("1.001")).toThrow();
    expect(() => cents("-1")).toThrow();
  });
  test("gera CRLF, registros ASCII de 240 bytes e totalizadores", () => {
    const file = gerarRemessa(config, [titulo], "2026-10-06", "153000");
    const records = file.content.trimEnd().split("\r\n");
    expect(records).toHaveLength(6);
    expect(file.filename).toBe("00623O06.000017");
    for (const r of file.content.split("\r\n").slice(0, -1)) {
      expect(r.length).toBe(240);
      expect(new TextEncoder().encode(r).length).toBe(240);
    }
    expect(records[0]!.slice(157, 166)).toBe("000017081");
    expect(records[1]!.slice(13, 16)).toBe("040");
    expect(records[2]!.slice(37, 57)).toBe("072000031           ");
    expect(records[2]!.slice(57, 62)).toBe("11112");
    expect(records[2]!.slice(85, 100)).toBe("000000000123456");
    expect(records[3]!.slice(33, 46)).toBe("JOSE DA SILVA");
    expect(records[4]!.slice(17, 46)).toBe("00000400000000000000000000000");
    expect(records[5]!.slice(17, 29)).toBe("000001000006");
  });
  test("gera R para multa e juros mensais em P", () => {
    const records = gerarRemessa(
      { ...config, juros_mensal: 1.5, multa_percentual: 2 },
      [titulo],
      "2026-10-06",
      "153000",
    ).content.split("\r\n");
    expect(records[2]!.slice(117, 141)).toBe("231102026000000000000150");
    expect(records[4]!.slice(13, 14)).toBe("R");
    expect(records[4]!.slice(65, 89)).toBe("231102026000000000000200");
    expect(records[5]!.slice(17, 23)).toBe("000005");
  });
  test("bloqueia dados ausentes, overflow, duplicidade e datas impossíveis", () => {
    for (const t of [
      { ...titulo, cep: "" },
      { ...titulo, uf: "" },
      { ...titulo, nome: "" },
      { ...titulo, vencimento: "2026-02-30" },
      { ...titulo, valor: "0" },
      { ...titulo, documento: "DOCUMENTO-LONGO" },
    ])
      expect(() => gerarRemessa(config, [t], "2026-10-06", "153000")).toThrow();
    expect(() => gerarRemessa(config, [titulo, titulo], "2026-10-06", "153000")).toThrow();
  });
});
describe("Sicredi CNAB 240 — retorno", () => {
  test("lê T/U, valor recebido bruto e líquido separadamente", () => {
    const [event] = parseRetorno(retornoFixture(), config);
    expect(event).toEqual({
      nosso_numero: "072000031",
      documento: "C123456789",
      ocorrencia: "06",
      motivos: "0000000000",
      valor_titulo: "1234.56",
      valor_recebido: "1235.06",
      valor_liquido: "1232.06",
      juros: "1.00",
      desconto: "0.50",
      abatimento: "0.00",
      iof: "0.00",
      tarifas: "3.00",
      outras_despesas: "0.00",
      outros_creditos: "0.00",
      vencimento: "2026-10-30",
      data_ocorrencia: "2026-10-30",
      data_credito: "2026-10-31",
    });
  });
  test("aceita LF e conserva ocorrências desconhecidas para conferência", () => {
    expect(parseRetorno(retornoFixture("51").replace(/\r\n/g, "\n"), config)[0]!.ocorrencia).toBe(
      "51",
    );
  });
  test("rejeita banco, conta, CNPJ ou layout divergentes", () => {
    for (const [start, value] of [
      [1, "001"],
      [19, "99999999000199"],
      [59, "000000099999"],
      [143, "1"],
      [164, "082"],
    ] as const)
      expect(() => parseRetorno(replaceField(retornoFixture(), 0, start, value), config)).toThrow();
  });
  test("rejeita arquivo truncado, U órfão, T sem U e sequências erradas", () => {
    expect(() => parseRetorno(retornoFixture().slice(0, -8), config)).toThrow();
    expect(() => parseRetorno(replaceField(retornoFixture(), 2, 14, "U"), config)).toThrow();
    expect(() => parseRetorno(replaceField(retornoFixture(), 3, 14, "T"), config)).toThrow();
    expect(() => parseRetorno(replaceField(retornoFixture(), 3, 9, "00005"), config)).toThrow();
  });
  test("rejeita totalizadores, data e dinheiro inválidos", () => {
    for (const [index, start, value] of [
      [4, 18, "000003"],
      [5, 24, "000007"],
      [3, 138, "31022026"],
      [3, 78, "ABCDEFGHIJKLMNO"],
    ] as const)
      expect(() =>
        parseRetorno(replaceField(retornoFixture(), index, start, value), config),
      ).toThrow();
  });
  test("rejeita divergência de ocorrência entre T e U", () => {
    expect(() => parseRetorno(replaceField(retornoFixture(), 3, 16, "09"), config)).toThrow();
  });
});

describe("BR Code / boleto híbrido", () => {
  test("CRC independente: vetor CCITT e exemplo Sicredi", () => {
    expect(crc16("123456789")).toBe("29B1");
    const sample =
      "00020126910014br.gov.bcb.pix2569pix-qrcode.sicredi.com.br/qr/v2/cobv/c1f7e23631cd49c8be2ec56551f129775204000053039865802BR5903PIX6006Cidade62070503***6304";
    expect(crc16(sample)).toBe("8A39");
  });
  test("QR dinâmico preserva URL, indica 12 e calcula CRC", () => {
    const payload = gerarBrCode(
      "pix-qrcode.sicredi.com.br/qr/v2/cobv/040360d740164ea286651ad210d76bc1",
    );
    expect(payload.startsWith("0002010102122691")).toBe(true);
    expect(payload.endsWith(crc16(payload.slice(0, -4)))).toBe(true);
    expect(() => gerarBrCode("outro-banco.com/qr/teste")).toThrow();
  });
  test("remessa Y04 usa chave aleatória sem TXID inventado", () => {
    const records = gerarRemessa(
      { ...config, tipo_cobranca: "HIBRIDO", chave_pix: "a1234567-1234-1234-1234-123456789abc" },
      [titulo],
      "2026-10-06",
      "153000",
    ).content.split("\r\n");
    expect(records[4]!.slice(13, 19)).toBe("Y 0104");
    expect(records[4]!.slice(81, 158).trim()).toBe("a1234567-1234-1234-1234-123456789abc");
    expect(records[4]!.slice(158, 193).trim()).toBe("");
    expect(records[5]!.slice(17, 23)).toBe("000005");
    expect(() =>
      gerarRemessa({ ...config, tipo_cobranca: "HIBRIDO" }, [titulo], "2026-10-06", "153000"),
    ).toThrow();
  });
  for (const subtype of ["03", "04"])
    test(`retorno Y${subtype} vincula URL e TXID ao T/U anterior`, () => {
      const records = retornoFixture("02").split("\r\n").slice(0, -1);
      records.splice(
        4,
        0,
        line([
          [1, "7480001300003Y"],
          [16, "02"],
          [18, subtype],
          [82, "pix-qrcode.sicredi.com.br/qr/v2/cobv/040360d740164ea286651ad210d76bc1"],
          [159, "100090400888000020210324000094507"],
        ]),
      );
      records[5] = line([
        [1, "74800015"],
        [18, "000005"],
      ]);
      records[6] = line([
        [1, "74899999"],
        [18, "000001"],
        [24, "000007"],
      ]);
      const [event] = parseRetorno(records.join("\r\n") + "\r\n", config);
      expect(event!.pix?.txid).toBe("100090400888000020210324000094507");
      expect(event!.pix?.url).toContain("pix-qrcode.sicredi.com.br");
    });
});

describe("Alteração de vencimento CNAB", () => {
  test("instrução 06 preserva nosso número, encargos e dados do pagador", () => {
    const c = {
      ...config,
      juros_mensal: 1.5,
      multa_percentual: 2,
      tipo_cobranca: "HIBRIDO" as const,
      chave_pix: "a1234567-1234-1234-1234-123456789abc",
    };
    const original = gerarRemessa(c, [titulo], "2026-10-06", "153000");
    const altered = gerarAlteracaoVencimento(
      { ...c, proxima_remessa: 18 },
      original.content,
      titulo.nosso_numero,
      "2026-11-20",
      "2026-10-06",
      "154000",
    );
    const records = altered.content.split("\r\n").slice(0, -1);
    expect(records).toHaveLength(7);
    expect(records.every((r) => r.length === 240)).toBe(true);
    expect(records[2]!.slice(15, 17)).toBe("06");
    expect(records[2]!.slice(37, 57).trim()).toBe(titulo.nosso_numero);
    expect(records[2]!.slice(77, 85)).toBe("20112026");
    expect(records[2]!.slice(118, 141)).toBe("21112026000000000000150");
    expect(records[4]!.slice(66, 74)).toBe("21112026");
    expect(records.some((r) => r[13] === "Y")).toBe(false);
    expect(altered.filename).toBe("00623O06.000018");
    expect(() =>
      gerarAlteracaoVencimento(
        c,
        original.content,
        "999999999",
        "2026-11-20",
        "2026-10-06",
        "154000",
      ),
    ).toThrow();
  });
  test("retorno 14 informa o vencimento efetivo do banco", () => {
    const content = replaceField(retornoFixture("14"), 2, 74, "20112026");
    expect(parseRetorno(content, config)[0]!.vencimento).toBe("2026-11-20");
  });
});

describe("Manual Sicredi 3.0", () => {
  test("meses usam os códigos oficiais e CRM mantém a remessa sem consumir sequencial", () => {
    for (let month = 1; month <= 12; month++) {
      expect(nomeRemessa("00623", `2026-${String(month).padStart(2, "0")}-06`, 17)).toBe(
        `00623${"123456789OND"[month - 1]}06.000017`,
      );
    }
    const remessa = gerarRemessa(config, [titulo], "2026-10-06", "153000");
    expect(nomeRemessaHomologacao(remessa.filename, remessa.content)).toBe("00623O06.CRM");
    expect(nomeRemessaHomologacao("00623A06.000017", remessa.content)).toBe("00623O06.CRM");
    expect(() => nomeRemessaHomologacao("retorno.CRT")).toThrow();
    expect(config.proxima_remessa).toBe(17);
  });
  test("preserva CNPJ alfanumérico nos headers e no pagador", () => {
    const doc = "12.ABC.345/01DE-35";
    expect(documentoFiscal(doc.toLowerCase())).toBe("12ABC34501DE35");
    const generated = gerarRemessa(
      { ...config, documento: doc },
      [{ ...titulo, cpf_cnpj: doc }],
      "2026-10-06",
      "153000",
    );
    const records = generated.content.split("\r\n");
    expect(records[0]!.slice(18, 32)).toBe("12ABC34501DE35");
    expect(records[1]!.slice(18, 33)).toBe("012ABC34501DE35");
    expect(records[3]!.slice(18, 33)).toBe("012ABC34501DE35");
    expect(() => documentoFiscal("ABCDEF12345")).toThrow();
    expect(() => documentoFiscal("12ABC34501DEAB")).toThrow();
  });
  test("retorno identifica o beneficiário alfanumérico sem coerção numérica", () => {
    let content = replaceField(retornoFixture(), 0, 19, "12ABC34501DE35");
    content = replaceField(content, 1, 19, "012ABC34501DE35");
    expect(parseRetorno(content, { ...config, documento: "12ABC34501DE35" })).toHaveLength(1);
    expect(() => parseRetorno(content, { ...config, documento: "12ABC34501DF35" })).toThrow();
  });
  test("campos descritivos seguem a lista de caracteres permitidos", () => {
    expect(ascii("João @ $ # & !*-()[]{},.;:/%+=")).toBe("JOAO         !*-()[]{},.;:/%+=");
  });
});
