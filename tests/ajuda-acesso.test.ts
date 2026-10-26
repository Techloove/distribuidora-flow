import { expect, test } from "bun:test";
import { MODULOS, moduloDaRota, podeModuloPermitido } from "../src/lib/permissoes";
import manual from "../src/content/manual.json";
test("manual não concede módulos operacionais a um perfil restrito nem abre acesso sem módulos", () => {
  const comercial = new Set(["/pedidos", "/pessoas"]);
  expect(podeModuloPermitido("/ajuda", comercial)).toBe(true);
  expect(podeModuloPermitido("/pedidos", comercial)).toBe(true);
  for (const rota of [
    "/estoque",
    "/usuarios",
    "/financeiro",
    "/configuracoes",
    "/rota-inexistente",
  ])
    expect(podeModuloPermitido(rota, comercial)).toBe(false);
  expect(podeModuloPermitido("/ajuda", new Set())).toBe(false);
  expect(podeModuloPermitido("/expedicao", new Set(["/entregas"]))).toBe(true);
  expect(podeModuloPermitido("/expedicao", comercial)).toBe(false);
  expect(moduloDaRota("/ajuda")).toBe("/ajuda");
  expect(moduloDaRota("/ajudante")).toBeNull();
});
test("atalhos do manual apontam para módulos reais sujeitos às permissões existentes", () => {
  const validos = new Set(MODULOS.map((m) => m.path));
  for (const topico of manual)
    for (const rota of topico.modulos) {
      expect(validos.has(rota)).toBe(true);
      expect(moduloDaRota(rota)).toBe(rota);
    }
});
