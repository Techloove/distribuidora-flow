import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import {
  SICOOB_BASE,
  SICOOB_SANDBOX,
  SICOOB_AUTH,
  SICOOB_SCOPES,
  condicoesSicoob,
  respostaSimuladaSicoob,
  instrucaoSicoob,
  confereSicoob,
} from "../src/lib/sicoob-api";
import {
  clienteSicoob,
  consultarExtratoContaSicoob,
  testarSandboxSicoob,
  validarCertificadoSicoob,
  type CertificadoSicoob,
  type TransporteSicoob,
} from "../src/lib/server-sicoob-http";
let temp = "",
  cert: CertificadoSicoob;
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "sicoob-a1-fixture-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "cert.pem"),
      "-subj",
      "/CN=Certificado descartavel de teste",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    [
      "pkcs12",
      "-export",
      "-out",
      join(temp, "cert.pfx"),
      "-inkey",
      join(temp, "key.pem"),
      "-in",
      join(temp, "cert.pem"),
      "-passout",
      "pass:teste",
    ],
    { stdio: "ignore" },
  );
  cert = { pfx: readFileSync(join(temp, "cert.pfx")).toString("base64"), senha: "teste" };
});
afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});
const raw = {
  numeroCliente: 12345,
  codigoModalidade: 1,
  nossoNumero: 123,
  seuNumero: "ERP123",
  valor: 100,
  dataVencimento: "2027-02-20",
  valorAbatimento: 0,
  tipoDesconto: 0,
  situacaoBoleto: "Em Aberto",
  linhaDigitavel: "756" + "1".repeat(44),
  codigoBarras: "756" + "2".repeat(41),
};
test("consulta reconhece estados bancários e recusa condições incompletas ou inválidas", () => {
  expect(condicoesSicoob(raw).situacao).toBe("EM ABERTO");
  expect(condicoesSicoob({ ...raw, situacaoBoleto: "Liquidado" }).situacao).toBe("LIQUIDADO");
  for (const extra of [
    { situacaoBoleto: "desconhecida" },
    { valor: "NaN" },
    { valor: 1.234 },
    { dataVencimento: "2027-02-30" },
    { valorAbatimento: undefined },
    { tipoDesconto: 1 },
    { tipoDesconto: 99 },
    { nossoNumero: "../outro" },
  ])
    expect(() => condicoesSicoob({ ...raw, ...extra })).toThrow();
});
test("vencimento e baixa usam o contrato v3 correto, sem alterar valor ou outras condições", () => {
  const c = condicoesSicoob(raw),
    v = instrucaoSicoob(c, { tipo: "vencimento", data: "2027-03-20" }, "2027-01-01", 8);
  expect(v.body).toEqual({
    numeroCliente: 12345,
    codigoModalidade: 1,
    numeroContratoCobranca: 8,
    prorrogacaoVencimento: { dataVencimento: "2027-03-20" },
  });
  expect(v.esperado.valor).toBe(100);
  expect(confereSicoob(c, v.esperado, "vencimento")).toBe(false);
  expect(confereSicoob(v.esperado, v.esperado, "vencimento")).toBe(true);
  expect(instrucaoSicoob(c, { tipo: "baixar" }, "2027-01-01", 8).body).toEqual({
    numeroCliente: 12345,
    codigoModalidade: 1,
  });
  expect(() =>
    instrucaoSicoob({ ...c, situacao: "LIQUIDADO" }, { tipo: "baixar" }, "2027-01-01", 8),
  ).toThrow();
  expect(() =>
    instrucaoSicoob(c, { tipo: "vencimento", data: "2026-01-01" }, "2027-01-01", 8),
  ).toThrow();
});
test("abatimento em reais e cancelamento não viram desconto percentual nem valor nominal", () => {
  const c = condicoesSicoob(raw),
    a = instrucaoSicoob(c, { tipo: "abatimento", valor: 5.5 }, "2027-01-01", null);
  expect(a.body["abatimento"]).toEqual({ valorAbatimento: 5.5 });
  expect(a.body["valorNominal"]).toBeUndefined();
  expect(a.esperado.valor).toBe(100);
  expect(
    instrucaoSicoob(a.esperado, { tipo: "abatimento", valor: 0 }, "2027-01-01", null).body[
      "abatimento"
    ],
  ).toEqual({ valorAbatimento: 0 });
  for (const valor of [-1, 100, Infinity, NaN, 0.001])
    expect(() => instrucaoSicoob(c, { tipo: "abatimento", valor }, "2027-01-01", null)).toThrow();
});
test("descontos preservam ordens existentes, distinguem percentual e valor, e recusam limites inválidos", () => {
  const c = condicoesSicoob({
    ...raw,
    tipoDesconto: 1,
    dataPrimeiroDesconto: "2027-02-01",
    valorPrimeiroDesconto: 10,
  });
  const d = instrucaoSicoob(
    c,
    { tipo: "desconto", valor: 5, data: "2027-02-10", ordem: 2 },
    "2027-01-01",
    null,
  );
  expect(d.body["desconto"]).toEqual({
    tipoDesconto: 1,
    dataPrimeiroDesconto: "2027-02-01",
    valorPrimeiroDesconto: 10,
    dataSegundoDesconto: "2027-02-10",
    valorSegundoDesconto: 5,
  });
  expect(
    instrucaoSicoob(c, { tipo: "desconto", valor: 0 }, "2027-01-01", null).body["desconto"],
  ).toEqual({ tipoDesconto: 0 });
  const percentual = instrucaoSicoob(
    condicoesSicoob(raw),
    { tipo: "desconto", valor: 5, data: "2027-02-10", percentual: true },
    "2027-01-01",
    null,
  );
  expect(percentual.esperado.tipoDesconto).toBe(2);
  expect(() =>
    instrucaoSicoob(
      c,
      { tipo: "desconto", valor: 5, data: "2027-02-10", ordem: 2, percentual: true },
      "2027-01-01",
      null,
    ),
  ).toThrow();
  expect(() =>
    instrucaoSicoob(c, { tipo: "desconto", valor: 5, data: "2027-03-10" }, "2027-01-01", null),
  ).toThrow();
  expect(() =>
    instrucaoSicoob(
      { ...c, abatimento: 95 },
      { tipo: "desconto", valor: 10, data: "2027-02-10" },
      "2027-01-01",
      null,
    ),
  ).toThrow();
  expect(() =>
    instrucaoSicoob(
      { ...c, tipoDesconto: 2, abatimento: 50 },
      { tipo: "desconto", valor: 60, data: "2027-02-10", percentual: true },
      "2027-01-01",
      null,
    ),
  ).toThrow();
  expect(() =>
    instrucaoSicoob(
      { ...c, descontos: [{ ordem: 1, valor: 90, data: "2027-02-10" }] },
      { tipo: "abatimento", valor: 20 },
      "2027-01-01",
      null,
    ),
  ).toThrow();
  expect(confereSicoob({ ...d.esperado, seuNumero: "outro" }, d.esperado, "desconto")).toBe(false);
});
test("sandbox usa token e host próprios, não pede certificado nem chama OAuth/produção", async () => {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const io: TransporteSicoob = async (url, method, headers) => {
    calls.push({ url, method, headers });
    return { status: 200, json: { resultado: raw } };
  };
  const api = await clienteSicoob(
    "client-sandbox",
    { sandbox_token: "token-sandbox-falso" },
    io,
    "homologacao",
  );
  await api("/boletos?numeroCliente=12345");
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toStartWith(SICOOB_SANDBOX);
  expect(calls[0]!.headers["Authorization"]).toBe("Bearer token-sandbox-falso");
  for (const path of ["//outro.com", "https://outro.com", "/../outra", "/\\outro"])
    await expect(api(path)).rejects.toThrow();
  await expect(clienteSicoob("client-sandbox", {}, io, "homologacao")).rejects.toThrow();
});
test("produção exige A1 válido e obtém OAuth com escopos bancários, sem mandar token sandbox", async () => {
  for (const nome of ["sicoob-api", "sicredi-api", "sicoob-erros", "server-sicoob-http"])
    writeFileSync(
      join(temp, nome + ".js"),
      ts.transpileModule(readFileSync("src/lib/" + nome + ".ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
  const verificacao = execFileSync(
    "node",
    [
      "-e",
      `const {validarCertificadoSicoob}=require(${JSON.stringify(join(temp, "server-sicoob-http.js"))});const pfx=require('node:fs').readFileSync(${JSON.stringify(join(temp, "cert.pfx"))}).toString('base64');try{validarCertificadoSicoob({pfx,senha:'errada'});process.stdout.write('aceito');}catch{process.stdout.write('bloqueado');}`,
    ],
    { encoding: "utf8" },
  );
  expect(verificacao).toBe("bloqueado");
  expect(() => validarCertificadoSicoob({ pfx: "!base64-invalido", senha: "" })).toThrow();
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
  }[] = [];
  const io: TransporteSicoob = async (url, method, headers, body) => {
    calls.push({ url, method, headers, body });
    return url === SICOOB_AUTH
      ? { status: 200, json: { access_token: "oauth-falso", expires_in: 300 } }
      : { status: 204, json: {} };
  };
  await expect(
    clienteSicoob("client-prod", { sandbox_token: "token-sandbox-falso" }, io),
  ).rejects.toThrow();
  expect(calls.length).toBe(0);
  const api = await clienteSicoob("client-prod", cert, io);
  await api("/boletos/123", "PATCH", { numeroCliente: 12345 });
  expect(calls[0]!.url).toBe(SICOOB_AUTH);
  expect(SICOOB_SCOPES).toBe("boletos_inclusao boletos_consulta boletos_alteracao");
  expect(new URLSearchParams(calls[0]!.body).get("scope")).toBe(SICOOB_SCOPES);
  expect(new URLSearchParams(calls[0]!.body).get("grant_type")).toBe("client_credentials");
  expect(calls[1]!.url).toBe(SICOOB_BASE + "/boletos/123");
  expect(calls[1]!.headers["Authorization"]).toBe("Bearer oauth-falso");
  expect(calls[1]!.headers["client_id"]).toBe("client-prod");
});

test("teste sandbox consulta boletos sem depender de health e só aprova retorno esperado", async () => {
  const paths: string[] = [];
  await testarSandboxSicoob(async (path) => {
    paths.push(path);
    return { status: 200, json: { resultado: raw } };
  }, null);
  expect(paths).toEqual(["/boletos?numeroCliente=25546454&codigoModalidade=1&nossoNumero=1"]);
  for (const [status, texto] of [
    [401, "autorização"],
    [403, "autorização"],
    [404, "não está disponível"],
    [405, "não está disponível"],
    [429, "temporariamente"],
    [503, "temporariamente"],
    [400, "números de exemplo"],
  ] as const)
    await expect(testarSandboxSicoob(async () => ({ status, json: {} }), 123)).rejects.toThrow(
      texto,
    );
  for (const resultado of [null, undefined, [], "ok", {}, { nossoNumero: 0 }])
    await expect(
      testarSandboxSicoob(async () => ({ status: 200, json: { resultado } }), 123),
    ).rejects.toThrow("sem os dados esperados");
});

test("conexão aceita o identificador negativo do mock oficial sem permitir boleto operacional inválido", async () => {
  const mock = {
    ...raw,
    nossoNumero: -2147483648,
    numeroCliente: 25546454,
    codigoModalidade: 1,
    valor: 156.23,
  };
  await testarSandboxSicoob(async () => ({ status: 200, json: { resultado: mock } }), 25546454);
  expect(() => condicoesSicoob(mock)).toThrow();
  for (const campo of ["numeroCliente", "codigoModalidade", "valor", "nossoNumero"])
    await expect(
      testarSandboxSicoob(
        async () => ({ status: 200, json: { resultado: { ...mock, [campo]: null } } }),
        25546454,
      ),
    ).rejects.toThrow("sem os dados esperados");
});

test("mock oficial é reconhecido separadamente e continua inválido como boleto operacional", () => {
  const mock = { ...raw, nossoNumero: -2147483648 };
  expect(respostaSimuladaSicoob(mock)).toBe(true);
  expect(respostaSimuladaSicoob(raw)).toBe(false);
  expect(() => condicoesSicoob(mock)).toThrow();
  for (const extra of [
    { codigoModalidade: 2 },
    { valor: -1 },
    { numeroCliente: null },
    { nossoNumero: "-2147483648" },
  ])
    expect(respostaSimuladaSicoob({ ...mock, ...extra })).toBe(false);
});

test("extrato usa outro Client ID e apenas escopos de consulta, sem alterar cobrança", async () => {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
  }[] = [];
  const io: TransporteSicoob = async (url, method, headers, body) => {
    calls.push({ url, method, headers, body });
    return url === SICOOB_AUTH
      ? { status: 200, json: { access_token: "extrato-token-falso" } }
      : { status: 200, json: { transacoes: [] } };
  };
  const path =
    "/extrato/11/2026?diaInicial=1&diaFinal=10&agruparCNAB=false&numeroContaCorrente=123";
  expect(await consultarExtratoContaSicoob("client-extrato", cert, path, io)).toEqual({
    transacoes: [],
  });
  expect(new URLSearchParams(calls[0]!.body).get("scope")).toBe("cco_consulta openid");
  expect(new URLSearchParams(calls[0]!.body).get("client_id")).toBe("client-extrato");
  expect(calls[1]!.url).toBe("https://api.sicoob.com.br/conta-corrente/v4" + path);
  expect(calls[1]!.method).toBe("GET");
  expect(calls[1]!.headers["client_id"]).toBe("client-extrato");
  expect(calls[1]!.headers["Authorization"]).toBe("Bearer extrato-token-falso");
  for (const p of [
    "/transferencias",
    "https://outro/extrato/11/2026?",
    "/extrato/11/2026?../transferencias",
  ])
    await expect(consultarExtratoContaSicoob("client-extrato", cert, p, io)).rejects.toThrow();
  let consultas403 = 0;
  await expect(
    consultarExtratoContaSicoob("client-extrato", cert, path, async () => {
      consultas403++;
      return consultas403 === 1
        ? { status: 200, json: { access_token: "falso" } }
        : { status: 403, json: { mensagem: "nao-expor-corpo" } };
    }),
  ).rejects.toThrow("após obter o token");
  expect(calls).toHaveLength(2);
  await expect(
    consultarExtratoContaSicoob("client", cert, path, async () => ({
      status: 403,
      json: { access_token: "NAO_EXIBIR" },
    })),
  ).rejects.toThrow("não autorizou o extrato");
});

test("recusa de emissão preserva HTTP e motivo sanitizado sem repetir POST", async () => {
  let chamadas = 0;
  const api = await clienteSicoob("client-prod", cert, async (url) => {
    chamadas++;
    return url === SICOOB_AUTH
      ? { status: 200, json: { access_token: "TOKEN-BANCARIO-PRIVADO" } }
      : {
          status: 403,
          json: {
            mensagens: [
              { codigo: "BOL403", mensagem: "Acesso negado token=TOKEN-BANCARIO-PRIVADO" },
            ],
          },
        };
  });
  const r = await api("/boletos", "POST", { valor: 50 });
  expect(r.status).toBe(403);
  expect(r.motivo).toContain("BOL403");
  expect(r.motivo).not.toContain("TOKEN-BANCARIO-PRIVADO");
  expect(chamadas).toBe(2);
});
