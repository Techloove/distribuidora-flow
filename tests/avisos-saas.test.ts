import { expect, test } from "bun:test";
import { avisoMensalidade, rotaForaDoErp } from "../src/lib/avisos-saas";
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
  expect(avisoMensalidade(status)?.prazo).toContain("Falta 1 dia");
  expect(avisoMensalidade({ ...status, dias_ate_bloqueio: 3 })?.prazo).toContain("Faltam 3 dias");
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
