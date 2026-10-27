const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='America/Sao_Paulo';create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'${id(1)}')::uuid$$;
create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${id(1)}',true);
create function usuario_ativo() returns boolean language sql security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and ativo)$$;
create function can_finance(uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.routine',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select false$$;

create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo boolean);insert into contas_financeiras values('${id(20)}','${id(10)}',true),('${id(21)}','${id(11)}',true);
create table categorias_financeiras(id uuid primary key default gen_random_uuid(),nome text,tipo text,grupo_dre text,parent_id uuid,ativo boolean default true,padrao_para text,ordem integer);
create table contas_receber(id uuid primary key,status text,valor_pago numeric,pedido_id uuid);insert into contas_receber values('${id(30)}','pago',100,null);
create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,ambiente text,status text,nosso_numero text,valor numeric,valor_liquidado numeric);insert into boletos values('${id(40)}','${id(10)}','sicredi','api','producao','liquidado','600000007',100,100),('${id(41)}','${id(11)}','sicredi','api','producao','registrado','600000008',100,0);
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric,categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,status text default 'ativo',dre_ignorar boolean default false,conta_receber_id uuid);
insert into movimentos_financeiros(conta_id,data,tipo,origem,valor,centro_id) values('${id(20)}',current_date-7,'entrada','recebimento',100,'${id(10)}');
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create table sicredi_tarifas_api_280(boleto_id uuid,data_lancamento date,centro_id uuid,debitos jsonb,tarifa_total numeric,outros_debitos int,consultado_em timestamptz default now(),primary key(boleto_id,data_lancamento));
create table sicredi_tarifas_279(boleto_id uuid primary key,movimento_id uuid,centro_id uuid,conta_id uuid,categoria_id uuid,valor numeric,data_cobranca date);
create function registrar_tarifa_sicredi_279(uuid,numeric,date,uuid,text,boolean) returns void language plpgsql as $$declare b public.boletos;begin select * into b from boletos where id=$1 for update;if b.banco is distinct from 'sicredi' then raise exception 'Banco';end if;end$$;
grant usage on schema auth,public to authenticated;`);
    let source = fs.readFileSync(
      path.join(root, "db/fase71_perimetro_financeiro_centros.sql"),
      "utf8",
    );
    let start = source.indexOf("create or replace function public.lancar_movimento(");
    await db.exec(source.slice(start, source.indexOf("$$;", start) + 3));
    const sql = fs.readFileSync(
      path.join(root, "db/fase282_tarifas_automaticas_financeiro.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    // Usa a seleção financeira real da DRE, incluindo sinais, origem e estornos.
    source = fs.readFileSync(path.join(root, "db/fase46_dre_receita_competencia.sql"), "utf8");
    start = source.indexOf("create or replace view public.vw_dre_base as");
    await db.exec(source.slice(start, source.indexOf("union all", start)) + ";");
    const categoria = (
      await db.query(
        "select id from categorias_financeiras where nome='Tarifas de emissão de boletos'",
      )
    ).rows[0].id;
    const before = (await db.query("select * from boletos order by id")).rows,
      title = (await db.query("select * from contas_receber")).rows;
    const snap = async (
      b = id(40),
      valor = 1.63,
      days = 7,
      descricao = "TARIFA ENTRADA/LIQUIDACAO",
    ) =>
      db.query(
        `insert into sicredi_tarifas_api_280(boleto_id,centro_id,data_lancamento,debitos,tarifa_total,outros_debitos) select id,centro_id,current_date-$2::int,$3,$4,0 from boletos where id=$1 on conflict(boleto_id,data_lancamento) do update set debitos=excluded.debitos,tarifa_total=excluded.tarifa_total`,
        [b, days, JSON.stringify([{ descricao, valor }]), valor],
      );
    const cfg = (conta = id(20), cat = categoria, centro = id(10), ativo = true) =>
      db.query("select configurar_tarifas_sicredi_282($1,$2,$3,current_date-10,$4,true)", [
        centro,
        conta,
        cat,
        ativo,
      ]);
    const estado = async (b = id(40), days = 7) =>
      (
        await db.query(
          "select * from sicredi_tarifas_financeiro_282 where boleto_id=$1 and data_lancamento=current_date-$2::int",
          [b, days],
        )
      ).rows[0];
    await snap();
    assert.equal((await estado()).estado, "sem_configuracao");
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros where tipo='saida'"))
        .rows[0].n,
      0,
    );
    await assert.rejects(() => cfg(id(21)), /própria loja/);
    await assert.rejects(() => cfg(id(20), categoria, id(11)), /permissão/);
    await db.exec("set test.rep='true'");
    await assert.rejects(() => cfg(), /permissão/);
    await db.exec("set test.rep='false'");
    await cfg();
    let f = await estado();
    assert.equal(f.estado, "lancado");
    assert.equal(Number(f.valor_lancado), 1.63);
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(valor) v from vw_dre_base where grupo_dre='despesa_financeira'",
          )
        ).rows[0].v,
      ),
      -1.63,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(case when tipo='entrada' then valor else -valor end) saldo from movimentos_financeiros",
          )
        ).rows[0].saldo,
      ),
      98.37,
    );
    await snap();
    await cfg();
    assert.equal((await estado()).movimento_id, f.movimento_id);
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros where tipo='saida'"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      () =>
        db.query("select registrar_tarifa_sicredi_279($1,1.63,current_date,$2,$3,true)", [
          id(40),
          categoria,
          "extrato",
        ]),
      /retornada pela API/,
    );
    await snap(id(40), 2);
    assert.equal((await estado()).estado, "retorno_divergente");
    assert.equal((await estado()).valor_lancado, "1.63");
    await snap();
    await db.query("update movimentos_financeiros set status='estornado' where id=$1", [
      f.movimento_id,
    ]);
    await snap();
    assert.equal((await estado()).estado, "estornado");
    await db.query("delete from sicredi_tarifas_api_280 where boleto_id=$1", [id(40)]);
    assert.equal((await estado()).estado, "estornado");
    // Vínculo manual conhecido não duplica; tarifa de emissão funciona antes de pagamento.
    await db.exec(
      `insert into boletos select '${id(42)}',centro_id,banco,canal,ambiente,'registrado','600000009',100,0 from boletos where id='${id(40)}'`,
    );
    await db.query(
      "insert into movimentos_financeiros(id,conta_id,data,tipo,origem,valor,categoria_id,centro_id) values($1,$2,current_date-6,'saida','despesa',1.63,$3,$4)",
      [id(60), id(20), categoria, id(10)],
    );
    await db.query("insert into sicredi_tarifas_279 values($1,$2,$3,$4,$5,1.63,current_date-6)", [
      id(42),
      id(60),
      id(10),
      id(20),
      categoria,
    ]);
    await snap(id(42), 1.63, 6);
    assert.equal((await estado(id(42), 6)).estado, "vinculado_manual");
    assert.equal((await estado(id(42), 6)).movimento_id, id(60));
    // Falha de auditoria reverte despesa e vínculo, mas mantém retorno da API para conferência.
    await db.exec(
      `create function falhar() returns trigger language plpgsql as $$begin if new.acao='tarifa_api_financeiro_282' then raise exception 'Falha simulada';end if;return new;end$$;create trigger falhar before insert on auditoria for each row execute function falhar()`,
    );
    await snap(id(42), 1.1, 5);
    assert.equal((await estado(id(42), 5)).estado, "falha_financeira");
    assert.equal((await estado(id(42), 5)).movimento_id, null);
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros where valor=1.10"))
        .rows[0].n,
      0,
    );
    await db.exec("drop trigger falhar on auditoria");
    await snap(id(42), 1.1, 5);
    assert.equal((await estado(id(42), 5)).estado, "lancado");
    await snap(id(41), 2.63, 5);
    assert.equal((await estado(id(41), 5)).estado, "sem_configuracao");
    await db.exec("set test.routine='false'");
    await snap(id(42), 1.2, 4);
    assert.equal((await estado(id(42), 4)).estado, "responsavel_sem_acesso");
    await db.exec("set test.routine='true'");
    await snap(id(42), 5, 3, "OUTRO DEBITO");
    assert.equal(await estado(id(42), 3), undefined);

    // Despesa avulsa semelhante não é duplicada automaticamente.
    await db.query(
      "insert into movimentos_financeiros(conta_id,data,tipo,origem,valor,categoria_id,centro_id) values($1,current_date-4,'saida','despesa',1.20,$2,$3)",
      [id(20), categoria, id(10)],
    );
    await snap(id(42), 1.2, 4);
    assert.equal((await estado(id(42), 4)).estado, "conferir_preexistente");
    assert.equal((await estado(id(42), 4)).movimento_id, null);
    // Remoção do cache preserva a despesa; restauração não relança.
    const antigo = (await estado(id(42), 5)).movimento_id;
    await db.query(
      "delete from sicredi_tarifas_api_280 where boleto_id=$1 and data_lancamento=current_date-5",
      [id(42)],
    );
    assert.equal((await estado(id(42), 5)).estado, "retorno_ausente");
    await snap(id(42), 1.1, 5);
    assert.equal((await estado(id(42), 5)).movimento_id, antigo);
    await db.query("update categorias_financeiras set ativo=false where id=$1", [categoria]);
    await snap(id(42), 1.4, 2);
    assert.equal((await estado(id(42), 2)).estado, "configuracao_invalida");
    await db.query("update categorias_financeiras set ativo=true where id=$1", [categoria]);
    await cfg(id(20), categoria, id(10), false);
    await snap(id(42), 1.4, 2);
    assert.equal((await estado(id(42), 2)).estado, "pausado");
    await cfg();
    assert.equal((await estado(id(42), 2)).estado, "lancado");
    await db.query(
      "insert into categorias_financeiras(id,nome,tipo,grupo_dre) values($1,'Operacional','despesa','despesa_operacional')",
      [id(99)],
    );
    await assert.rejects(() => cfg(id(20), id(99)), /Despesas Financeiras/);
    assert.equal(
      (await db.query("select coalesce(current_setting('request.jwt.claim.sub',true),'') s"))
        .rows[0].s,
      "",
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select count(*)::int n from sicredi_tarifas_config_282")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from sicredi_tarifas_financeiro_282 where centro_id=$1",
          [id(11)],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      () => db.exec("delete from sicredi_tarifas_financeiro_282"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select sicredi_contabilizar_tarifa_282($1,current_date)", [id(40)]),
      /permission denied/,
    );
    await db.exec("reset role");
    await assert.rejects(
      () => db.query("delete from boletos where id=$1", [id(42)]),
      /foreign key/,
    ); // vínculos preservam o histórico.
    assert.deepEqual(
      (
        await db.query("select * from boletos where id=any($1::uuid[]) order by id", [
          [id(40), id(41)],
        ])
      ).rows,
      before,
    );
    assert.deepEqual((await db.query("select * from contas_receber")).rows, title);
    console.log(
      "Financeiro282 OK: 100 recebido/1,63 despesa/saldo98,37 e DRE financeiro -1,63; replay, manual, estorno/divergência, emissão antes de pagamento, rollback, loja/carteira/permissões e retorno preservado.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
