import test from "node:test";
import assert from "node:assert/strict";
import { authenticateRequest, requireRole } from "../src/lib/auth.server.ts";
import { emitirBoletoSchema } from "../src/lib/sicredi-schema.ts";
import { escapar } from "../src/lib/exportar.ts";

test("server rejects anonymous and malformed authorization before contacting services", async () => {
  for (const header of [undefined, "", "Basic abc", "Bearer ", "Bearer a b"])
    await assert.rejects(authenticateRequest(header), { statusCode: 401 });
});
test("financial role checks reject representatives and unassigned users", () => {
  for (const roles of [[], ["representante"], ["estoque"]])
    assert.throws(() => requireRole(roles, ["admin", "financeiro"]), { statusCode: 403 });
  assert.doesNotThrow(() => requireRole(["financeiro"], ["admin", "financeiro"]));
});
test("bank payload rejects nonfinite amounts, negative amounts and impossible dates", () => {
  const data = {
    contaReceberId: "00000000-0000-4000-8000-000000000001",
    seuNumero: "123",
    valor: 10,
    vencimento: "2026-09-30",
    pagador: {
      tipoPessoa: "PESSOA_JURIDICA",
      documento: "12345678000199",
      nome: "Cliente",
      endereco: "Rua A",
      cidade: "Cidade",
      uf: "SP",
      cep: "01001000",
    },
  };
  assert.equal(emitirBoletoSchema.safeParse(data).success, true);
  for (const valor of [NaN, Infinity, -1, 0, "10"])
    assert.equal(emitirBoletoSchema.safeParse({ ...data, valor }).success, false);
  assert.equal(emitirBoletoSchema.safeParse({ ...data, vencimento: "2026-02-30" }).success, false);
  assert.equal(emitirBoletoSchema.safeParse({ ...data, contaReceberId: undefined }).success, false);
});
test("CSV neutralizes spreadsheet formulas while preserving numeric negatives and quotes", () => {
  for (const value of ["=SUM(A1)", "+cmd", "-cmd", "@SUM(A1)", " \t=1+1"])
    assert.ok(escapar(value).startsWith("\"'"));
  assert.equal(escapar(-12), '"-12"');
  assert.equal(escapar('a"b'), '"a""b"');
  assert.equal(escapar(null), '""');
});
