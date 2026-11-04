import { expect, test } from "bun:test";
import { detalhePendencia } from "../src/lib/pendencias-exibicao";

test("dashboard e central mostram os vencimentos dos PED-3 e PED-4 no padrão brasileiro", () => {
  for (const documento of ["PED-3", "PED-4"]) {
    const registro = { documento, vencimento: "2026-10-15" };
    expect(detalhePendencia({ id: "vencido", label: "Vencidos" }, registro)).toBe(
      "Vencimento 15/10/2026",
    );
    expect(registro.vencimento).toBe("2026-10-15");
  }
});
test("agenda, cobrança e alteração bancária formatam datas sem ocultar observações e estado", () => {
  for (const id of ["agenda", "cobranca"])
    expect(
      detalhePendencia({ id, label: "Agenda" }, { proxima_acao: "2026-1-5", observacao: "Ligar" }),
    ).toBe("Próxima ação 05/01/2026 · Ligar");
  expect(
    detalhePendencia(
      { id: "vencimento", label: "Alterações" },
      { estado: "pendente", vencimento_novo: "2026-11-10" },
    ),
  ).toBe("Alteração pendente · vencimento 10/11/2026");
  expect(detalhePendencia({ id: "vencido", label: "Vencidos" }, {})).toBe("Vencimento —");
  expect(
    detalhePendencia(
      { id: "divergencia", label: "Divergências" },
      { divergencia_obs: "Conferir quantidades" },
    ),
  ).toBe("Conferir quantidades");
});
