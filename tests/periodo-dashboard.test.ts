import { expect, test } from "bun:test";
import {
  mesDashboardAtual,
  moverMesDashboard,
  rotuloMesDashboard,
} from "../src/lib/periodo-dashboard";
test("mês inicial usa São Paulo na virada do mês, sem importar o fuso do navegador", () => {
  expect(mesDashboardAtual(new Date("2026-11-01T02:59:59Z"))).toBe("2026-10");
  expect(mesDashboardAtual(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
});
test("navegação atravessa anos e retorna exatamente ao mês de origem", () => {
  expect(moverMesDashboard("2026-01", -1)).toBe("2025-12");
  expect(moverMesDashboard("2025-12", 1)).toBe("2026-01");
  expect(moverMesDashboard(moverMesDashboard("2026-11", -1), 1)).toBe("2026-11");
  expect(rotuloMesDashboard("2026-11")).toBe("11/2026");
});
