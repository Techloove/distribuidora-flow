import { expect, test } from "bun:test";
import { fixture } from "./fixtures/forecast";
import { montarEmissaoHomologacao, interpretarRetornoForecast } from "../src/lib/forecast-emissao";
import {
  transmitirOuConsultarForecast,
  executarHomologacao,
  type JobHomologacao,
} from "../src/lib/server-forecast-emissao";

const opcoes = {
  natureza_operacao: "Venda de mercadoria",
  modalidade_frete: "9",
  consumidor_final: "1",
  presenca_comprador: "1",
  forma_pagamento: "15",
  codigo_municipio_destinatario: "3205309",
};
const payload = () => montarEmissaoHomologacao(fixture(), opcoes);
const identidade = () => ({ ref: payload().ref, cnpj: payload().cnpj_emitente, serie: "1" });
function autorizado() {
  const base = `322610${identidade().cnpj}55001000000001112345678`;
  expect(base.length).toBe(43);
  let soma = 0;
  for (let i = 42, peso = 2; i >= 0; i--, peso = peso === 9 ? 2 : peso + 1)
    soma += Number(base[i]) * peso;
  const dv = 11 - (soma % 11);
  return {
    ref: identidade().ref,
    cnpj_emitente: identidade().cnpj,
    ambiente: "HOMOLOGACAO",
    status: "autorizado",
    chave_nfe: base + (dv >= 10 ? 0 : dv),
    protocolo: "123456789012345",
    numero: "1",
    serie: "1",
  };
}
test("payload de homologação usa escolhas explícitas e não aceita produção/campos livres", () => {
  const p = payload();
  expect(p.ambiente).toBe("HOMOLOGACAO");
  expect(p.formas_pagamento).toEqual([{ forma_pagamento: "15", valor_pagamento: "100.00" }]);
  expect(p.codigo_municipio_destinatario).toBe("3205309");
  expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty("forma_pagamento");
  const c = fixture();
  c.conexao.ambiente_declarado = "producao";
  expect(() => montarEmissaoHomologacao(c, opcoes)).toThrow("pendências");
  expect(() => montarEmissaoHomologacao(fixture(), { ...opcoes, forma_pagamento: "99" })).toThrow();
  expect(() =>
    montarEmissaoHomologacao(fixture(), { ...opcoes, codigo_municipio_destinatario: "123" }),
  ).toThrow();
  expect(
    montarEmissaoHomologacao(fixture(), { ...opcoes, ambiente: "PRODUCAO" }),
  ).not.toHaveProperty("ambiente", "PRODUCAO");
});
test("interpretação exige referência, CNPJ, ambiente e prova fiscal consistente", () => {
  const b = autorizado();
  expect(interpretarRetornoForecast(b, identidade()).estado).toBe("autorizada");
  for (const alterar of [
    (x: Record<string, unknown>) => (x["ref"] = "outra"),
    (x: Record<string, unknown>) => (x["cnpj_emitente"] = "99999999000199"),
    (x: Record<string, unknown>) => (x["ambiente"] = "PRODUCAO"),
    (x: Record<string, unknown>) => delete x["ambiente"],
    (x: Record<string, unknown>) => delete x["protocolo"],
    (x: Record<string, unknown>) =>
      (x["chave_nfe"] = b.chave_nfe.slice(0, -1) + (b.chave_nfe.endsWith("0") ? "1" : "0")),
    (x: Record<string, unknown>) => (x["numero"] = "2"),
  ]) {
    const x: Record<string, unknown> = { ...b };
    alterar(x);
    expect(interpretarRetornoForecast(x, identidade()).estado).toBe("incerta");
  }
  expect(interpretarRetornoForecast({ status: "autorizado" }, identidade()).estado).toBe("incerta");
  expect(
    interpretarRetornoForecast({ ...b, status: "processando_autorizacao" }, identidade()).estado,
  ).toBe("processando");
  expect(
    interpretarRetornoForecast({ ...b, status: "erro_autorizacao" }, identidade()).estado,
  ).toBe("rejeitada");
  expect(interpretarRetornoForecast({ ...b, status: "cancelado" }, identidade()).estado).toBe(
    "incerta",
  );
});
test("transporte usa Basic, origem fixa e POST/GET sem redirecionar ou retornar corpo sensível", async () => {
  const chamadas: string[] = [];
  const transporte = async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push(`${init?.method} ${url}`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${btoa("TOKEN-FICTICIO:")}`,
    );
    expect(init?.redirect).toBe("error");
    if (init?.method === "POST") expect(JSON.parse(String(init.body)).ambiente).toBe("HOMOLOGACAO");
    else expect(init?.body).toBeUndefined();
    return Response.json({ ...autorizado(), token: "SEGREDO-REMOTO" });
  };
  const r = await transmitirOuConsultarForecast(
    "TOKEN-FICTICIO",
    identidade(),
    payload(),
    transporte,
  );
  expect(r.estado).toBe("autorizada");
  expect(JSON.stringify(r)).not.toContain("SEGREDO-REMOTO");
  await transmitirOuConsultarForecast("TOKEN-FICTICIO", identidade(), null, transporte);
  expect(chamadas).toEqual([
    "POST https://forecastfiscal.com.br/api/v2/nfe",
    `GET https://forecastfiscal.com.br/api/v2/nfe/${identidade().ref}`,
  ]);
});
test("404, erro HTTP, timeout e JSON inválido ficam incertos, sem retry de envio", async () => {
  for (const resposta of [
    () => new Response("SEGREDO", { status: 404 }),
    () => new Response("SEGREDO", { status: 500 }),
    () => new Response("<html>SEGREDO</html>"),
    () => {
      throw new Error("SEGREDO");
    },
  ]) {
    let chamadas = 0;
    const r = await transmitirOuConsultarForecast("TOKEN", identidade(), payload(), async () => {
      chamadas++;
      return resposta();
    });
    expect(chamadas).toBe(1);
    expect(r.estado).toBe("incerta");
    expect(r.mensagem).not.toContain("SEGREDO");
  }
});
test("duas chamadas concorrentes só transmitem o job assumido uma vez", async () => {
  let assumido = false,
    posts = 0,
    registros = 0;
  const job: JobHomologacao = {
    nota_id: fixture().nota["id"] as string,
    centro_id: fixture().loja["id"] as string,
    ...identidade(),
    payload: payload(),
    lease: "nonce",
    token: "TOKEN",
  };
  const io = {
    assumir: async () => {
      if (assumido) return null;
      assumido = true;
      return job;
    },
    registrar: async () => {
      registros++;
    },
    transporte: async () => {
      posts++;
      throw new Error("timeout");
    },
  };
  await Promise.all([executarHomologacao("enviar", io), executarHomologacao("enviar", io)]);
  expect(posts).toBe(1);
  expect(registros).toBe(1);
  await executarHomologacao("enviar", io);
  expect(posts).toBe(1);
});
test("falha de persistência após POST não autoriza repetir a transmissão", async () => {
  let assumido = false,
    posts = 0;
  const job: JobHomologacao = {
    nota_id: "nota",
    centro_id: "loja",
    ...identidade(),
    payload: payload(),
    lease: "nonce",
    token: "TOKEN",
  };
  const io = {
    assumir: async () => {
      if (assumido) return null;
      assumido = true;
      return job;
    },
    registrar: async () => {
      throw new Error("banco indisponível");
    },
    transporte: async () => {
      posts++;
      return Response.json(autorizado());
    },
  };
  await expect(executarHomologacao("enviar", io)).rejects.toThrow("banco indisponível");
  await executarHomologacao("enviar", io);
  expect(posts).toBe(1);
});
