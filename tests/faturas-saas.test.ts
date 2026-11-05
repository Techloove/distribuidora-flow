import { describe, expect, test } from "bun:test";
import { agruparFaturasSaas } from "../src/lib/faturas-saas";
import type { SaasParcela } from "../src/lib/saas";
const item = (
  chave: string,
  valor: number,
  estado = "pendente",
  vencimento = "2027-01-10",
): SaasParcela => ({
  chave,
  descricao: chave,
  tipo: "servico",
  competencia: "2027-01-01",
  parcela: 1,
  vencimento,
  valor,
  estado,
  pagamento_data: null,
});
describe("faturas da assinatura", () => {
  test("agrupa apenas vencimentos iguais e soma em centavos", () => {
    const r = agruparFaturasSaas([
      item("setup", 0.1),
      item("mensal", 0.2),
      item("anual", 100, "pendente", "2027-01-20"),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].total).toBe(0.3);
    expect(r[0].itens).toHaveLength(2);
    expect(r[1].vencimento).toBe("2027-01-20");
  });
  test("pagamento parcial e cancelamento preservam linhas e descontam saldo", () => {
    const [r] = agruparFaturasSaas([
      item("mensal", 100, "pago"),
      item("setup", 50, "vencido"),
      item("dominio", 20, "cancelado"),
    ]);
    expect(r.itens).toHaveLength(3);
    expect(r.total).toBe(150);
    expect(r.pago).toBe(100);
    expect(r.saldo).toBe(50);
    expect(r.estado).toBe("parcial");
  });
  test("faturas pagas, vencidas e canceladas", () => {
    expect(agruparFaturasSaas([item("x", 50, "pago")])[0].estado).toBe("pago");
    expect(agruparFaturasSaas([item("x", 50, "vencido")])[0].estado).toBe("vencido");
    const [c] = agruparFaturasSaas([item("x", 50, "cancelado")]);
    expect(c.estado).toBe("cancelado");
    expect(c.total).toBe(0);
    expect(c.saldo).toBe(0);
    expect(agruparFaturasSaas([])).toEqual([]);
  });
});
