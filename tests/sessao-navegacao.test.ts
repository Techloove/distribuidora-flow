import { test, expect } from "bun:test";
import { deveRevalidarNavegacao } from "../src/lib/sessao-navegacao";
test("retomar aba ou renovar token não reinicia navegação do mesmo usuário", () => {
  expect(deveRevalidarNavegacao("SIGNED_IN", "usuario-a", "usuario-a")).toBe(false);
  expect(deveRevalidarNavegacao("TOKEN_REFRESHED", "usuario-a", "usuario-a")).toBe(false);
  expect(deveRevalidarNavegacao("INITIAL_SESSION", undefined, "usuario-a")).toBe(false);
});
test("entrada real, troca de usuário, saída e atualização de cadastro continuam revalidando", () => {
  expect(deveRevalidarNavegacao("SIGNED_IN", null, "usuario-a")).toBe(true);
  expect(deveRevalidarNavegacao("SIGNED_IN", undefined, "usuario-a")).toBe(true);
  expect(deveRevalidarNavegacao("SIGNED_IN", "usuario-a", "usuario-b")).toBe(true);
  expect(deveRevalidarNavegacao("SIGNED_OUT", "usuario-a", null)).toBe(true);
  expect(deveRevalidarNavegacao("USER_UPDATED", "usuario-a", "usuario-a")).toBe(true);
});
