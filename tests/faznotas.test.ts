import { describe, expect, test } from "bun:test";
import {
  validarConfiguracaoFiscal,
  pendenciasProdutoFiscal,
  selecionarCfop,
  situacaoFaznotas,
} from "../src/lib/faznotas";
const regra = {
  uf_emitente: "MG",
  cfop_interno: "5102",
  cfop_interestadual: "6102",
  revisado_contador: true,
};
test("configuração incompleta da imagem é recusada antes do salvamento", () => {
  const config = { ...regra, serie: "1", regime: "1", uf_emitente: "ES", cfop_interestadual: "" };
  expect(validarConfiguracaoFiscal(config)).toEqual([
    "Informe o CFOP de venda para outra UF: 4 dígitos, começando com 6.",
  ]);
  expect(validarConfiguracaoFiscal({ ...config, cfop_interestadual: "6102" })).toEqual([]);
  expect(validarConfiguracaoFiscal({ ...config, cfop_interestadual: "5102" })).toHaveLength(1);
});
describe("Preparação FAZNOTAS", () => {
  test("CFOP por UF confirmada pelo CEP e exceção do produto", () => {
    expect(selecionarCfop(regra, "MG", "MG")).toBe("5102");
    expect(selecionarCfop(regra, "ES", "ES")).toBe("6102");
    expect(selecionarCfop(regra, "ES", "ES", { cfop_interestadual: "6404" })).toBe("6404");
    expect(() => selecionarCfop(regra, "ES", "MG")).toThrow("diverge");
    expect(() => selecionarCfop({ ...regra, revisado_contador: false }, "MG", "MG")).toThrow(
      "contador",
    );
    expect(() => selecionarCfop(regra, "XX", "XX")).toThrow("inválida");
    expect(() => selecionarCfop(regra, "ES", "ES", { cfop_interestadual: "5102" })).toThrow("CFOP");
  });
  test("pendências sem presumir origem ou tributação", () => {
    expect(pendenciasProdutoFiscal({})).toHaveLength(3);
    expect(
      pendenciasProdutoFiscal({
        ncm: "25232910",
        origem_fiscal: "0",
        unidade: "SC",
        ean: "7894900011517",
      }),
    ).toEqual([]);
    expect(
      pendenciasProdutoFiscal({
        ncm: "25232910",
        origem_fiscal: "0",
        unidade: "SC",
        ean: "7894900011518",
        cest: "123",
      }),
    ).toHaveLength(2);
  });
  test("fila, duplicidade e indisponibilidade não são autorização", () => {
    expect(situacaoFaznotas({ status: "001" })).toBe("processando");
    expect(situacaoFaznotas({ status: "050", data: { recibo: "original" } })).toBe(
      "consultar_original",
    );
    expect(situacaoFaznotas({ status: "004" })).toBe("desconhecida");
    for (const codigo of ["100", "120", "150"])
      expect(situacaoFaznotas({ status: "004", data: { sefaz: { codigo } } })).toBe("autorizada");
    for (const codigo of ["105", "217"])
      expect(situacaoFaznotas({ status: "900", data: { sefaz: { codigo } } })).toBe("processando");
    expect(situacaoFaznotas({ status: "900", data: { sefaz: { codigo: "539" } } })).toBe(
      "rejeitada",
    );
  });
});
