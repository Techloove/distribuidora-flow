import { test, expect } from "bun:test";
import { rastreioRespostaSicoob } from "../src/lib/server-sicoob-http";
test("rastreio aceita só identificadores/data e descarta credenciais, cookies, controles e valores secretos", () => {
  const r = rastreioRespostaSicoob(
    {
      "x-request-id": "pedido-123",
      "x-correlation-id": "segredo-sensivel",
      authorization: "Bearer NÃO EXPOR",
      "set-cookie": "NÃO EXPOR",
      date: "Thu, 12 Nov 2026 12:10:00 GMT",
      "trace-id": "abc\nTOKEN",
      "x-amz-apigw-id": ["abc"],
    },
    ["segredo-sensivel"],
  );
  expect(r).toEqual({ "x-request-id": "pedido-123", date: "Thu, 12 Nov 2026 12:10:00 GMT" });
});
