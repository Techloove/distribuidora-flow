import type { ContextoNfe } from "../../src/lib/faznotas-documento";
export const idFiscal = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function contextoFiscal(): ContextoNfe {
  return {
    versao: "contexto-simulado",
    vinculada: false,
    dados: {
      nota: { id: idFiscal(7), status: "pendente", valor_total: 100, serie: "1" },
      pedido: {
        id: idFiscal(5),
        numero: 1,
        status: "faturado",
        total_itens: 100,
        total_liquido: 100,
        desconto_valor: 0,
        forma_desconto_valor: 0,
        frete_valor: 0,
        frete_volume_valor: 0,
        outras_despesas: 0,
        forma_acrescimo_valor: 0,
      },
      loja: {
        cnpj: "12345678000195",
        uf: "ES",
        inscricao_estadual: "123",
        logradouro: "Rua A",
        numero: "1",
        bairro: "Centro",
        cidade: "Vitória",
        cep: "29010001",
      },
      cliente: {
        tipo_pessoa: "PJ",
        cnpj_cpf: "12345678000195",
        razao_social: "Cliente teste",
        inscricao_estadual: "123",
        logradouro: "Rua A",
        numero: "1",
        bairro: "Centro",
        cidade: "Vitória",
        uf: "ES",
        cep: "29010001",
      },
      pessoa: null,
      fiscal: {
        serie: "1",
        regime: "1",
        uf_emitente: "ES",
        cfop_interno: "5102",
        cfop_interestadual: "6102",
        revisado_contador: true,
      },
      liberacao: { liberado: true, atual: true, ambiente: "homologacao" },
      itens: [
        {
          item: {
            id: idFiscal(6),
            quantidade: 1,
            preco_unitario: 100,
            total: 100,
            desconto_percentual: 0,
          },
          produto: {
            id: idFiscal(4),
            codigo: "1",
            descricao: "Cimento",
            ncm: "25232910",
            unidade: "SC",
            origem_fiscal: "0",
          },
          regras: [
            {
              cfop: "5102",
              revisao_valida: true,
              aceita_padrao_ibs_cbs: false,
              configuracoes: {
                icms: { estados: [{ estado: "ES", "icms-cst": "102" }] },
                "pis-cofins": { "pis-cst": "49", "cofins-cst": "49" },
                "cbs-ibs": {
                  "cbs-ibs-cst": "000",
                  classificacao: "000001",
                  aliquotas: { "percentual-cbs": "0", "percentual-ibs": "0" },
                },
              },
            },
          ],
        },
      ],
      faturas: [{ valor: 100, data: "2026-11-20" }],
    },
  };
}
