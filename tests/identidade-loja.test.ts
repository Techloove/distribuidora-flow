import { expect, test } from "bun:test";
import { identidadeLoja, logoLojaValida } from "../src/lib/identidade-loja";
import { gerarHtmlPedidos } from "../src/lib/pedido-impressao";
test("cada documento usa a própria loja e não reaproveita campos removidos", () => {
  const empresa = { nome_fantasia: "Empresa antiga", telefone: "1111", cnpj: "000" };
  const lojaA = {
    nome: "Ferragens",
    nome_fantasia: "Loja A",
    cnpj: "123",
    telefone: null,
    logo_url: "https://example.test/a.png",
  };
  const lojaB = { nome: "Loja B", nome_fantasia: null, cnpj: "456", telefone: "2222" };
  const a = identidadeLoja(lojaA, empresa),
    b = identidadeLoja(lojaB, empresa);
  expect(a.telefone).toBe("");
  expect(a.cnpj).toBe("123");
  expect(b.cnpj).toBe("456");
  expect(b.nome_fantasia).toBe("Loja B");
  expect(empresa.telefone).toBe("1111");
  const doc = (centro: Record<string, unknown>, e: Record<string, unknown>, n: number) => ({
    pedido: { numero: n, data_pedido: "2026-10-20" },
    centro,
    empresa: e,
    cliente: {},
    representante: {},
    forma: {},
    itens: [],
  });
  const html = gerarHtmlPedidos([doc(lojaA, a, 1), doc(lojaB, b, 2)], "");
  expect(html).toContain('src="https://example.test/a.png"');
  expect(html).toContain("Loja A");
  expect(html).toContain("Loja B");
  expect(html).not.toContain("Empresa antiga");
  expect(html).not.toContain("Telefone: 1111");
});
test("logo aceita imagens raster e HTTPS e recusa protocolos e formatos executáveis", () => {
  for (const s of [
    "https://example.test/logo.png",
    "data:image/png;base64,YWJj",
    "data:image/jpeg;base64,YWJj",
    "data:image/webp;base64,YWJj",
  ])
    expect(logoLojaValida(s)).toBe(s);
  for (const s of [
    "javascript:alert(1)",
    "http://example.test/a.png",
    "data:image/svg+xml;base64,YWJj",
    "https://x.test/a <x>",
    "x".repeat(350001),
    null,
  ])
    expect(logoLojaValida(s)).toBeNull();
});
