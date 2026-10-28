import { expect, test } from "bun:test";
import {
  estadoRecuperacaoSenha,
  mensagemLogin,
  mensagemTrocaSenha,
  validarNovaSenha,
} from "../src/lib/auth-senhas";

test("somente o evento de recuperação do SDK libera o fluxo e sair revoga essa liberação", () => {
  for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"])
    expect(estadoRecuperacaoSenha(false, event)).toBe(false);
  let estado = estadoRecuperacaoSenha(false, "PASSWORD_RECOVERY");
  expect(estado).toBe(true);
  estado = estadoRecuperacaoSenha(estado, "USER_UPDATED");
  expect(estado).toBe(true);
  expect(estadoRecuperacaoSenha(estado, "SIGNED_OUT")).toBe(false);
});

test("login distingue confirmação de e-mail, limite e credenciais sem revelar existência da conta", () => {
  expect(mensagemLogin("email_not_confirmed")).toContain("Confirme seu e-mail");
  expect(mensagemLogin("invalid_credentials")).toContain("a aprovação não muda sua senha");
  expect(mensagemLogin("invalid_credentials")).toContain("Esqueci minha senha");
  expect(mensagemLogin("user_not_found")).toBe(mensagemLogin("invalid_credentials"));
  expect(mensagemLogin("over_request_rate_limit")).toContain("Aguarde");
});

test("trocas sucessivas usam a senha atual sem limite total e sem modificar espaços ou caracteres", () => {
  const senhas = ["SenhaInicial!1", "SenhaNova!2", "SenhaNova!3", " espaço e acentuação 4 "];
  for (let i = 1; i < senhas.length; i++) {
    expect(validarNovaSenha(senhas[i]!, senhas[i]!, senhas[i - 1])).toBeNull();
    expect(validarNovaSenha(senhas[i - 1]!, senhas[i - 1]!, senhas[i - 1])).toContain("diferente");
  }
  expect(validarNovaSenha("1234567", "1234567")).toContain("8 caracteres");
  expect(validarNovaSenha("SenhaNova!2", "OutraSenha!3")).toContain("não conferem");
  expect(validarNovaSenha("SenhaNova!2", "SenhaNova!2")).toBeNull();
});

test("requisitos do provedor e limites temporários são explicados sem bloquear futuras trocas", () => {
  expect(mensagemTrocaSenha("same_password")).toContain("diferente");
  expect(mensagemTrocaSenha("weak_password")).toContain("mais forte");
  expect(mensagemTrocaSenha("over_request_rate_limit")).toContain("Aguarde");
});
