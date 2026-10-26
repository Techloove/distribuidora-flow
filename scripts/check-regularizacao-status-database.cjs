const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='America/Sao_Paulo';create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
 create function has_role(uuid,text) returns boolean language sql as $$select $2='admin' and current_setting('test.admin',true)='true'$$;
 create function usuario_ativo() returns boolean language sql as $$select current_setting('test.ativo',true)='true'$$;
 create function pode_rotina(text) returns boolean language sql as $$select current_setting('test.menu',true)='true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(2)}'::uuid$$;
 create function escopo_representante() returns boolean language sql as $$select current_setting('test.carteira',true)='true'$$;
 create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select false$$;
 create table profiles(id uuid primary key,ativo boolean,precisa_completar_cadastro boolean);insert into profiles values('${id(1)}',true,false);
 create table pedidos(id uuid primary key,numero int,centro_id uuid,status text,data_pedido date,data_entrega date,tipo_documento text default 'pedido',faturado_em timestamptz,total_liquido numeric default 100);
 create table pedido_itens(id uuid primary key,pedido_id uuid,quantidade numeric default 10,conferido boolean default false);
 create table entrega_itens(pedido_item_id uuid);
 create table expedicoes(id uuid primary key,pedido_id uuid,centro_id uuid,status text,data_saida date,data_entrega date);
 create table contas_receber(id int,valor numeric);insert into contas_receber values(1,100);
 create table estoque_movimentos(id int,quantidade numeric);insert into estoque_movimentos values(1,-10);
 create table comissoes(id int,valor numeric);insert into comissoes values(1,5);
 create table notas_saida(id int,status text);insert into notas_saida values(1,'pendente');
 create table cargas(id int,status text);insert into cargas values(1,'em_rota');
 create table pedido_separacoes(id int,status text);insert into pedido_separacoes values(1,'em_separacao');
 create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
 create table pedido_status_historico(pedido_id uuid,status_anterior text,status_novo text,observacao text,user_id uuid,created_at timestamptz default now());
 create table chamadas_comissao(n int);insert into chamadas_comissao values(0);
 create function apurar_comissao_pedido(uuid) returns void language sql as $$update chamadas_comissao set n=n+1$$;
 create function acompanhar_pedido_236(_pedido uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare p pedidos;begin select * into p from pedidos where id=_pedido;if not usuario_ativo() or not pode_rotina('pedidos_acompanhar') or not usuario_pode_acessar_centro(p.centro_id) or (escopo_representante() and not documento_na_minha_carteira('pedidos',p.id)) then raise exception 'sem acesso';end if;return jsonb_build_object('status',p.status);end$$;
 insert into pedidos(id,numero,centro_id,status,data_pedido) values('${id(3)}',123,'${id(2)}','separacao',current_date-30),('${id(4)}',124,'${id(9)}','separado',current_date-30),('${id(5)}',125,'${id(2)}','faturado',current_date-30);
 insert into expedicoes values('${id(30)}','${id(3)}','${id(2)}','pendente',null,null);
 insert into pedido_itens(id,pedido_id) values('${id(6)}','${id(3)}');
 set test.admin='true';set test.ativo='true';set test.menu='true';set test.carteira='false';
 `);
    const fn = async (file, name) => {
      const s = fs.readFileSync("db/" + file, "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert.ok(a >= 0);
      await db.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    for (const [f, n] of [
      ["fase19_sincronizacao_status.sql", "sync_status_ativo"],
      ["fase42_fluxo_operacional.sql", "sync_expedicao_do_pedido"],
      ["fase21_comissao_representante_logado.sql", "trg_apurar_comissao_pedido"],
      ["fase215_comissoes_e_rentabilidade.sql", "marcar_faturamento_215"],
      ["fase42_fluxo_operacional.sql", "trg_pedido_status_historico"],
      ["fase254_transicoes_expedicao_separacao.sql", "validar_expedicao_pedido"],
    ])
      await fn(f, n);
    await db.exec(
      `create trigger comissao after update of status on pedidos for each row execute function trg_apurar_comissao_pedido();create trigger sync_exp after update of status on pedidos for each row execute function sync_expedicao_do_pedido();create trigger marcar_fat before update of status on pedidos for each row execute function marcar_faturamento_215();create trigger hist after update of status on pedidos for each row execute function trg_pedido_status_historico();create trigger validar_exp before update on expedicoes for each row execute function validar_expedicao_pedido();`,
    );
    const sql = fs.readFileSync("db/fase269_regularizacao_status_pedidos.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const user = () => db.exec("set role authenticated"),
      owner = () => db.exec("reset role");
    const ajustar = (
      novo = "entregue",
      expected = "separacao",
      nota = id(3),
      motivo = "Entrega antiga conferida com o responsável",
      data = "2026-10-01",
    ) =>
      db.query("select regularizar_status_pedido_269($1,$2,$3,$4,$5)", [
        nota,
        expected,
        novo,
        motivo,
        data,
      ]);
    // Usa datas relativas para funcionar em qualquer dia de execução.
    const datas = (
      await db.query(
        "select (current_date-10)::text dia,(current_date+1)::text futuro,(current_date-40)::text antigo",
      )
    ).rows[0];
    const ok = (novo = "entregue", expected = "separacao", nota = id(3)) =>
      ajustar(novo, expected, nota, undefined, datas.dia);
    await user();
    await db.exec("set test.admin='false'");
    await assert.rejects(ok(), /administrador ativo/);
    await db.exec("set test.admin='true';set test.ativo='false'");
    await assert.rejects(ok(), /administrador ativo/);
    await db.exec("set test.ativo='true';set test.menu='false'");
    await assert.rejects(ok(), /menu/);
    await db.exec("set test.menu='true';set test.carteira='true'");
    await assert.rejects(ok(), /loja\/carteira/);
    await db.exec("set test.carteira='false'");
    await assert.rejects(ok("entregue", "separado", id(4)), /loja\/carteira/);
    await assert.rejects(ajustar("entregue", "separacao", id(3), "curto", datas.dia), /motivo/);
    for (const data of [datas.futuro, datas.antigo, null])
      await assert.rejects(ajustar("entregue", "separacao", id(3), undefined, data), /Data/);
    for (const dest of ["nf_emitida", "cancelado", "confirmado", "separacao", "parcial", null])
      await assert.rejects(ok(dest), /etapa posterior/);
    await assert.rejects(ok("entregue", "separado"), /status mudou/);
    await owner();
    await db.exec("update profiles set precisa_completar_cadastro=true");
    await user();
    await assert.rejects(ok(), /administrador ativo/);
    await owner();
    await db.exec(
      "update profiles set precisa_completar_cadastro=false;insert into entrega_itens values('" +
        id(6) +
        "')",
    );
    await user();
    await assert.rejects(ok(), /parcial ou recusa/);
    await owner();
    await db.exec("delete from entrega_itens");
    await db.exec("update pedidos set tipo_documento='orcamento' where id='" + id(3) + "'");
    await user();
    await assert.rejects(ok(), /Orçamento/);
    await owner();
    await db.exec("update pedidos set tipo_documento='pedido' where id='" + id(3) + "'");
    const snapshot = async () => {
      let r = {};
      for (const t of [
        "pedido_itens",
        "expedicoes",
        "contas_receber",
        "estoque_movimentos",
        "comissoes",
        "notas_saida",
        "cargas",
        "pedido_separacoes",
        "chamadas_comissao",
      ])
        r[t] = (await db.query("select * from " + t)).rows;
      return r;
    };
    const before = await snapshot();
    await user();
    await ok();
    await owner();
    assert.deepEqual(await snapshot(), before);
    const p = (await db.query("select * from pedidos where id=$1", [id(3)])).rows[0];
    assert.equal(p.status, "entregue");
    assert.equal(p.data_entrega.toISOString().slice(0, 10), datas.dia);
    assert.ok(p.status_regularizado_em);
    assert.equal(p.faturado_em, null);
    const hist = (await db.query("select * from pedido_status_historico")).rows;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].status_anterior, "separacao");
    assert.equal(hist[0].status_novo, "entregue");
    assert.match(hist[0].observacao, /Regularização administrativa/);
    assert.equal(
      (await db.query("select count(*)::int n from pedido_ajuste_contexto_269")).rows[0].n,
      0,
    );
    await user();
    await assert.rejects(ok(), /status mudou/);
    await assert.rejects(ok("em_rota", "entregue"), /etapa posterior/);
    const resumo = (await db.query("select acompanhar_pedido_269($1) r", [id(3)])).rows[0].r;
    assert.ok(resumo.status_regularizado_em);
    assert.equal(resumo.status_regularizado_data, datas.dia);
    await assert.rejects(db.query("select * from pedido_ajuste_contexto_269"), /permission denied/);
    await assert.rejects(
      db.query("select ajuste_status_manual_ativo_269($1)", [id(3)]),
      /permission denied/,
    );
    await owner();
    await db.exec("set role anon");
    await assert.rejects(ok(), /permission denied/);
    await owner();
    await db.exec("set role service_role");
    await assert.rejects(ok(), /permission denied/);
    await owner();
    // Controle: gatilhos normais continuam ativos fora da RPC, inclusive após reaplicar.
    await db.query("update pedidos set status='nf_emitida' where id=$1", [id(5)]);
    assert.equal((await db.query("select n from chamadas_comissao")).rows[0].n, 1);
    await user();
    await ok("faturado", "nf_emitida", id(5)).then(
      () => assert.fail("Não pode retroceder"),
      (e) => assert.match(e.message, /etapa posterior/),
    );
    await owner();
    await db.query(
      "insert into pedidos(id,numero,centro_id,status,data_pedido) values($1,126,$2,'conferido',current_date-30)",
      [id(7), id(2)],
    );
    await user();
    await ok("faturado", "conferido", id(7));
    await owner();
    const faturado = (
      await db.query("select faturado_em,status_regularizado_em from pedidos where id=$1", [id(7)])
    ).rows[0];
    assert.equal(faturado.faturado_em, null);
    assert.ok(faturado.status_regularizado_em);
    assert.equal((await db.query("select n from chamadas_comissao")).rows[0].n, 1);
    await db.query("update pedidos set status='em_rota' where id=$1", [id(7)]);
    assert.equal(
      (await db.query("select status_regularizado_em from pedidos where id=$1", [id(7)])).rows[0]
        .status_regularizado_em,
      null,
    );
    assert.equal((await db.query("select n from chamadas_comissao")).rows[0].n, 2);
    console.log(
      "Regularização269 OK: reaplicação, admin ativo, loja/carteira, datas, concorrência, somente avanço, bloqueio fiscal/parcial, histórico e ausência de efeitos operacionais; gatilhos normais preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
