import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  buscaReferencias,
  correspondeReferencia,
  destinoReferencia,
  idReferencia,
} from "../src/lib/referencias-registros";

const pedido = "11111111-1111-4111-8111-111111111111";
const cliente = "22222222-2222-4222-8222-222222222222";
const titulo = "33333333-3333-4333-8333-333333333333";
const boleto = "44444444-4444-4444-8444-444444444444";

test("cliente e fornecedor abrem o vínculo comercial, sem confundir com o id da pessoa", () => {
  expect(destinoReferencia("cliente", cliente)).toEqual({ to: "/pessoas", search: { cliente } });
  expect(destinoReferencia("fornecedor", cliente)).toEqual({
    to: "/pessoas",
    search: { fornecedor: cliente },
  });
  expect(destinoReferencia("pessoa", cliente)).toEqual({
    to: "/pessoas",
    search: { pessoa: cliente },
  });
  expect(destinoReferencia("clientePedido", pedido)).toEqual({
    to: "/pessoas",
    search: { pedido },
  });
});

test("pedido, títulos e boleto usam seus próprios identificadores e filtros de destino", () => {
  expect(destinoReferencia("pedido", pedido)).toEqual({ to: "/pedidos", search: { pedido } });
  expect(destinoReferencia("financeiroPedido", pedido)).toEqual({
    to: "/receber",
    search: { pedido },
  });
  expect(destinoReferencia("boletosPedido", pedido)).toEqual({
    to: "/boletos",
    search: { pedido },
  });
  expect(destinoReferencia("receber", titulo)).toEqual({ to: "/receber", search: { titulo } });
  expect(destinoReferencia("pagar", titulo)).toEqual({ to: "/pagar", search: { titulo } });
  expect(destinoReferencia("boleto", boleto)).toEqual({ to: "/boletos", search: { boleto } });
});

test("número do documento, nomes e ids ausentes não produzem links para registros errados", () => {
  for (const valor of [
    undefined,
    null,
    "",
    "PED-26/1",
    26,
    "Cliente",
    "-".repeat(36),
    "javascript:alert(1)",
  ]) {
    expect(idReferencia(valor)).toBeUndefined();
    expect(destinoReferencia("pedido", valor)).toBeNull();
  }
  expect(buscaReferencias({ pedido: "PED-26/1", titulo, cliente: [cliente] })).toEqual({
    titulo,
    pedido: undefined,
    cliente: undefined,
    boleto: undefined,
  });
});

test("vínculos selecionam o registro certo mesmo quando documentos ou números se repetem", () => {
  const contas = [
    { id: titulo, pedido_id: pedido, cliente_id: cliente, documento: "26", status: "pago" },
    { id: boleto, pedido_id: boleto, cliente_id: cliente, documento: "26", status: "aberto" },
  ];
  expect(contas.filter((r) => correspondeReferencia(r, buscaReferencias({ titulo })))).toEqual([
    contas[0]!,
  ]);
  expect(contas.filter((r) => correspondeReferencia(r, buscaReferencias({ pedido })))).toEqual([
    contas[0]!,
  ]);
  expect(contas.filter((r) => correspondeReferencia(r, buscaReferencias({})))).toEqual(contas);
  const b = { id: boleto, pedido_id: pedido, conta_receber_id: titulo, cliente_id: cliente };
  expect(
    correspondeReferencia(b, buscaReferencias({ titulo, boleto, pedido, cliente }), true),
  ).toBe(true);
  expect(correspondeReferencia(b, buscaReferencias({ titulo: boleto }), true)).toBe(false);
  expect(correspondeReferencia(contas[0]!, buscaReferencias({ boleto }))).toBe(false);
});

test("componente renderiza link real apenas com permissão e identidade válida", () => {
  // Isola o mock de permissões para não interferir nas demais suítes.
  const script = `
    import { mock } from 'bun:test';
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
    let liberado = true;
    mock.module('./src/lib/permissoes.ts', () => ({useAcesso: () => ({carregando:false, pode: () => liberado})}));
    const {ReferenciaRegistro} = await import('./src/components/referencia-registro.tsx');
    const root = createRootRoute();
    const router = createRouter({routeTree:root,history:createMemoryHistory({initialEntries:['/']})});
    await router.load();
    const render = (id) => renderToStaticMarkup(React.createElement(RouterContextProvider,{router},React.createElement(ReferenciaRegistro,{tipo:'pedido',id},'Pedido 26')));
    const permitido=render('${pedido}');
    liberado=false;
    const negado=render('${pedido}');
    liberado=true;
    const ausente=render(null);
    console.log(JSON.stringify({permitido,negado,ausente}));
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  const html = JSON.parse(result.stdout.trim());
  expect(html.permitido).toContain(`/pedidos?pedido=${pedido}`);
  expect(html.permitido).toContain("Pedido 26</a>");
  expect(html.negado).toBe("Pedido 26");
  expect(html.ausente).toBe("Pedido 26");
});
