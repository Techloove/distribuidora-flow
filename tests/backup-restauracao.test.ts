import { expect, test } from "bun:test";
import {
  dadosCopy,
  linhasCopySaida,
  hashLinhas,
  nomePapelAusente,
  validarRestauracao,
} from "../scripts/validar-restauracao-backup.mjs";

test("conferência lê COPY sem confundir dados escapados com comandos SQL", () => {
  const sql =
    'SET statement_timeout=0;\nCOPY public.pedidos (id, observacao) FROM stdin;\n1\ttexto\\nsegunda linha\n2\t\\N\n\\.\nCOPY "cadastro extra"."itens" ("id", nome) FROM stdin;\n3\tJosé\n\\.\nSELECT pg_catalog.setval(\'seq\',3,true);\n';
  const tables = dadosCopy(sql);
  expect(tables).toHaveLength(2);
  expect(tables[0]?.rows).toEqual(["1\ttexto\\nsegunda linha", "2\t\\N"]);
  expect(tables[1]?.table).toBe('"cadastro extra"."itens"');
  expect(tables[1]?.rows).toEqual(["3\tJosé"]);
  expect(() => dadosCopy("COPY public.itens (id) FROM stdin;\n1")).toThrow("truncada");
});

test("hash confere todos os valores e duplicações sem depender da ordem física", () => {
  expect(hashLinhas(["1\t100", "2\t200"])).toBe(hashLinhas(["2\t200", "1\t100"]));
  expect(hashLinhas(["1\t100", "2\t200"])).not.toBe(hashLinhas(["1\t101", "2\t200"]));
  expect(hashLinhas(["1\t100", "1\t100"])).not.toBe(hashLinhas(["1\t100"]));
  expect(hashLinhas([])).not.toBe(hashLinhas([""]));
});

test("preparação de papéis identifica apenas erro de papel ausente", () => {
  expect(
    nomePapelAusente(
      'pg_restore: error: could not execute query: ERROR: role "authenticated" does not exist',
    ),
  ).toBe("authenticated");
  expect(
    nomePapelAusente('ERROR: duplicate key value violates unique constraint "abc"'),
  ).toBeUndefined();
});

test("restauração recusa destinos fora do diretório descartável antes de executar comandos", async () => {
  await expect(
    validarRestauracao("limpar", {
      RESTORE_TEST_ROOT: "/workspace",
      RESTORE_CONTAINER: "producao",
    }),
  ).rejects.toThrow("isolado inválido");
  await expect(
    validarRestauracao("restaurar", {
      RESTORE_TEST_ROOT: "/tmp/caparao-restore-123-1",
      RESTORE_CONTAINER: "producao",
    }),
  ).rejects.toThrow("isolado inválido");
});

test("conferência distingue tabela vazia de uma linha com campo vazio", () => {
  expect(linhasCopySaida("")).toEqual([]);
  expect(linhasCopySaida("\n")).toEqual([""]);
  expect(linhasCopySaida("\n\n")).toEqual(["", ""]);
  expect(linhasCopySaida("valor\n")).toEqual(["valor"]);
  expect(() => linhasCopySaida("valor")).toThrow("truncada");
});
