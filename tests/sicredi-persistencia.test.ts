import { expect, test } from "bun:test";
import { erroPersistenciaSicredi } from "../src/lib/sicredi-persistencia";

test("diagnóstico diferencia rotina ausente, permissão e integridade sem expor corpo SQL", () => {
  for (const [code, reason] of [
    ["PGRST202", "ausente"],
    ["42501", "Permissão"],
    ["23503", "integridade"],
    ["42703", "incompatível"],
  ]) {
    const result = erroPersistenciaSicredi(
      "sicredi_liquidar_api_224",
      400,
      JSON.stringify({ code, message: "segredo-fixture", details: "segredo-fixture" }),
    );
    expect(result).toContain(reason!);
    expect(result).toContain(code!);
    expect(result).toContain("sicredi_liquidar_api_224");
    expect(result).not.toContain("segredo-fixture");
  }
  expect(erroPersistenciaSicredi("operacao", 503, "<html>segredo-fixture</html>")).toContain(
    "HTTP 503",
  );
  expect(
    erroPersistenciaSicredi("operacao", 400, '{"code":"P0001","message":"Saldo do titulo mudou"}'),
  ).toBe("Saldo do titulo mudou");
});

test("42702 identifica somente o nome da coluna ambígua sem expor detalhes", () => {
  const result = erroPersistenciaSicredi(
    "sicredi_liquidar_api_224",
    400,
    JSON.stringify({
      code: "42702",
      message: 'column reference "conta" is ambiguous',
      details: "segredo-fixture",
    }),
  );
  expect(result).toContain('campo "conta"');
  expect(result).toContain("42702");
  expect(result).not.toContain("segredo-fixture");
  expect(
    erroPersistenciaSicredi(
      "operacao",
      400,
      JSON.stringify({ code: "42702", message: "segredo-fixture" }),
    ),
  ).not.toContain("segredo-fixture");
});
