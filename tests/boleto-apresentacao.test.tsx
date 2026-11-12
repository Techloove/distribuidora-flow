import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { apresentacaoBoleto } from "../src/lib/boleto-apresentacao";
import { HistoricoBoleto } from "../src/components/historico-boleto";
import { cancelamentoBoletoPendente } from "../src/lib/boletos-lista";
const dia = "2026-11-12T15:00:00Z";
const anterior = { vencimento: "2026-11-15", abatimento: 0 };
const esperado = { vencimento: "2026-11-18", abatimento: 5 };
const op = {
  id: "op",
  tipo: "abatimento",
  estado: "confirmado",
  motivo: "Ajuste aprovado",
  created_at: dia,
  updated_at: dia,
  anterior,
  esperado,
};
const equivalente = (banco: string) =>
  banco === "sicoob"
    ? {
        banco,
        retorno: { abatimento: 5 },
        operacoes_sicoob: [op, { ...op, id: "v", tipo: "vencimento" }],
      }
    : {
        banco,
        condicoes_sicredi_292: { abatimento: 5 },
        abatimentos_confirmados: [op],
        alteracoes_vencimento: [
          {
            ...op,
            id: "v",
            vencimento_anterior: anterior.vencimento,
            vencimento_novo: esperado.vencimento,
          },
        ],
      };
for (const banco of ["sicredi", "sicoob"]) {
  test(`${banco}: mesmo contrato para abatimento, vencimento, motivo e histórico`, () => {
    const a = apresentacaoBoleto(equivalente(banco));
    expect(a.abatimento).toBe(5);
    expect(a.alteracoes[0]).toMatchObject({ anterior: "2026-11-15", novo: "2026-11-18" });
    expect(a.historicoAbatimento?.motivo).toBe("Ajuste aprovado");
    const html = renderToStaticMarkup(<HistoricoBoleto eventos={a.eventos} banco={a.nome} />);
    expect(html).toContain("Confirmada");
    expect(html).toContain("15/11/2026");
    expect(html).toContain("18/11/2026");
    expect(html).toContain("Ajuste aprovado");
  });
  test(`${banco}: solicitação não confirmada nunca colore vencimento como alterado`, () => {
    const b = equivalente(banco);
    const pendente =
      banco === "sicoob"
        ? {
            ...b,
            retorno: { abatimento: 0 },
            operacoes_sicoob: [{ ...op, tipo: "vencimento", estado: "incerto" }],
          }
        : {
            ...b,
            condicoes_sicredi_292: { abatimento: 0 },
            alteracoes_vencimento: [
              {
                ...op,
                estado: "enviado",
                vencimento_anterior: anterior.vencimento,
                vencimento_novo: esperado.vencimento,
              },
            ],
            abatimentos_confirmados: [],
          };
    const a = apresentacaoBoleto(pendente);
    expect(a.abatimento).toBe(0);
    expect(a.alteracoes).toEqual([]);
    const html = renderToStaticMarkup(<HistoricoBoleto eventos={a.eventos} banco={a.nome} />);
    expect(html).toContain("não representa uma alteração confirmada");
    expect(html).not.toContain("Confirmada em");
  });
  test(`${banco}: cancelar abatimento remove o destaque mas conserva o histórico`, () => {
    const b = equivalente(banco);
    const e = {
      ...op,
      esperado: { abatimento: 0 },
      tipo: banco === "sicredi" ? "cancelar_abatimento" : "abatimento",
    };
    const a = apresentacaoBoleto(
      banco === "sicoob"
        ? { ...b, retorno: { abatimento: 0 }, operacoes_sicoob: [e] }
        : { ...b, condicoes_sicredi_292: { abatimento: 0 }, abatimentos_confirmados: [e] },
    );
    expect(a.abatimento).toBe(0);
    expect(a.eventos.some((e) => e.titulo === "Cancelar abatimento")).toBe(true);
  });
}
test("Sicoob pendente de baixa usa o mesmo aviso de cancelamento sem encerrar o título", () => {
  const b = {
    banco: "sicoob",
    status: "registrado",
    sicoob_pendente_316: "op",
    operacoes_sicoob: [{ ...op, tipo: "baixar", estado: "incerto" }],
  };
  expect(cancelamentoBoletoPendente(b)).toBe(true);
  expect(cancelamentoBoletoPendente({ ...b, status: "baixado" })).toBe(false);
  expect(cancelamentoBoletoPendente({ ...b, sicoob_pendente_316: "outra" })).toBe(false);
});
test("banco desconhecido não herda dados Sicredi nem Sicoob por engano", () => {
  const a = apresentacaoBoleto({
    ...equivalente("sicoob"),
    banco: "outro",
    condicoes_sicredi_292: { abatimento: 99 },
  });
  expect(a.abatimento).toBe(0);
  expect(a.eventos).toEqual([]);
  expect(a.alteracoes).toEqual([]);
});

test("condições de um banco não são usadas na apresentação do outro", () => {
  expect(
    apresentacaoBoleto({ ...equivalente("sicoob"), condicoes_sicredi_292: { abatimento: 99 } })
      .abatimento,
  ).toBe(5);
  expect(
    apresentacaoBoleto({ ...equivalente("sicredi"), retorno: { abatimento: 99 } }).abatimento,
  ).toBe(5);
});
