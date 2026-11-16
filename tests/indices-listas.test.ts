import { expect, test } from "bun:test";
import { indexarPrimeiro, agruparPorChave } from "../src/lib/indices-listas";
test("índices preservam primeira ocorrência, tipos de chave e ordem sem alterar a lista", () => {
  const rows = Object.freeze([
    { id: "1", pedido: "a" },
    { id: 1, pedido: "b" },
    { id: "1", pedido: "a" },
    { id: "2", pedido: "a" },
  ]);
  const indice = indexarPrimeiro(rows, (r) => r.id);
  expect(indice.get("1")).toBe(rows[0]);
  expect(indice.get(1)).toBe(rows[1]);
  expect(indice.get("ausente")).toBeUndefined();
  expect(agruparPorChave(rows, (r) => r.pedido).get("a")).toEqual([rows[0], rows[2], rows[3]]);
  expect(rows).toHaveLength(4);
  const atualizado = indexarPrimeiro([{ id: "1", pedido: "c" }], (r) => r.id);
  expect(atualizado.get("1")?.pedido).toBe("c");
  expect(indice.get("1")?.pedido).toBe("a");
});
