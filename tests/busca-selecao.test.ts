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

test("busca preparada mantém os resultados originais ao digitar, limpar e trocar a lista", async () => {
  const { prepararTextoBusca, prepararTermoBusca, correspondeBuscaPreparada } =
    await import("../src/lib/busca-selecao");
  const antigo = (texto: string, busca: string) => {
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .trim();
    const base = norm(texto),
      termo = norm(busca);
    if (!termo) return true;
    if (termo.split(/\s+/).every((p) => base.includes(p))) return true;
    const digitos = termo.replace(/\D/g, "");
    return /^[\d\s./-]+$/.test(termo) && !!digitos && base.replace(/\D/g, "").includes(digitos);
  };
  const textos = [
    "João Construções 61.575.706/0001-76",
    "Cimento CP2 Campeão",
    "",
    "0",
    "Pedido 27 / 10",
    "São José · ALFA",
    "Código 000145",
  ];
  const termos = [
    "",
    "  ",
    "JOAO",
    "joao construcoes",
    "construções João",
    "61575706000176",
    "61.575.706/0001-76",
    "000145",
    "000 145",
    "/",
    ".-",
    "sao jose",
    "jose alfa",
    "inexistente",
    "cp2",
    "0",
    "27/10",
    "27 / 10",
  ];
  for (const texto of textos)
    for (const termo of termos) {
      const esperado = antigo(texto, termo);
      expect(correspondeBuscaPreparada(prepararTextoBusca(texto), prepararTermoBusca(termo))).toBe(
        esperado,
      );
      expect(correspondeBuscaSelecao(texto, termo)).toBe(esperado);
    }
});
