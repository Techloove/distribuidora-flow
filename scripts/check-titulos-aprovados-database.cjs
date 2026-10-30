// PGlite descartável: títulos pendentes não entram em crédito ou atraso.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const scalar = async (q, p = []) => Object.values((await db.query(q, p)).rows[0])[0];
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select true$$;
create function escopo_representante() returns boolean language sql as $$select false$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select true$$;
create function pode_rotina(text) returns boolean language sql as $$select true$$;
create function vencimento_util(date) returns date language sql as $$select $1$$;`);
    await db.exec(fs.readFileSync("scripts/fixtures/titulos-aprovados-299.sql", "utf8"));
    // Os dois modos de execução usados por indicadores preservam o escopo original.
    await db.exec(`create function dashboard_financeiro() returns numeric language sql stable security invoker as $$select sum(valor) from public.contas_receber$$;
create function validar_pedido(uuid) returns numeric language sql stable security definer set search_path=public as $$select sum(valor) from public.contas_receber$$;
insert into clientes(id,razao_social,limite_credito) values('${id(20)}','Cliente teste',5000);
insert into centros(id,nome) values('${id(10)}','Cimento');
insert into pedidos(id,tipo_documento,status,centro_id) values('${id(30)}','pedido','rascunho','${id(10)}'),('${id(31)}','pedido','confirmado','${id(10)}'),('${id(32)}','orcamento','rascunho','${id(10)}');
insert into contas_receber(id,cliente_id,pedido_id,centro_id,valor,valor_pago,juros,multa,acrescimo,desconto,status,vencimento) values
('${id(40)}','${id(20)}','${id(30)}','${id(10)}',900,0,0,0,0,0,'aberto',current_date-5),
('${id(41)}','${id(20)}','${id(31)}','${id(10)}',100,0,0,0,0,0,'aberto',current_date-5),
('${id(42)}','${id(20)}',null,'${id(10)}',50,0,0,0,0,0,'aberto',current_date-5),
('${id(43)}','${id(20)}','${id(32)}','${id(10)}',800,0,0,0,0,0,'aberto',current_date-5);
grant usage on schema public to authenticated;grant select on all tables in schema public to authenticated;`);
    const antes = await scalar("select jsonb_agg(to_jsonb(cr) order by id) from contas_receber cr");
    const mig = fs.readFileSync("db/fase299_titulos_vendas_aprovadas.sql", "utf8");
    await db.exec(mig);
    await db.exec(mig);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(cr) order by id) from contas_receber cr"),
      antes,
    );
    assert.equal(Number(await scalar("select vencido from vw_cliente_credito")), 150);
    assert.equal(Number(await scalar("select dashboard_financeiro()")), 150);
    assert.equal(Number(await scalar("select validar_pedido(null)")), 150);
    assert.equal(
      Number(await scalar("select count(*) from vw_titulos_receber")),
      4,
      "Histórico preservado",
    );
    assert.equal(
      Number(
        await scalar("select count(*) from vw_titulos_receber where status_efetivo='vencido'"),
      ),
      2,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from vw_cliente_titulos where status_efetivo='venda_nao_aprovada'",
        ),
      ),
      2,
    );
    assert.equal(Number(await scalar("select sum(entradas) from vw_fluxo_previsto")), 150);
    assert.equal(Number(await scalar("select sum(previsto_entrada) from vw_fluxo_caixa")), 150);
    await db.exec(`update pedidos set status='aprovado' where id='${id(30)}'`);
    assert.equal(
      Number(await scalar("select vencido from vw_cliente_credito")),
      1050,
      "Aprovação passa a considerar a venda",
    );
    await db.exec("set role authenticated");
    assert.equal(Number(await scalar("select count(*) from vw_contas_receber_efetivas_299")), 3);
    await assert.rejects(
      () => db.exec("select * from contas_receber_efetivas_internas_299"),
      /permission denied/,
    );
    await db.exec("reset role;set test.ativo='false'");
    assert.equal(Number(await scalar("select count(*) from vw_contas_receber_efetivas_299")), 0);
    console.log(
      "OK: atraso/crédito/previsão só após aprovação; títulos manuais e dívidas aprovadas preservados; histórico sem alterações; migração idempotente e acesso interno protegido.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery ?? "");
  process.exit(1);
});
