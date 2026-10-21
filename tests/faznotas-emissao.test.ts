import { expect, test } from "bun:test";
import { contextoFiscal } from "./fixtures/faznotas-nfe";
import {
  documentoValidoNfe,
  hashPreviaNfe,
  prepararDocumentoNfe,
  ratearDescontoNfe,
  type OpcoesNfe,
} from "../src/lib/faznotas-documento";
import { chamarFaznotas, sincronizarProdutoNfe } from "../src/lib/server-faznotas-nfe";
const opcoes: OpcoesNfe = { consumidor: "0", indicadorIe: "1", modalidade: "3" },
  cep = { uf: "ES", localidade: "Vitória" };
test("prepara NF normal sem credenciais e mantém origem e referência estáveis", () => {
  const c = contextoFiscal(),
    p = prepararDocumentoNfe(c, opcoes, cep);
  expect(p.emissao["numero-origem"]).toBe("CPR-NFE-" + c.dados.nota["id"]);
  expect(p.total).toBe("100.00");
  expect(p.emissao.cfop).toBe("5102");
  expect(p.emissao.cliente["tipo-inscricao-estadual"]).toBe("1");
  expect(hashPreviaNfe(prepararDocumentoNfe(c, opcoes, cep))).toBe(hashPreviaNfe(p));
  const novo = structuredClone(c);
  novo.dados.itens[0]!.produto["descricao"] = "Outro nome";
  expect(prepararDocumentoNfe(novo, opcoes, cep).produtos[0]!.referencia).not.toBe(
    p.produtos[0]!.referencia,
  );
  expect(JSON.stringify(p)).not.toContain("accessToken");
});
test("rateio conserva centavos e reconcilia frete por volume, despesas e desconto", () => {
  expect(ratearDescontoNfe([100n, 100n, 100n], 1n)).toEqual([1n, 0n, 0n]);
  const c = contextoFiscal();
  c.dados.itens[0]!.item = { quantidade: 3, preco_unitario: 33.3333, total: 100 };
  c.dados.pedido["desconto_valor"] = 7.25;
  c.dados.pedido["forma_desconto_valor"] = 2.75;
  c.dados.pedido["frete_valor"] = 5;
  c.dados.pedido["frete_volume_valor"] = 6;
  c.dados.pedido["outras_despesas"] = 2;
  c.dados.pedido["forma_acrescimo_valor"] = 3;
  c.dados.pedido["total_liquido"] = 106;
  c.dados.nota["valor_total"] = 106;
  const p = prepararDocumentoNfe(c, opcoes, cep);
  expect(p.total).toBe("106.00");
  expect(p.emissao.transporte["valor-frete"]).toBe("11.00");
  expect(p.emissao["valor-despesas"]).toBe("5.00");
  const i = p.emissao.itens[0]!;
  expect(
    Math.round(
      (Number(i["valor-unitario"]) - Number(i["desconto-unitario"])) * Number(i.quantidade) * 100,
    ),
  ).toBe(9000);
  expect(p.emissao).not.toHaveProperty("faturas");
  expect(p.avisos.join(" ")).toContain("Parcelas não incluídas");
});
test("não envia documento inconsistente, já vinculado, sem revisão ou sem liberação", () => {
  const c = contextoFiscal();
  expect(() => prepararDocumentoNfe({ ...c, vinculada: true }, opcoes, cep)).toThrow(
    "já vinculada",
  );
  const bloqueado = structuredClone(c);
  bloqueado.dados.liberacao!["liberado"] = false;
  expect(() => prepararDocumentoNfe(bloqueado, opcoes, cep)).toThrow("liberar");
  const fiscal = structuredClone(c);
  fiscal.dados.itens[0]!.regras[0]!.revisao_valida = false;
  expect(() => prepararDocumentoNfe(fiscal, opcoes, cep)).toThrow("sem tributação revisada");
  expect(() => prepararDocumentoNfe(c, opcoes, { ...cep, uf: "MG" })).toThrow("diverge");
  expect(() => prepararDocumentoNfe(c, opcoes, { ...cep, localidade: "Outra cidade" })).toThrow(
    "Cidade",
  );
  const total = structuredClone(c);
  total.dados.nota["valor_total"] = 99;
  expect(() => prepararDocumentoNfe(total, opcoes, cep)).toThrow("Totais");
  const contribuinte = structuredClone(c);
  contribuinte.dados.cliente["inscricao_estadual"] = "";
  expect(() => prepararDocumentoNfe(contribuinte, opcoes, cep)).toThrow("inscrição estadual");
});
test("CPF/CNPJ verifica dígitos e suporta documento alfanumérico do cliente", () => {
  expect(documentoValidoNfe("12345678000195")).toBe(true);
  expect(documentoValidoNfe("12345678000194")).toBe(false);
  expect(documentoValidoNfe("11111111111")).toBe(false);
  expect(documentoValidoNfe("52998224725")).toBe(true);
  expect(documentoValidoNfe("12ABC34501DE35")).toBe(true);
});
test("cliente e produtos permanecem isolados na requisição e há rastreabilidade sem vazar token", async () => {
  const r = await chamarFaznotas(
    "TOKEN-FICTICIO",
    "/nfe/emissao",
    "POST",
    {},
    async (url, init) => {
      expect(String(url)).toEndWith("/nfe/emissao");
      expect(init?.redirect).toBe("error");
      return Response.json(
        { status: "001", data: { recibo: "recibo-ficticio" }, descricao: "TOKEN-FICTICIO" },
        { headers: { "X-Request-Id": "req-teste" } },
      );
    },
  );
  expect(r.meta?.["request_id"]).toBe("req-teste");
  expect(JSON.stringify(r)).not.toContain("TOKEN-FICTICIO");
  await expect(
    chamarFaznotas("x", "/nfe/emissao", "POST", {}, async () => {
      throw new Error("erro bruto de rede");
    }),
  ).rejects.toThrow("comunicação foi interrompida");
});
test("produto fiscal é criado sem PUT destrutivo e divergência remota bloqueia envio", async () => {
  const p = prepararDocumentoNfe(contextoFiscal(), opcoes, cep).produtos[0]!;
  const chamadas: string[] = [];
  await sincronizarProdutoNfe("ficticio", p, async (_token, path, method) => {
    chamadas.push(method + " " + path);
    return method === "GET" ? { status: "500" } : { status: "001" };
  });
  expect(chamadas).toEqual(["GET /produtos/" + p.referencia, "POST /produtos"]);
  await expect(
    sincronizarProdutoNfe("ficticio", p, async () => ({
      status: "005",
      data: { ...p, ncm: "99999999" },
    })),
  ).rejects.toThrow("diverge do snapshot");
});

test("CFOP interestadual distingue não contribuinte sem presumir enquadramento", () => {
  const c = contextoFiscal();
  c.dados.cliente["uf"] = "MG";
  c.dados.cliente["cidade"] = "Belo Horizonte";
  const regra = structuredClone(c.dados.itens[0]!.regras[0]!);
  regra.cfop = "6108";
  regra.configuracoes.icms!.estados[0]!.estado = "MG";
  const generica = structuredClone(regra);
  generica.cfop = "6102";
  c.dados.itens[0]!.regras = [regra, generica];
  const destino = { uf: "MG", localidade: "Belo Horizonte" };
  expect(() => prepararDocumentoNfe(c, { ...opcoes, indicadorIe: "9" }, destino)).toThrow(
    "não contribuinte",
  );
  expect(
    prepararDocumentoNfe(c, { ...opcoes, indicadorIe: "9", cfop: "6108" }, destino).emissao.cfop,
  ).toBe("6108");
  expect(() => prepararDocumentoNfe(c, { ...opcoes, cfop: "6108" }, destino)).toThrow(
    "não contribuintes",
  );
  expect(() => prepararDocumentoNfe(c, { ...opcoes, cfop: "5102" }, destino)).toThrow(
    "incompatível com a UF",
  );
});
