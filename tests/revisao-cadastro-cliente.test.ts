import { expect, test } from "bun:test";
import { salvarRevisaoCadastroCliente } from "../src/lib/revisao-cadastro-cliente";
const payload = { limite_credito: 5000, rota_id: "rota", ativo: true, is_cliente: true };
test("revisão salva os dados ainda bloqueados antes de liberar o limite administrativo", async () => {
  const chamadas: unknown[] = [];
  await salvarRevisaoCadastroCliente({
    payload,
    pendente: true,
    admin: true,
    salvar: async (dados, guard) => {
      chamadas.push([dados, guard]);
    },
    liberar: async (limite) => {
      chamadas.push(limite);
    },
  });
  expect(chamadas).toEqual([[{ ...payload, limite_credito: 0, status: "bloqueado" }, true], 5000]);
});
test("cadastro sem rota não grava nem libera", async () => {
  let chamado = false;
  await expect(
    salvarRevisaoCadastroCliente({
      payload: { ...payload, rota_id: null },
      pendente: true,
      admin: true,
      salvar: async () => {
        chamado = true;
      },
      liberar: async () => {
        chamado = true;
      },
    }),
  ).rejects.toThrow("rota ativa");
  expect(chamado).toBe(false);
});
test("erro de salvamento ou alteração concorrente não tenta aprovar", async () => {
  let liberou = false;
  await expect(
    salvarRevisaoCadastroCliente({
      payload,
      pendente: true,
      admin: true,
      salvar: async () => {
        throw Error("registro alterado");
      },
      liberar: async () => {
        liberou = true;
      },
    }),
  ).rejects.toThrow("registro alterado");
  expect(liberou).toBe(false);
});
test("erro da liberação informa que os dados foram salvos e mantém a pendência", async () => {
  await expect(
    salvarRevisaoCadastroCliente({
      payload,
      pendente: true,
      admin: true,
      salvar: async () => {},
      liberar: async () => {
        throw Error("Loja sem acesso");
      },
    }),
  ).rejects.toThrow(
    "Os dados foram salvos, mas o cadastro continua pendente de aprovação: Loja sem acesso",
  );
});
test("edição comum, limite zero ou usuário sem admin não executam liberação", async () => {
  for (const args of [
    { pendente: false, admin: true, payload },
    { pendente: true, admin: false, payload },
    { pendente: true, admin: true, payload: { ...payload, limite_credito: 0 } },
  ]) {
    let salvo: unknown;
    let liberou = false;
    await salvarRevisaoCadastroCliente({
      ...args,
      salvar: async (dados, guard) => {
        salvo = [dados, guard];
      },
      liberar: async () => {
        liberou = true;
      },
    });
    expect(salvo).toEqual([args.payload, false]);
    expect(liberou).toBe(false);
  }
});
