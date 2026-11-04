import { expect, test } from "bun:test";
import {
  atalhosPeriodo,
  intervaloMes,
  mesDoIntervalo,
  paresDataFiltro,
} from "../src/lib/periodos-filtro";
test("atalhos usam semana de segunda a domingo e meses de calendário, preservando 7 e 30 dias", () => {
  const p = atalhosPeriodo("2026-11-04");
  expect(p.find((p) => p.id === "hoje")).toMatchObject({ de: "2026-11-04", ate: "2026-11-04" });
  expect(p.find((p) => p.id === "semana")).toMatchObject({ de: "2026-11-02", ate: "2026-11-08" });
  expect(p.find((p) => p.id === "mes")).toMatchObject({ de: "2026-11-01", ate: "2026-11-30" });
  expect(p.find((p) => p.id === "mes-anterior")).toMatchObject({
    de: "2026-10-01",
    ate: "2026-10-31",
  });
  expect(p.find((p) => p.id === "7dias")).toMatchObject({ de: "2026-10-29", ate: "2026-11-04" });
  expect(p.find((p) => p.id === "30dias")).toMatchObject({ de: "2026-10-06", ate: "2026-11-04" });
  expect(p.find((p) => p.id === "todos")).toMatchObject({ de: "", ate: "" });
  expect(atalhosPeriodo("2026-11-08").find((p) => p.id === "semana")).toMatchObject({
    de: "2026-11-02",
    ate: "2026-11-08",
  });
  expect(atalhosPeriodo("2026-11-09").find((p) => p.id === "semana")).toMatchObject({
    de: "2026-11-09",
    ate: "2026-11-15",
  });
});
test("competências respeitam virada do ano, fevereiro e intervalos personalizados", () => {
  expect(intervaloMes("2024-02")).toEqual({ de: "2024-02-01", ate: "2024-02-29" });
  expect(intervaloMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
  expect(atalhosPeriodo("2026-01-01").find((p) => p.id === "mes-anterior")).toMatchObject({
    de: "2025-12-01",
    ate: "2025-12-31",
  });
  expect(atalhosPeriodo("2026-01-01").find((p) => p.id === "semana")).toMatchObject({
    de: "2025-12-29",
    ate: "2026-01-04",
  });
  expect(mesDoIntervalo("2024-02-01", "2024-02-29")).toBe("2024-02");
  expect(mesDoIntervalo("2024-02-01", "2024-02-28")).toBe("");
  expect(mesDoIntervalo("", "")).toBe("");
  for (const m of ["2026-13", "2026-00", "2026-2", "abc", "0001-01"])
    expect(() => intervaloMes(m)).toThrow();
  expect(() => atalhosPeriodo("2026-02-30")).toThrow();
});
test("intervalos distintos são agrupados pelo campo sem misturar vencimento, emissão ou pagamento", () => {
  const changes: string[] = [];
  const campo = (label: string) => ({
    label,
    value: "",
    onChange: (v: string) => changes.push(label + ":" + v),
  });
  const p = paresDataFiltro([
    campo("Vencimento de"),
    campo("Pagamento até"),
    campo("Vencimento até"),
    campo("Pagamento de"),
    campo("Emissão de"),
    campo("Validade"),
    campo("Data da baixa"),
  ]);
  expect(p.map((p) => p.label)).toEqual(["Vencimento", "Pagamento"]);
  p[1]!.de.onChange("2026-11-01");
  p[1]!.ate.onChange("2026-11-30");
  expect(changes).toEqual(["Pagamento de:2026-11-01", "Pagamento até:2026-11-30"]);
  expect(paresDataFiltro([campo("De"), campo("Até")])[0]?.label).toBe("Datas");
  expect(paresDataFiltro([campo("Aprovação de"), campo("Aprovação até")])[0]?.label).toBe(
    "Aprovação",
  );
});
