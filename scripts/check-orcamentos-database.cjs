const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    const source = fs.readFileSync(
        path.join(__dirname, "check-agenda-unificada-database.cjs"),
        "utf8",
      ),
      a = source.indexOf("`create role anon"),
      b = source.indexOf("`.replaceAll", a);
    await d.exec(
      source
        .slice(a + 1, b)
        .replace(/\$\{id\((\d+)\)\}/g, (_, n) => id(Number(n)))
        .replaceAll("select1", "select 1")
        .replace("'financeiro','comercial'", "'financeiro','comercial','estoque','expedicao'"),
    );
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert(a >= 0, name);
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    for (const n of [
      "escopo_representante",
      "cliente_na_minha_carteira",
      "documento_na_minha_carteira",
    ])
      await fn("fase206_carteira_representante.sql", n);
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await fn("fase99_usuario_ativo_execucao_rpc.sql", "can_operate");
    await d.exec(`
 delete from pedidos;alter table pedidos add primary key(id);create sequence pedidos_numero_seq start 100;
 alter table pedidos add column numero bigint default nextval('pedidos_numero_seq'),add column representante_id uuid,add column rota_id uuid,add column forma_pagamento_id uuid,add column previsao_entrega date,add column observacoes text,add column parcelas int default 1,add column total_itens numeric default 0,add column comissao_valor numeric default 0,add column comissao_percentual numeric default 0,add column frete_valor numeric default 0,add column desconto_valor numeric default 0,add column data_entrega date;
 alter table pedidos alter column status set default 'rascunho',alter column total_liquido set default 0;
 alter table representantes add column ativo bool default true;alter table rotas add column ativo bool default true;
 create table formas_pagamento(id uuid primary key,nome text,tipo text,ativo bool,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int);
 insert into formas_pagamento values('${id(70)}','Boleto20/40','boleto',true,2,20,20);
 create table produtos(id uuid primary key,codigo text,descricao text);insert into produtos values('${id(80)}','0001','Produto teste');
 create table pedido_itens(id uuid primary key default gen_random_uuid(),pedido_id uuid references pedidos(id),produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric default 0,total numeric generated always as(quantidade*preco_unitario*(1-desconto_percentual/100)) stored);
 alter table contas_receber add column pedido_id uuid,add column data_emissao date;
 create table estoque_movimentos(pedido_id uuid,origem text,documento_id uuid,quantidade numeric);
 create table estoque_reservas(pedido_id uuid,produto_id uuid,centro_id uuid,quantidade numeric,primary key(pedido_id,produto_id));
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);insert into estoque_saldos values('${id(80)}','${id(10)}',1);
 create table comissoes(id uuid default gen_random_uuid(),pedido_id uuid,representante_id uuid,base_calculo numeric,percentual numeric,valor numeric,centro_id uuid,status text default 'prevista');
 create table creditos_clientes(id uuid,status text,cliente_id uuid,centro_id uuid,saldo numeric);
 create table creditos_clientes_aplicacoes(id uuid,pedido_id uuid,credito_id uuid,status text,valor numeric,aplicado_em timestamptz);
 create table expedicoes(id uuid,pedido_id uuid,centro_id uuid,status text,created_at timestamptz default now(),data_saida date,data_entrega date,previsao_entrega date);
 create table entrega_registros(id uuid,pedido_id uuid,expedicao_id uuid,centro_id uuid,tipo text,recebedor text,data_entrega date,created_at timestamptz);
 create table entrega_itens(registro_id uuid);create table cargas(id uuid,numero int,centro_id uuid,status text);create table carga_pedidos(carga_id uuid,pedido_id uuid);
 create function can_stock(uuid) returns bool language sql as $$select can_manage($1)$$;
 create function can_ship(uuid) returns bool language sql as $$select can_manage($1)$$;
 create function notificar(text,text,text,text) returns void language sql as $$select null::void$$;
 -- Fixture recalc deliberately invokes commission apuração, proving the quote guard intercepts it.
 create function apurar_comissao_pedido(_pedido_id uuid) returns void language plpgsql as $$begin insert into comissoes(pedido_id,valor) values(_pedido_id,1);end$$;
 create function recalcular_pedido(_pedido_id uuid) returns void language plpgsql as $$begin update pedidos set total_itens=(select coalesce(sum(total),0) from pedido_itens where pedido_id=_pedido_id),total_liquido=(select coalesce(sum(total),0) from pedido_itens where pedido_id=_pedido_id) where id=_pedido_id;perform apurar_comissao_pedido(_pedido_id);end$$;
 create function validar_pedido(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language plpgsql as $$begin insert into estoque_movimentos(origem,documento_id,quantidade) values($6,$7,$4);end$$;
 create function despachar_carga_233(uuid,date) returns void language sql as $$select null::void$$;
 insert into permissoes values('entrega_registrar','Entrega','Entregas',105,'/entregas');
 insert into role_menus values('representante','/pedidos');
 grant select on pedidos,pedido_itens,estoque_reservas,comissoes,estoque_movimentos to authenticated;
 `);
    for (const name of [
      "criar_pedido_rascunho",
      "adicionar_item_pedido",
      "atualizar_item_pedido",
      "remover_item_pedido",
      "atualizar_pedido_comercial",
    ])
      await fn("fase81_hardening_crud_pedidos.sql", name);
    await fn("fase12_custo_markup_parcelas.sql", "aplicar_parcelas_forma");
    await d.exec(
      "create trigger parcelas_forma before insert or update of forma_pagamento_id on pedidos for each row execute function aplicar_parcelas_forma()",
    );
    await fn("fase42_fluxo_operacional.sql", "avancar_pedido");
    await fn("fase80_credito_cliente_devolucao.sql", "confirmar_pedido");
    await fn("fase80_credito_cliente_devolucao.sql", "cancelar_pedido");
    const s209 = fs.readFileSync(path.join(root, "db/fase209_rotinas_distribuidora.sql"), "utf8"),
      start = s209.indexOf(
        "do $$",
        s209.indexOf("-- A confirmação conserva estoque/crédito/idempotência"),
      );
    await d.exec(s209.slice(start, s209.indexOf("end $$;", start) + 7));
    await d.exec(
      fs.readFileSync(path.join(root, "db/fase227_prazos_forma_pagamento_pedido.sql"), "utf8"),
    );
    await fn("fase212_reservas_estoque.sql", "reservar_pedido_212");
    await d.exec(
      "create trigger reserva_pedido_212 after update of status on pedidos for each row execute function reservar_pedido_212()",
    );
    await d.exec(fs.readFileSync(path.join(root, "db/fase235_acompanhamento_pedidos.sql"), "utf8"));
    const sql = fs.readFileSync(path.join(root, "db/fase236_orcamentos.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, args = []) => (await d.query(s, args)).rows,
      actor = async (n) => {
        await d.exec("reset role");
        await d.query("select set_config('test.actor',$1,false)", [id(n)]);
        await d.exec("set role authenticated");
      };
    const denied = async (f, re) => assert.rejects(f, re),
      create = async (c = 40) =>
        (
          await q(
            "select * from criar_orcamento_236($1,$2,$3,$4,(now() at time zone 'America/Sao_Paulo')::date+15)",
            [id(c), id(10), id(30), id(70)],
          )
        )[0];
    const effectCounts = async () => {
      await d.exec("reset role");
      const r = await q(
        "select (select count(*) from estoque_movimentos) estoque,(select count(*) from estoque_reservas) reservas,(select count(*) from contas_receber) titulos,(select count(*) from comissoes) comissoes,(select count(*) from creditos_clientes_aplicacoes) creditos,(select count(*) from expedicoes) expedicoes",
      );
      await actor(1);
      return r[0];
    };
    await actor(1);
    const before = await effectCounts();
    const p = await create();
    assert.equal(p.tipo_documento, "orcamento");
    assert.equal(p.representante_id, id(20));
    assert.equal(p.status, "rascunho");
    const decide = (acao, motivo = null) =>
      q("select * from decidir_orcamento_236($1,$2,$3)", [p.id, acao, motivo]);
    await denied(decide("aceitar"), /Inclua os itens/);
    const item = (
      await q("select * from adicionar_item_pedido($1,$2,100,10,0)", [p.id, id(80)])
    )[0];
    await q("select atualizar_item_pedido($1,120,10,0)", [item.id]);
    assert.deepEqual(await effectCounts(), before);
    for (const name of ["confirmar_pedido", "cancelar_pedido"])
      await denied(q(`select ${name}($1)`, [p.id]), /ações de orçamento/);
    await denied(q("select avancar_pedido($1,'aprovado')", [p.id]), /ações de orçamento/);
    await denied(create(41), /carteira/);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','gestor')`);
    await actor(1);
    await denied(create(41), /carteira/);
    await d.exec("reset role");
    await d.exec(`delete from user_roles where user_id='${id(1)}' and role='gestor'`);
    await actor(2);
    await denied(
      q("select revisar_orcamento_236($1,current_date+30,'Outra carteira')", [p.id]),
      /sem acesso/,
    );
    await actor(1);
    await denied(decide("recusar"), /motivo/);
    await decide("recusar", "Cliente adiou a compra");
    await denied(q("select atualizar_item_pedido($1,1,10,0)", [item.id]), /Revise/);
    await denied(decide("aceitar"), /encerrado/);
    await q("select revisar_orcamento_236($1,current_date+30,'Nova proposta')", [p.id]);
    // Simulate an old proposal that expires before the client decides.
    await d.exec("reset role");
    await q(
      "update pedidos set orcamento_data=current_date-20,data_pedido=current_date-20,orcamento_validade=current_date-1 where id=$1",
      [p.id],
    );
    await actor(1);
    await denied(decide("aceitar"), /vencido/);
    await denied(q("select atualizar_item_pedido($1,1,10,0)", [item.id]), /Revise/);
    await q("select revisar_orcamento_236($1,current_date+30,'Revalidado')", [p.id]);
    assert.deepEqual(await effectCounts(), before);
    const converted = (await decide("aceitar"))[0];
    assert.equal(converted.id, p.id);
    assert.equal(converted.numero, p.numero);
    assert.equal(converted.status, "aguardando_aprovacao");
    assert.equal(converted.tipo_documento, "pedido");
    assert.equal(converted.orcamento_situacao, "aceito");
    assert(converted.orcamento_aceito_em);
    const today = (await q("select (now() at time zone 'America/Sao_Paulo')::date::text dia"))[0]
      .dia;
    assert.equal(new Date(converted.data_pedido).toISOString().slice(0, 10), today);
    assert.notEqual(
      new Date(converted.orcamento_data).toISOString(),
      new Date(converted.data_pedido).toISOString(),
    );
    await decide("aceitar");
    assert.deepEqual(await effectCounts(), before);
    // Actual approval/reservation motor still blocks insufficient stock after quote acceptance.
    await actor(3);
    await denied(q("select avancar_pedido($1,'aprovado')", [p.id]), /Estoque|estoque|insuficiente/);
    await d.exec("reset role");
    await d.exec("update estoque_saldos set quantidade=1000");
    await actor(3);
    await q("select avancar_pedido($1,'aprovado')", [p.id]);
    assert.equal(
      Number(
        (await q("select quantidade from estoque_reservas where pedido_id=$1", [p.id]))[0]
          .quantidade,
      ),
      120,
    );
    await q("select confirmar_pedido($1)", [p.id]);
    assert.equal(
      (await q("select status from pedidos where id=$1", [p.id]))[0].status,
      "confirmado",
    );
    await d.exec("reset role");
    const titles = await q(
      "select vencimento::text d from contas_receber where pedido_id=$1 order by parcela",
      [p.id],
    );
    assert.equal(titles.length, 2);
    assert.equal((await q("select count(*) n from estoque_movimentos"))[0].n, 1);
    assert.equal((await q("select count(*) n from estoque_reservas"))[0].n, 0);
    await actor(1);
    const other = await create();
    // Direct linked effects are blocked even through a security-definer caller.
    await d.exec("reset role");
    await d.query("select set_config('test.actor',$1,false)", [id(1)]);
    await denied(
      q("insert into contas_receber(pedido_id,valor) values($1,100)", [other.id]),
      /Orçamento não gera/,
    );
    await denied(
      q("insert into estoque_movimentos(origem,documento_id,quantidade) values('pedido',$1,1)", [
        other.id,
      ]),
      /Orçamento não gera/,
    );
    for (const command of [
      "insert into estoque_reservas(pedido_id,produto_id,centro_id,quantidade) values($1,'" +
        id(80) +
        "','" +
        id(10) +
        "',1)",
      "insert into comissoes(pedido_id,valor) values($1,1)",
      "insert into creditos_clientes_aplicacoes(pedido_id,status,valor) values($1,'reservado',1)",
      "insert into expedicoes(id,pedido_id,status) values(gen_random_uuid(),$1,'pendente')",
      "insert into carga_pedidos(pedido_id) values($1)",
    ])
      await denied(q(command, [other.id]), /Orçamento não gera/);
    await d.exec(
      "delete from role_permissoes where role='representante' and permissao='pedidos_orcamentos'",
    );
    await d.exec(sql);
    await actor(1);
    await denied(create(), /não liberada/);
    const resumo = (await q("select acompanhar_pedido_236($1) r", [other.id]))[0].r;
    assert.equal(resumo.tipo_documento, "orcamento");
    assert.equal(resumo.orcamento_situacao, "negociacao");
    await actor(5);
    await denied(
      q("select revisar_orcamento_236($1,current_date+1,null)", [other.id]),
      /sem acesso/,
    );
    await d.exec("reset role;set role anon");
    await denied(
      q("select decidir_orcamento_236($1,'aceitar',null)", [other.id]),
      /permission denied/,
    );
    console.log(
      "OK orçamentos236: criação/edição reais81, sem reserva/estoque/títulos/comissão/crédito/entrega antes do aceite, validade/revisão/recusa, conversão atômica e idempotente no mesmo documento, data comercial atualizada, aprovação/reserva reais42/212 e confirmação80/209/227 preservadas, carteira e revogação/anon. Recalculo e escrita de estoque são fixtures controladas.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
