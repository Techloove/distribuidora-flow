import { expect, test } from "bun:test";
import { progressoDescontoPeso, type FaixaPeso } from "../src/lib/progresso-desconto-peso";
const faixa = (
  min: number,
  max: number | null,
  pct: number,
  categoria: string | null = null,
): FaixaPeso => ({
  id: `${categoria}-${min}`,
  nome: `Faixa ${pct}%`,
  peso_min: min,
  peso_max: max,
  percentual: pct,
  categoria,
  ativo: true,
  ordem: min,
});
const faixas = [faixa(100, 199.999, 2), faixa(200, 299.999, 3), faixa(300, null, 5)];
const calcular = (kg: number) =>
  progressoDescontoPeso([{ quantidade: kg, peso_kg: 1, categoria: null }], faixas);
test("avança faixa por faixa, incluindo exatamente o limite, e retrocede ao remover peso", () => {
  expect(calcular(50).proximas[0]?.falta).toBe(50);
  expect(calcular(100).atual?.percentual).toBe(2);
  expect(calcular(100).proximas[0]?.falta).toBe(100);
  expect(calcular(200).atual?.percentual).toBe(3);
  expect(calcular(200).proximas[0]?.faixa.percentual).toBe(5);
  expect(calcular(300).proximas).toHaveLength(0);
  expect(calcular(300).maiorAtingida).toBe(true);
  expect(calcular(199.999).proximas[0]?.falta).toBe(0.001);
});
test("categoria conta apenas seus produtos e ignora caixa, sem oferecer desconto inferior ao atual", () => {
  const p = progressoDescontoPeso(
    [
      { quantidade: 5, peso_kg: 20, categoria: "cimento" },
      { quantidade: 5, peso_kg: 10, categoria: "Tinta" },
    ],
    [
      faixa(0, null, 2),
      faixa(200, 299.999, 3, "CIMENTO"),
      faixa(300, null, 5, "cimento"),
      faixa(100, null, 1, "Tinta"),
    ],
  );
  expect(p.pesoTotal).toBe(150);
  expect(p.atual?.percentual).toBe(2);
  expect(p.proximas).toHaveLength(1);
  expect(p.proximas[0]?.falta).toBe(100);
  expect(p.proximas[0]?.faixa.percentual).toBe(3);
});
test("faixas inativas, lacunas, zero e sobreposições seguem a rotina do banco", () => {
  expect(calcular(0).atual).toBeNull();
  expect(calcular(0).proximas[0]?.falta).toBe(100);
  const zero = progressoDescontoPeso([], [faixa(0, null, 2)]);
  expect(zero.proximas[0]?.falta).toBe(0.001);
  const p = progressoDescontoPeso(
    [{ quantidade: 150, peso_kg: 1, categoria: null }],
    [faixa(0, 100, 2), faixa(200, null, 4), { ...faixa(160, null, 10), ativo: false }],
  );
  expect(p.atual).toBeNull();
  expect(p.proximas[0]?.falta).toBe(50);
  const empate = progressoDescontoPeso(
    [{ quantidade: 150, peso_kg: 1, categoria: null }],
    [faixa(0, null, 2), faixa(100, null, 4), faixa(200, null, 3)],
  );
  expect(empate.atual?.percentual).toBe(4);
  expect(empate.proximas).toHaveLength(0);
});
test("arredonda o peso total em três casas como numeric do PostgreSQL", () => {
  expect(calcular(199.9996).atual?.percentual).toBe(3);
  expect(calcular(0.1 + 0.2).proximas[0]?.falta).toBe(99.7);
});
