// Teste isolado de funções de servidor; todas as chamadas HTTP são simuladas.
import { mock } from "bun:test";
import assert from "node:assert/strict";
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validar;
    return {
      inputValidator(fn) {
        validar = fn;
        return this;
      },
      handler(fn) {
        return (args) => fn({ data: validar(args.data) });
      },
    };
  },
}));
mock.module("@tanstack/react-start/server", () => ({ getRequestHeader: () => undefined }));
process.env.EXT_SUPABASE_URL = "https://supabase.example.test";
process.env.EXT_SUPABASE_ANON_KEY = "anon-fixture";
process.env.IE_API_URL = "https://ie.example.test/{documento}";
process.env.IE_API_KEY = "fixture-fiscal";
delete process.env.CNPJA_API_KEY;
let role = "representante",
  permitido = true,
  vinculado = true,
  rate = true;
const externos = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://supabase.example.test")) {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
    if (url.includes("/auth/v1/user")) return Response.json({ id: "fixture-rep" });
    if (url.includes("/rpc/saas_acesso_330")) return Response.json(true);
    if (url.includes("/rest/v1/profiles")) return Response.json([{ ativo: true }]);
    if (url.includes("/rest/v1/user_roles")) return Response.json([{ role }]);
    if (url.includes("/rpc/consulta_cliente_representante_permitida_337"))
      return Response.json(permitido && vinculado);
    if (url.includes("/rpc/consumir_rate_limit")) return Response.json(rate);
    throw Error("Endpoint não previsto");
  }
  externos.push(url);
  if (url.includes("brasilapi.com.br/api/cnpj"))
    return Response.json({
      cnpj: "11222333000181",
      razao_social: "Empresa exemplo",
      nome_fantasia: "Exemplo",
      logradouro: "Rua de exemplo",
      numero: "10",
      bairro: "Centro",
      municipio: "Vitória",
      uf: "ES",
      cep: "29010000",
      ddd_telefone_1: "2733334444",
      email: "contato@example.test",
    });
  if (url.startsWith("https://ie.example.test/"))
    return Response.json({ inscricoes: [{ inscricao: "123456789", uf: "ES", situacao: "ATIVA" }] });
  throw Error("Provedor inesperado: " + url);
};
const { consultarDocumento } = await import("../src/lib/consulta-cadastral.functions.ts");
const { consultarInscricaoEstadual } = await import("../src/lib/inscricao-estadual.functions.ts");
const data = {
  documento: "11222333000181",
  cadastroRepresentante: true,
  accessToken: "fixture-token",
};
const cnpj = await consultarDocumento({ data });
assert.equal(cnpj.ok, true);
assert.equal(cnpj.dados.razao_social, "Empresa exemplo");
const ie = await consultarInscricaoEstadual({ data });
assert.equal(ie.ok, true);
assert.equal(ie.registros[0].inscricao, "123456789");
const chamadas = externos.length;
const cpf = await consultarDocumento({ data: { ...data, documento: "11144477735" } });
assert.equal(cpf.ok, false);
assert.equal(cpf.codigo, "invalido");
assert.equal(externos.length, chamadas, "Representante não consulta CPF");
await assert.rejects(
  () => consultarDocumento({ data: { ...data, cadastroRepresentante: false } }),
  /sem permissão/,
);
permitido = false;
await assert.rejects(() => consultarDocumento({ data }), /não liberado/);
permitido = true;
vinculado = false;
await assert.rejects(() => consultarInscricaoEstadual({ data }), /não liberado/);
vinculado = true;
rate = false;
await assert.rejects(() => consultarDocumento({ data }), /Limite de consultas/);
rate = true;
assert.equal(externos.length, chamadas, "Negativas não chamam provedores");
role = "admin";
const admin = await consultarDocumento({ data: { ...data, cadastroRepresentante: false } });
assert.equal(admin.ok, true);
console.log(
  "Consulta337 OK: CNPJ e IE, permissão de cadastro, vínculo ativo, CPF recusado para representante, rate limit e caminho administrativo preservado; somente HTTP simulado.",
);
