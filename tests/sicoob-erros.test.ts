import { test, expect } from "bun:test";
import {
  motivoRecusaSicoob,
  erroOperacaoSicoob,
  consultaVaziaSicoob,
} from "../src/lib/sicoob-erros";
test("motivo lê mensagens oficiais sem corpo bruto e remove credenciais", () => {
  const r = motivoRecusaSicoob(
    {
      mensagens: [
        {
          codigo: "E403",
          mensagem: "Permissão negada para client-secreto. Bearer token-oculto senha=senha-oculta",
        },
      ],
      pagador: { nome: "NAO-EXIBIR" },
      access_token: "NAO-EXIBIR",
    },
    ["client-secreto"],
  );
  expect(r).toContain("E403");
  expect(r).toContain("Permissão negada");
  expect(r).not.toMatch(/client-secreto|token-oculto|senha-oculta|NAO-EXIBIR/);
});
test("resposta genérica e limites não inventam diagnóstico", () => {
  expect(motivoRecusaSicoob({ error: "Forbidden" })).toBe("Forbidden");
  expect(motivoRecusaSicoob({ resultado: {} })).toBeNull();
  expect(motivoRecusaSicoob(null)).toBeNull();
  const r = erroOperacaoSicoob("Emissão", 403, "Forbidden");
  expect(r).toContain("HTTP 403");
  expect(r).toContain("permissão da operação");
  expect(r).not.toContain("senha incorreta");
});

test("204 preserva pendência sem confirmar emissão e não gera dados de liquidação", () => {
  const r = consultaVaziaSicoob(true);
  expect(r.situacao).toBe("SEM_RESULTADO");
  expect(r.pendente).toBe(true);
  expect(r.confirmado).toBe(false);
  expect(r.condicoes).toBeNull();
  expect(r.nota).toContain("HTTP 204");
  expect(r.nota).toContain("não confirma a inexistência");
  expect(consultaVaziaSicoob(false, 200).nota).toContain("HTTP 200");
  expect(consultaVaziaSicoob(false).pendente).toBe(false);
});

test("mensagens de gateway e erro aninhado são sanitizadas, sem conservar o corpo bruto", () => {
  const r = motivoRecusaSicoob(
    {
      httpMessage: "Forbidden",
      moreInformation: "Aplicativo app-secreto recusado. Bearer token-oculto",
      pagador: { nome: "NAO-EXIBIR" },
    },
    ["app-secreto"],
  );
  expect(r).toContain("Forbidden");
  expect(r).toContain("recusado");
  expect(r).not.toMatch(/app-secreto|token-oculto|NAO-EXIBIR/);
  expect(motivoRecusaSicoob({ error: { message: "Recurso não autorizado" } })).toContain(
    "Recurso não autorizado",
  );
});

test("Not registered to plan orienta conferir vínculo de API, sem diagnosticar certificado inválido", () => {
  const r = erroOperacaoSicoob("Consulta", 403, "Forbidden : Not registered to plan");
  expect(r).toContain("plano da API");
  expect(r).toContain("produção");
  expect(r).not.toContain("certificado");
});
