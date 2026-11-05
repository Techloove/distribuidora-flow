import { expect, test } from "bun:test";
import { conferirRotaRascunhoCliente } from "../src/lib/rota-rascunho-cliente";
test("cliente pendente pode criar rascunho sem rota após aguardar a consulta", async () => {
  let concluiu = false;
  await conferirRotaRascunhoCliente(null, "pessoa", async () => {
    await Promise.resolve();
    concluiu = true;
    return [{ id: "pessoa" }];
  });
  expect(concluiu).toBe(true);
});
test("cliente liberado e pendência de outro cliente não dispensam rota", async () => {
  await expect(
    conferirRotaRascunhoCliente(null, "pessoa", async () => [{ id: "outra" }]),
  ).rejects.toThrow("Informe a rota");
});
test("falha na consulta pede nova tentativa, sem confundir com falta de rota", async () => {
  await expect(
    conferirRotaRascunhoCliente(null, "pessoa", async () => {
      throw Error("rede");
    }),
  ).rejects.toThrow("conferir a aprovação");
});
test("rota definida preserva o fluxo e não exige consulta adicional", async () => {
  let consultou = false;
  await conferirRotaRascunhoCliente("rota", null, async () => {
    consultou = true;
    return [];
  });
  expect(consultou).toBe(false);
});
