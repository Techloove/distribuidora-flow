import { expect, test } from "bun:test";
import { mensagemErroComissoes } from "../src/lib/comissoes-consulta";
test("timeout não recomenda reinstalar SQL antigo", () => {
  const mensagem = mensagemErroComissoes({
    code: "57014",
    message: "canceling statement due to statement timeout",
  });
  expect(mensagem).toContain("tempo limite");
  expect(mensagem).not.toContain("fase45");
  expect(mensagemErroComissoes({ code: "42P01", message: "relation does not exist" })).toContain(
    "atualização",
  );
  expect(mensagemErroComissoes({ message: "Sem acesso à loja" })).toBe("Sem acesso à loja");
});
