import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MODULOS, moduloDaRota } from "../src/lib/permissoes";
import { ACOES_ROTINAS } from "../src/lib/permissoes-rotinas";

test("menus das novas agendas e pendências têm controles independentes", () => {
  for (const path of ["/agenda-comercial", "/cobranca", "/pendencias"]) {
    expect(moduloDaRota(path)).toBe(path);
    expect(moduloDaRota(`${path}/detalhe`)).toBe(path);
  }
  expect(moduloDaRota("/lead-rota")).toBe("/lead-rota");
  expect(moduloDaRota("/receber")).toBe("/receber");
  expect(moduloDaRota("/desconhecido")).toBeNull();
});

test("todos os destinos do menu lateral e ações têm módulo configurável", () => {
  const layout = readFileSync(new URL("../src/components/erp-layout.tsx", import.meta.url), "utf8");
  const paths = [...layout.matchAll(/to: "(\/[^"]+)"/g)].map((match) => match[1]);
  for (const path of paths.filter((path) => path !== "/auth"))
    expect(moduloDaRota(path)).not.toBeNull();
  for (const path of Object.values(ACOES_ROTINAS)) {
    expect(MODULOS.some((modulo) => modulo.path === path)).toBe(true);
  }
});

// O SQL Editor pode executar comandos separadamente; o catálogo não deve depender de sessão temporária.
test("migração de acessos não depende de tabela temporária entre comandos", () => {
  const sql = readFileSync(new URL("../db/fase211_acessos_rotinas.sql", import.meta.url), "utf8");
  expect(sql).not.toMatch(/create\s+temporary\s+table/i);
  expect(sql).not.toContain("catalogo_rotinas_211");
});
