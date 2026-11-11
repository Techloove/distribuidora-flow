import { test, expect } from "bun:test";
import { motivoRecusaSicoob, erroOperacaoSicoob } from "../src/lib/sicoob-erros";
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
