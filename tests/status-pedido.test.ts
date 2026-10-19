import { expect, test } from "bun:test";
import {
  ETAPAS_PEDIDO,
  nomeStatusPedido,
  ordemStatusPedido,
  situacaoPedido,
  statusVisivelPedido,
} from "../src/lib/status-pedido";

test("fluxo comercial e logístico segue a ordem sem exibir códigos internos", () => {
  const fluxo = [
    "rascunho",
    "aguardando_aprovacao",
    "aprovado",
    "confirmado",
    "separacao",
    "separado",
    "conferido",
    "faturado",
    "em_carga",
    "em_rota",
    "entregue",
  ];
  let anterior = 0;
  for (const status of fluxo) {
    const etapa = ordemStatusPedido(status);
    expect(etapa).toBeGreaterThanOrEqual(anterior);
    expect(etapa).toBeLessThan(ETAPAS_PEDIDO.length);
    expect(nomeStatusPedido(status)).not.toContain("_");
    anterior = etapa;
  }
  expect(ETAPAS_PEDIDO.slice(0, 3)).toEqual(["Digitação", "Aguardando aprovação", "Aprovado"]);
  expect(nomeStatusPedido("aprovado")).toBe("Aprovado");
  expect(situacaoPedido("confirmado")).toEqual(situacaoPedido("aprovado"));
  expect(ordemStatusPedido("aguardando_aprovacao")).toBeLessThan(ordemStatusPedido("aprovado"));
  expect(ordemStatusPedido("aprovado")).toBeLessThan(ordemStatusPedido("separacao"));
  expect(nomeStatusPedido("separado")).not.toBe(nomeStatusPedido("conferido"));
});
test("parcial e tentativa sem entrega não indicam recebimento integral", () => {
  for (const status of ["parcial", "nao_entregue"]) {
    expect(situacaoPedido(status).atencao).toBe(true);
    expect(ordemStatusPedido(status)).toBeLessThan(ordemStatusPedido("entregue"));
  }
});
test("encerramentos excepcionais e status desconhecido não completam o indicador", () => {
  for (const status of [
    "cancelado",
    "recusado",
    "devolvido",
    "desconhecido",
    "constructor",
    "__proto__",
    null,
  ]) {
    expect(situacaoPedido(status).etapa).toBeNull();
    expect(situacaoPedido(status).atencao).toBe(true);
  }
});

test("orçamentos usam validade comercial sem virar venda ou falsa etapa logística", () => {
  const base = {
    status: "rascunho",
    tipo_documento: "orcamento",
    orcamento_situacao: "negociacao",
    orcamento_validade: "2026-10-20",
  };
  expect(statusVisivelPedido(base, "2026-10-20")).toBe("orcamento");
  expect(statusVisivelPedido(base, "2026-10-21")).toBe("orcamento_expirado");
  expect(statusVisivelPedido({ ...base, orcamento_situacao: "recusado" }, "2026-11-01")).toBe(
    "orcamento_recusado",
  );
  expect(
    statusVisivelPedido(
      {
        ...base,
        tipo_documento: "pedido",
        status: "aguardando_aprovacao",
        orcamento_situacao: "aceito",
      },
      "2026-11-01",
    ),
  ).toBe("aguardando_aprovacao");
  for (const s of ["orcamento", "orcamento_expirado", "orcamento_recusado"])
    expect(situacaoPedido(s).etapa).toBeNull();
});

test("filtros e contagens agrupam aprovação e confirmação sem alterar os documentos", () => {
  const documentos = [
    "rascunho",
    "digitacao",
    "aguardando_aprovacao",
    "aprovado",
    "confirmado",
  ].map((status) => ({ tipo_documento: "pedido", status }));
  const agrupados = new Map<string, number>();
  for (const doc of documentos) {
    const status = statusVisivelPedido(doc);
    agrupados.set(status, (agrupados.get(status) ?? 0) + 1);
  }
  expect([...agrupados.entries()]).toEqual([
    ["rascunho", 2],
    ["aguardando_aprovacao", 1],
    ["aprovado", 2],
  ]);
  expect(documentos.map((doc) => doc.status)).toEqual([
    "rascunho",
    "digitacao",
    "aguardando_aprovacao",
    "aprovado",
    "confirmado",
  ]);
});
