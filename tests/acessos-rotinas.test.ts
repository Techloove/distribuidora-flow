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

test("cada ação nova possui registro no catálogo SQL com o mesmo módulo da interface", () => {
  const novas = [
    "receber_renegociar",
    "comissao_proporcional_operar",
    "compra_xml_importar",
    "pix_gerar",
    "indicadores_comparar",
    "deposito_operar",
    "inventario_contar",
    "inventario_conferir",
    "entrega_parcial_operar",
    "rentabilidade_editar",
    "integridade_ver",
  ] as const;
  const files = [
    "fase212_reservas_estoque.sql",
    "fase213_depositos_inventario.sql",
    "fase214_entregas_parciais.sql",
    "fase215_comissoes_e_rentabilidade.sql",
    "fase216_renegociacao.sql",
    "fase217_comissao_proporcional.sql",
    "fase218_compras_xml.sql",
    "fase219_pix_por_chave.sql",
    "fase220_indicadores_auditoria.sql",
  ];
  const sql = files
    .map((file) => readFileSync(new URL("../db/" + file, import.meta.url), "utf8"))
    .join("\n");
  for (const code of novas) {
    expect(sql).toMatch(
      new RegExp("\\('" + code + "','[^']+','[^']+',\\d+,'" + ACOES_ROTINAS[code] + "'\\)"),
    );
  }
});
