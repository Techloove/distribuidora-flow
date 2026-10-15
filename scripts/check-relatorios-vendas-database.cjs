const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    // Reuse only the minimal identity/schema fixture; production access helpers are loaded below.
    const fixture = fs.readFileSync(
      path.join(__dirname, "check-agenda-unificada-database.cjs"),
      "utf8",
    );
    const start = fixture.indexOf("`create role anon"),
      end = fixture.indexOf("`.replaceAll", start);
    const setup = fixture
      .slice(start + 1, end)
      .replace(/\$\{id\((\d+)\)\}/g, (_, n) => id(Number(n)))
      .replaceAll("select1", "select 1");
    await d.exec(setup);
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert(a >= 0);
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    await fn("fase206_carteira_representante.sql", "escopo_representante");
    await fn("fase206_carteira_representante.sql", "cliente_na_minha_carteira");
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await d.exec(`
 alter table clientes alter column codigo type text;
 alter table pedidos add column numero int,add column representante_id uuid,add column rota_id uuid,add column total_itens numeric default 0,add column desconto_valor numeric default 0,add column forma_desconto_valor numeric default 0,add column frete_valor numeric default 0,add column forma_acrescimo_valor numeric default 0,add column comissao_valor numeric default 0,add column custo_frete numeric default 0,add column tributos_estimados numeric default 0,add column despesas_variaveis numeric default 0;
 create table produtos(id uuid primary key,codigo text,descricao text,custo_medio numeric,preco_custo numeric,ultimo_custo numeric,peso_kg numeric);
 create table pedido_itens(id uuid default gen_random_uuid(),pedido_id uuid,produto_id uuid,quantidade numeric,total numeric,custo_unitario_base numeric);
 create table comissoes(id uuid default gen_random_uuid(),pedido_id uuid,representante_id uuid,centro_id uuid,valor numeric,status text);
 create table devolucoes(id uuid primary key,pedido_id uuid,centro_id uuid,valor_total numeric,status text);
 create table devolucao_itens(devolucao_id uuid,produto_id uuid,quantidade numeric,condicao text);
 -- Phase229 presence check only; report calculations never call this stand-in.
 create function agenda_leads_229(uuid,uuid,uuid,text,text,text,text,text,integer) returns jsonb language sql as $$ select '{}'::jsonb $$;
 insert into role_menus values('representante','/relatorios'),('financeiro','/relatorio-vendas'),('comercial','/relatorios');
 insert into permissoes values('margem_pedido_ver','Margem','Pedidos',100,'/pedidos'),('indicadores_comparar','Comparar','Relatórios',129,'/relatorios');
 insert into role_permissoes values('representante','margem_pedido_ver');
 delete from pedidos;
 insert into produtos values('${id(70)}','0007','Produto teste',99,99,99,1);
 insert into pedidos(id,numero,cliente_id,representante_id,rota_id,centro_id,status,data_pedido,total_itens,total_liquido,comissao_valor,custo_frete,tributos_estimados,despesas_variaveis) values
 ('${id(100)}',1,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','confirmado','2026-10-15',1000,1000,50,20,30,10),
 ('${id(101)}',2,'${id(41)}','${id(21)}','${id(31)}','${id(10)}','entregue','2026-10-16',2000,2000,200,0,0,0),
 ('${id(102)}',3,'${id(40)}','${id(20)}','${id(30)}','${id(11)}','confirmado','2026-10-15',3000,3000,0,0,0,0),
 ('${id(103)}',4,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','rascunho','2026-10-15',9000,9000,0,0,0,0),
 ('${id(104)}',5,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','aguardando_aprovacao','2026-10-15',9000,9000,0,0,0,0),
 ('${id(105)}',6,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','aprovado','2026-10-15',9000,9000,0,0,0,0),
 ('${id(106)}',7,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','cancelado','2026-10-15',9000,9000,0,0,0,0),
 ('${id(107)}',8,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','confirmado','2026-09-15',500,500,0,0,0,0),
 ('${id(108)}',9,'${id(41)}','${id(20)}','${id(30)}','${id(10)}','confirmado','2026-10-15',7000,7000,0,0,0,0);
 insert into pedido_itens(pedido_id,produto_id,quantidade,total,custo_unitario_base) select id,'${id(70)}',10,total_itens,40 from pedidos;
 -- Extra commission line exercises join fanout protection, including cancelled rows.
 insert into comissoes(pedido_id,representante_id,centro_id,valor,status) values
 ('${id(100)}','${id(20)}','${id(10)}',45,'liberada'),('${id(100)}','${id(20)}','${id(10)}',999,'cancelada'),('${id(101)}','${id(21)}','${id(10)}',200,'paga');
 insert into devolucoes values('${id(200)}','${id(100)}','${id(10)}',100,'confirmada'),('${id(201)}','${id(100)}','${id(10)}',999,'rascunho');
 insert into devolucao_itens values('${id(200)}','${id(70)}',1,'revenda');
 `);
    const sql = fs.readFileSync(
      path.join(root, "db/fase230_relatorios_vendas_unificados.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    const query = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
    const rel = async (o = {}) =>
      (
        await query(
          "select relatorio_vendas_230($1::date,$2::date,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13) data",
          [
            "2026-10-01",
            "2026-10-31",
            o.centro ?? null,
            o.rep ?? null,
            o.rota ?? null,
            o.cidade ?? "",
            o.busca ?? "",
            o.status ?? "",
            o.grupo ?? "rota",
            o.ordem ?? "vendas",
            o.asc ?? false,
            o.pagina ?? 0,
            o.pedidos ?? 0,
          ],
        )
      )[0].data;
    const denied = async (f, re) => {
      let err;
      try {
        await f();
      } catch (e) {
        err = e;
      }
      assert(err, "Expected denial");
      if (re) assert.match(err.message, re);
    };
    await actor(1);
    let r = await rel();
    assert.equal(r.totais.pedidos, 1);
    assert.equal(r.totais.vendido, 1000);
    assert.equal(r.totais.vendas, 900);
    assert.equal(r.totais.custo, 360);
    assert.equal(r.totais.comissao, 45);
    assert.equal(r.totais.lucro_bruto_sem, 540);
    assert.equal(r.totais.lucro_bruto_com, 495);
    assert.equal(r.totais.lucro_liquido_sem, 480);
    assert.equal(r.totais.lucro_liquido_com, 435);
    assert.equal(r.totais.margem, 48.33);
    assert.equal(r.anterior.vendas, 500);
    assert.equal(r.pedidos.length, 1);
    assert.equal(r.produtos[0].codigo, "0007");
    assert.equal(r.produtos[0].quantidade, 10);
    assert.equal((await rel({ busca: "C001" })).totais.pedidos, 1);
    assert.equal((await rel({ busca: "Cliente B" })).pedidos.length, 0);
    assert.equal((await rel({ cidade: "Cidade A" })).totais.pedidos, 1);
    assert.equal((await rel({ status: "entregue" })).pedidos.length, 0);
    await denied(() => rel({ rep: id(21) }), /Carteira/);
    await denied(() => rel({ centro: id(11) }), /Centro/);
    await denied(() => rel({ grupo: "injetar" }), /Agrupamento/);
    await denied(() => rel({ status: "rascunho" }), /Situação/);
    await denied(() => rel({ pagina: -1 }), /Página/);
    const opt = (await query("select relatorio_vendas_filtros_230() data"))[0].data;
    assert.equal(opt.representantes.length, 1);
    assert.equal(opt.representantes[0].nome, "Rep A");
    assert.equal(opt.rotas.length, 1);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','gestor')`);
    await actor(1);
    assert.equal((await rel()).totais.pedidos, 1);
    await d.exec("reset role");
    await d.exec(`delete from user_roles where user_id='${id(1)}' and role='gestor'`);
    await actor(5);
    assert.equal((await rel()).pedidos.length, 0);
    await actor(2);
    assert.equal((await rel()).totais.pedidos, 1);
    assert.equal((await rel()).totais.vendas, 2000);
    await actor(3);
    r = await rel();
    assert.equal(r.totais.pedidos, 4);
    assert.equal(r.totais.vendas, 12900);
    assert.equal(
      r.comparativo.filter((c) => c.periodo === "atual").reduce((v, c) => v + c.vendas, 0),
      12900,
    );
    assert.equal(
      (await rel({ centro: id(10) })).comparativo.filter((c) => c.periodo === "atual").length,
      1,
    );
    for (const grupo of ["rota", "cidade", "representante", "cliente", "centro", "mes"])
      assert((await rel({ grupo })).ranking.length > 0);
    const baixo = await rel({ grupo: "cliente", ordem: "lucro_liquido", asc: true });
    const alto = await rel({ grupo: "cliente", ordem: "lucro_liquido" });
    assert.equal(baixo.ranking[0].chave, alto.ranking.at(-1).chave);
    await actor(4);
    r = await rel();
    assert.equal(r.rentabilidade, false);
    assert.equal(r.totais.custo, null);
    assert.equal(r.totais.lucro_liquido_com, null);
    assert(r.pedidos.every((p) => p.custo === null));
    await denied(() => rel({ ordem: "margem_sem" }), /Rentabilidade/);
    await d.exec("reset role");
    await d.exec(`update profiles set ativo=false where id='${id(1)}'`);
    await actor(1);
    await denied(() => rel(), /não liberados/);
    await d.exec("reset role");
    await d.exec(
      `update profiles set ativo=true where id='${id(1)}'; update clientes set representante_id='${id(21)}' where id='${id(40)}'`,
    );
    await actor(1);
    assert.equal((await rel()).pedidos.length, 0);
    await d.exec("reset role");
    await d.exec(
      `update clientes set representante_id='${id(20)}' where id='${id(40)}'; delete from role_permissoes where role='representante' and permissao='vendas_rentabilidade_ver'`,
    );
    await d.exec(sql);
    await actor(1);
    assert.equal((await rel()).rentabilidade, false);
    await d.exec("reset role");
    await d.exec(
      `insert into pedidos(id,numero,cliente_id,representante_id,rota_id,centro_id,status,data_pedido,total_itens,total_liquido) select gen_random_uuid(),1000+g,'${id(40)}','${id(20)}','${id(30)}','${id(10)}','confirmado','2026-10-15',1,1 from generate_series(1,1100) g`,
    );
    await actor(1);
    r = await rel();
    assert.equal(r.totais.pedidos, 1101);
    assert.equal(r.totais.vendas, 2000);
    assert.equal(r.pedidos.length, 50);
    assert.equal((await rel({ pedidos: 22 })).pedidos.length, 1);
    await d.exec("reset role");
    await d.exec(
      `delete from role_permissoes where role='representante' and permissao='vendas_relatorio_ver'`,
    );
    await d.exec(sql);
    await actor(1);
    await denied(() => rel(), /não liberados/);
    await d.exec("reset role");
    await d.exec(`insert into role_permissoes values('representante','vendas_relatorio_ver'),('representante','vendas_rentabilidade_ver');
      insert into clientes(id,codigo,razao_social,representante_id,centro_id,cidade) select gen_random_uuid(),'P'||g,'Cliente pagina '||g,'${id(20)}','${id(10)}','Cidade P'||g from generate_series(1,55) g;
      insert into pedidos(id,numero,cliente_id,representante_id,centro_id,status,data_pedido,total_itens,total_liquido)
      select gen_random_uuid(),2000+row_number() over(),id,'${id(20)}','${id(10)}','confirmado','2026-10-15',0,0 from clientes where codigo like 'P%';`);
    await actor(1);
    r = await rel({ grupo: "cliente" });
    assert.equal(r.grupos, 56);
    assert.equal(r.ranking.length, 50);
    assert.equal((await rel({ grupo: "cliente", pagina: 1 })).ranking.length, 6);
    const vazios = await rel({ busca: "Cliente pagina" });
    assert.equal(vazios.totais.margem, null);
    assert(vazios.totais.sem_custo > 0);
    await d.exec("reset role");
    await d.exec(`update devolucao_itens set condicao='avaria' where devolucao_id='${id(200)}'`);
    await actor(1);
    r = await rel({ busca: "C001", pedidos: 22 });
    assert.equal(r.pedidos.find((p) => p.numero === 1).custo, 400);
    assert.equal(r.pedidos.find((p) => p.numero === 1).lucro_liquido_com, 395);
    await d.exec("reset role");
    await d.exec(`update pedido_itens set custo_unitario_base=null where pedido_id='${id(100)}'`);
    await actor(1);
    r = await rel({ busca: "C001", pedidos: 22 });
    assert.equal(r.pedidos.find((p) => p.numero === 1).custo, 990);
    assert.equal(r.pedidos.find((p) => p.numero === 1).lucro_liquido_com, -195);
    assert.equal(r.pedidos.find((p) => p.numero === 1).custo_atual, 1);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','admin')`);
    await actor(1);
    assert((await rel()).totais.pedidos > 1156);
    await d.exec("reset role;set role anon");
    await denied(() => rel(), /permission denied/);
    console.log(
      "OK relatórios230: fórmulas com/sem comissão, devoluções, custo histórico, sem duplicidade, filtros, 1101 pedidos sem truncar, paginação, carteira A/B/master/perfis combinados, centros, acesso/revogação/reaplicação/anon.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
