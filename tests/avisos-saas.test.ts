import { expect, test } from "bun:test";
import { avisoMensalidade, proximoVencimento, rotaForaDoErp } from "../src/lib/avisos-saas";
import type { SaasStatus } from "../src/lib/saas";
const status: SaasStatus = {
  proprietario: false,
  master: true,
  bloqueado: false,
  controle_ativo: true,
  estado: "em_tolerancia",
  vencimento: "2026-11-01",
  limite_regularizacao: "2026-11-06",
  data_bloqueio: "2026-11-07",
  dias_ate_bloqueio: 1,
};
test("aviso destaca dias para bloqueio apenas para responsáveis", () => {
  expect(avisoMensalidade(status, "2026-11-06")?.prazo).toContain("Falta 1 dia");
  expect(avisoMensalidade({ ...status, dias_ate_bloqueio: 3 }, "2026-11-04")?.prazo).toContain(
    "Faltam 3 dias",
  );
  expect(
    avisoMensalidade({ ...status, bloqueado: true, estado: "bloqueado", dias_ate_bloqueio: 0 })
      ?.titulo,
  ).toContain("suspenso");
  expect(
    avisoMensalidade({ ...status, master: false, estado: "manutencao", manutencao: true }),
  ).toBeNull();
  expect(avisoMensalidade({ ...status, controle_ativo: false })).toBeNull();
  expect(avisoMensalidade({ ...status, estado: "em_dia" })).toBeNull();
});
test("rotas fora do ERP não entram no redirecionamento de módulos", () => {
  for (const rota of [
    "/assinatura",
    "/assinatura/",
    "/plataforma",
    "/auth",
    "/recuperar-senha",
    "/",
  ])
    expect(rotaForaDoErp(rota)).toBe(true);
  for (const rota of ["/dashboard", "/receber", "/assinatura/admin", "/desconhecida"])
    expect(rotaForaDoErp(rota)).toBe(false);
});

test("mensalidade em dia mostra somente contagem para o próximo vencimento", () => {
  const emDia = { ...status, estado: "em_dia" as const, vencimento: "2026-12-01" };
  expect(proximoVencimento(emDia, "2026-11-06")).toBe("Próximo vencimento em 25 dias");
  expect(proximoVencimento(emDia, "2026-11-30")).toBe("Próximo vencimento em 1 dia");
  expect(proximoVencimento(emDia, "2026-12-01")).toBe("Próximo vencimento hoje");
  expect(proximoVencimento({ ...emDia, vencimento: null })).toBe("Mensalidade em dia");
  expect(avisoMensalidade(emDia, "2026-11-06")).toBeNull();
});

test("aviso de vencimento respeita estado do contrato e contagem de dias de calendário", () => {
  const proximo = {
    ...status,
    estado: "a_vencer" as const,
    vencimento: "2026-12-01",
    data_bloqueio: "2026-12-07",
  };
  expect(avisoMensalidade(proximo, "2026-11-26")?.titulo).toBe("A mensalidade vence em 5 dias");
  expect(avisoMensalidade(proximo, "2026-11-30")?.titulo).toBe("A mensalidade vence em 1 dia");
  expect(avisoMensalidade(proximo, "2026-12-01")?.titulo).toBe("A mensalidade vence hoje");
  expect(avisoMensalidade(proximo, "2026-11-26")?.prazo).toBe(
    "Faltam 11 dias para o bloqueio do sistema.",
  );
  expect(avisoMensalidade({ ...proximo, estado: "em_tolerancia" }, "2026-12-06")?.prazo).toBe(
    "Falta 1 dia para o bloqueio do sistema.",
  );
  expect(proximoVencimento({ ...proximo, vencimento: "2027-01-01" }, "2026-12-31")).toBe(
    "Próximo vencimento em 1 dia",
  );
  expect(proximoVencimento({ ...proximo, vencimento: "2028-03-01" }, "2028-02-28")).toBe(
    "Próximo vencimento em 2 dias",
  );
});
