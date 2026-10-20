import { expect, test } from "bun:test";
import {
  atenderSicrediAutomatico,
  executarConsultaAutomatica,
} from "../src/lib/server-sicredi-auto";
const boleto = {
  id: "b1",
  nosso_numero: "123",
  cooperativa: "0307",
  posto: "01",
  codigo_beneficiario: "29742",
  responsavel: "admin",
};
const config = { ...boleto, ambiente: "producao" };
function fixture(resposta: Record<string, unknown>) {
  const gravacoes: Record<string, unknown>[] = [];
  let chamadas = 0;
  return {
    gravacoes,
    get chamadas() {
      return chamadas;
    },
    io: {
      rpc: async <T>(name: string, args: Record<string, unknown>) => {
        if (name.includes("reservar")) return { lease: "lease", itens: [boleto] } as T;
        gravacoes.push(args);
        return args["_situacao"] as T;
      },
      config: async () => config,
      consultar: async () => {
        chamadas++;
        return resposta;
      },
    },
  };
}
test("consulta automática usa somente liquidação completa; não emite boletos", async () => {
  const f = fixture({
    situacao: "LIQUIDADO",
    dadosLiquidacao: { data: "2026-10-20", valor: 107, juros: 5, multa: 2 },
  });
  expect(await executarConsultaAutomatica("secret", f.io)).toEqual({
    consultados: 1,
    processados: 1,
  });
  expect(f.gravacoes[0]?.["_dados"]).toMatchObject({ valor: 107, juros: 5, multa: 2 });
  const incompleto = fixture({ situacao: "LIQUIDADO" });
  await executarConsultaAutomatica("secret", incompleto.io);
  expect(incompleto.gravacoes[0]?.["_situacao"]).toBe("dados_incompletos");
});
test("não consulta convênio diferente ou sandbox e não interpreta situação desconhecida como pagamento", async () => {
  for (const ambiente of ["homologacao", "outro"]) {
    const f = fixture({ situacao: "LIQUIDADO" });
    await executarConsultaAutomatica("secret", {
      ...f.io,
      config: async () => ({ ...config, ambiente }),
    });
    expect(f.chamadas).toBe(0);
    expect(f.gravacoes[0]?.["_situacao"]).toBe("convenio_divergente");
  }
  const f = fixture({ situacao: "EM_LIQUIDACAO" });
  await executarConsultaAutomatica("secret", f.io);
  expect(f.gravacoes[0]?.["_situacao"]).toBe("pendente");
});
test("erro bancário permite nova tentativa e erro de persistência não confirma a baixa", async () => {
  const f = fixture({});
  await executarConsultaAutomatica("secret", {
    ...f.io,
    consultar: async () => {
      throw new Error("timeout");
    },
  });
  expect(f.gravacoes[0]?.["_situacao"]).toBe("consulta_falhou");
  await expect(
    executarConsultaAutomatica("secret", {
      ...f.io,
      rpc: async <T>(name: string) => {
        if (name.includes("reservar")) return { lease: "lease", itens: [boleto] } as T;
        throw new Error("DB");
      },
    }),
  ).rejects.toThrow("DB");
});
test("endpoint recusa acessos sem o segredo do agendamento", async () => {
  expect(
    (await atenderSicrediAutomatico(new Request("https://erp/api/sicredi/sincronizar"))).status,
  ).toBe(405);
  expect(
    (
      await atenderSicrediAutomatico(
        new Request("https://erp/api/sicredi/sincronizar", { method: "POST" }),
      )
    ).status,
  ).toBe(401);
});
