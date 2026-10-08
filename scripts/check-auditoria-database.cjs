const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table contas_receber(id uuid primary key,centro_id uuid,valor numeric,valor_pago numeric default 0,juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0,status text,vencimento date);
 create table contas_pagar(like contas_receber including all);
 alter table contas_receber enable row level security; alter table contas_pagar enable row level security;
 create policy carteira on contas_receber to authenticated using(centro_id=auth.uid());
 create policy carteira on contas_pagar to authenticated using(centro_id=auth.uid());
 grant usage on schema auth,public to authenticated;grant select on contas_receber,contas_pagar to authenticated;
 create view vw_titulos_receber with(security_invoker=on) as select *,case when vencimento<CURRENT_DATE then 'vencido' else 'aberto' end as status_efetivo from contas_receber;
 create view vw_titulos_pagar with(security_invoker=on) as select *,case when vencimento<CURRENT_DATE then 'vencido' else 'aberto' end as status_efetivo from contas_pagar;
 grant select on vw_titulos_receber,vw_titulos_pagar to authenticated;
 insert into contas_receber(id,centro_id,valor,valor_pago,juros,multa,desconto,status,vencimento) values
 ('${id(10)}','${id(1)}',100,40,10,2,5,'parcial','2026-10-08'),
 ('${id(11)}','${id(2)}',300,0,0,0,0,'aberto','2026-10-08'),
 ('${id(12)}','${id(1)}',500,0,0,0,0,'cancelado','2026-10-08');
 insert into contas_pagar(id,centro_id,valor,valor_pago,status,vencimento) values('${id(13)}','${id(1)}',80,20,'parcial','2026-10-08');`);
    // Start from the original six-column view, preserving dependents when adding centro_id.
    const original = fs.readFileSync(
      path.join(root, "db/fase6_faturamento_fluxo_caixa.sql"),
      "utf8",
    );
    const a = original.indexOf("create or replace view public.vw_fluxo_caixa as");
    const b = original.indexOf("group by 1;", a) + 11;
    await db.exec(original.slice(a, b));
    await db.exec(
      "create view fluxo_dependente as select periodo,previsto_entrada from vw_fluxo_caixa;",
    );
    const migration = fs.readFileSync(
      path.join(root, "db/fase210_correcao_fluxo_caixa_centros.sql"),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    let r = await db.query(
      "select sum(previsto_entrada)::float as entrada,sum(realizado_entrada)::float as recebido,sum(previsto_saida)::float as saida from vw_fluxo_caixa",
    );
    assert.deepEqual(r.rows[0], { entrada: 367, recebido: 40, saida: 60 });
    assert.equal((await db.query("select count(*)::int as n from fluxo_dependente")).rows[0].n, 3);
    await db.exec(
      `select set_config('request.jwt.claim.sub','${id(1)}',false);set role authenticated;`,
    );
    r = await db.query(
      "select sum(previsto_entrada)::float as entrada,sum(realizado_entrada)::float as recebido,sum(previsto_saida)::float as saida from vw_fluxo_caixa",
    );
    assert.deepEqual(r.rows[0], { entrada: 67, recebido: 40, saida: 60 });
    assert.equal(
      (await db.query("select count(*)::int as n from vw_fluxo_caixa where centro_id=$1", [id(2)]))
        .rows[0].n,
      0,
    );
    await db.exec("reset role;");
    for (const name of ["vw_titulos_receber", "vw_titulos_pagar"]) {
      const def = (await db.query("select pg_get_viewdef($1::regclass,true) as def", [name]))
        .rows[0].def;
      assert.ok(def.includes("America/Sao_Paulo"));
      assert.ok(!def.includes("CURRENT_DATE"));
    }
    assert.equal(
      (await db.query("select has_table_privilege('anon','vw_fluxo_caixa','SELECT') as acesso"))
        .rows[0].acesso,
      false,
    );
    // Run the production diagnostic against a separate minimal schema shape: SELECT only.
    await db.exec(`create table pessoas(id uuid,cnpj_cpf text);
      create table representantes(id uuid,profile_id uuid);
      create table boletos(id uuid,conta_receber_id uuid,banco text,nosso_numero text,status text);
      create table pedidos(id uuid,centro_id uuid);create table compras(id uuid,centro_id uuid);
      create table produtos(id uuid primary key,estoque_atual numeric,permite_estoque_negativo boolean);
      create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);
      alter table contas_receber add column pedido_id uuid;alter table contas_receber add column parcela int;
      alter table contas_pagar add column compra_id uuid;alter table contas_pagar add column parcela int;`);
    // Exercise the existing purchase receipt with the real stock engine and recalculation.
    const loadFunction = async (file, name) => {
      const source = fs.readFileSync(path.join(root, "db", file), "utf8");
      const start = source.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0, name);
      await db.exec(source.slice(start, source.indexOf("$$;", start) + 3));
    };
    await db.exec(`alter table produtos add column descricao text, add column custo_medio numeric default 0;
      alter table produtos alter column estoque_atual set default 0;
      alter table estoque_saldos add column custo_medio numeric default 0, add column updated_at timestamptz;
      alter table estoque_saldos add primary key(produto_id,centro_id);
      alter table estoque_saldos alter column quantidade set default 0;
      create table estoque_movimentos(id uuid default gen_random_uuid(),produto_id uuid,centro_id uuid,tipo text,quantidade numeric,custo_unitario numeric,origem text,documento_id uuid,observacao text,created_by uuid);
      alter table compras add primary key(id);
      alter table compras add column fornecedor_id uuid,add column status text,add column numero int,add column nf_numero text,add column data_entrada date,add column parcelas int,add column total_liquido numeric,add column total_itens numeric,add column desconto_valor numeric default 0,add column frete_valor numeric default 0;
      create table compra_itens(compra_id uuid,produto_id uuid,quantidade numeric,custo_unitario numeric,total numeric);
      alter table contas_pagar alter column id set default gen_random_uuid();
      alter table contas_pagar add column fornecedor_id uuid,add column documento text,add column data_emissao date;
      create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
      create function can_stock(uuid) returns boolean language sql as $$select $1=auth.uid()$$;
      create function can_finance(uuid) returns boolean language sql as $$select $1=auth.uid()$$;
      create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1=auth.uid()$$;`);
    await loadFunction("fase55_estoque_por_centro.sql", "aplicar_movimento_estoque");
    await loadFunction("fase55_estoque_por_centro.sql", "validar_estoque_negativo");
    await loadFunction("fase2_vendas_estoque_financeiro.sql", "recalcular_compra");
    await loadFunction(
      "fase70_integridade_compras_financeiro.sql",
      "registrar_movimento_estoque_controlado",
    );
    await loadFunction("fase70_integridade_compras_financeiro.sql", "receber_compra");
    await db.exec(`create trigger aplicar after insert on estoque_movimentos for each row execute function aplicar_movimento_estoque();
      create trigger validar before insert on estoque_movimentos for each row execute function validar_estoque_negativo();
      insert into produtos(id,descricao,permite_estoque_negativo) values('${id(30)}','Produto teste',false);
      insert into compras(id,centro_id,status,numero,data_entrada,parcelas) values('${id(31)}','${id(1)}','comprado',1,'2026-10-08',3);
      insert into compra_itens values('${id(31)}','${id(30)}',10,10,100);
      select receber_compra('${id(31)}');select receber_compra('${id(31)}');`);
    assert.equal(
      (
        await db.query("select quantidade::float as n from estoque_saldos where produto_id=$1", [
          id(30),
        ])
      ).rows[0].n,
      10,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from estoque_movimentos")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n, sum(valor)::float as valor from contas_pagar where compra_id=$1",
          [id(31)],
        )
      ).rows[0].valor,
      100,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from contas_pagar where compra_id=$1", [id(31)]))
        .rows[0].n,
      3,
    );
    await assert.rejects(
      db.query("select registrar_movimento_estoque_controlado($1,$2,'saida',11,null,'manual')", [
        id(30),
        id(1),
      ]),
      /Estoque insuficiente/,
    );
    await assert.rejects(
      db.query("select registrar_movimento_estoque_controlado($1,$2,'entrada',2,10,'manual')", [
        id(30),
        id(2),
      ]),
      /sem acesso/,
    );
    assert.equal(
      (await db.query("select estoque_atual::float as n from produtos where id=$1", [id(30)]))
        .rows[0].n,
      10,
    );
    const antes = (await db.query("select count(*)::int as n from contas_receber")).rows[0].n;
    await db.exec(
      fs.readFileSync(path.join(root, "db/diagnostico_integridade_somente_leitura.sql"), "utf8"),
    );
    assert.equal(
      (await db.query("select count(*)::int as n from contas_receber")).rows[0].n,
      antes,
    );
    console.log(
      "Auditoria DB PASS: fluxo com encargos, dois centros, cancelados, RLS, anon bloqueado, dependências, calendário São Paulo, compra recebida sem duplicar estoque/parcelas, rollback por saldo insuficiente e reaplicação.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
