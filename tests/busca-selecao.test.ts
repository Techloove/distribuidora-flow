import { expect, test } from "bun:test";
import { correspondeBuscaSelecao } from "../src/lib/busca-selecao";
test("busca de cadastros ignora acentos e caixa e aceita palavras em outra ordem", () => {
  expect(correspondeBuscaSelecao("145 · João Construções Ltda", "CONSTRUCOES joao")).toBe(true);
  expect(correspondeBuscaSelecao("27 · Cimento CP2 Campeão", "campeao cimento")).toBe(true);
  expect(correspondeBuscaSelecao("27 · Cimento CP2 Campeão", "arame")).toBe(false);
});
test("documentos podem ser buscados com ou sem pontuação e busca vazia conserva opções", () => {
  expect(correspondeBuscaSelecao("Empresa 61.575.706/0001-76", "61575706000176")).toBe(true);
  expect(correspondeBuscaSelecao("61575706000176", "61.575.706/0001-76")).toBe(true);
  expect(correspondeBuscaSelecao("Empresa 61.575.706/0001-76", "61575706000177")).toBe(false);
  expect(correspondeBuscaSelecao("Empresa", "")).toBe(true);
});
