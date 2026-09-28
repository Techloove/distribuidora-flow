import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("migrations enforce profile, role, center and representative boundaries; aggregate over 1000 orders", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; grant usage on schema auth, public to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create type public.app_role as enum ('admin','gestor','financeiro','comercial','representante','estoque','expedicao');
      create table profiles(id uuid primary key, nome text, telefone text, email text, empresa_id uuid, ativo boolean default true, todos_centros boolean default true, updated_at timestamptz);
      create table user_roles(user_id uuid, role app_role, unique(user_id,role));
      create table centros(id uuid primary key, nome text);
      create table usuario_centros(user_id uuid, centro_id uuid);
      create table pessoas(id uuid primary key, representante_id uuid, nome text);
      create table pedidos(id uuid primary key, centro_id uuid, representante_id uuid, data_pedido date, status text, total_liquido numeric);
      create table clientes(id uuid primary key);
      create table produtos(id uuid primary key, descricao text, estoque_atual numeric, estoque_minimo numeric);
      create table contas_receber(id uuid primary key, centro_id uuid, valor numeric, juros numeric default 0, multa numeric default 0, acrescimo numeric default 0, desconto numeric default 0, valor_pago numeric default 0, status text, vencimento date);
      create table contas_pagar(like contas_receber including all);
      create table boletos(id uuid primary key, conta_receber_id uuid, centro_id uuid, valor numeric, status text, valor_liquidado numeric, data_liquidacao date);
      create table comissoes(id uuid primary key, pedido_id uuid, valor numeric, status text);
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb, email text);
      create function escopo_representante() returns boolean language sql stable as $$ select auth.uid() = '00000000-0000-0000-0000-000000000002'::uuid $$;
      create function meu_representante_id() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000002'::uuid $$;
      create function unsafe_legacy() returns int language sql security definer as $$ select 1 $$;
      create view teste_pedidos as select * from pedidos;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      do $$ declare t text; begin foreach t in array array['profiles','user_roles','centros','usuario_centros','pessoas','pedidos','clientes','produtos','contas_receber','contas_pagar','comissoes'] loop
        execute format('alter table %I enable row level security',t);
        execute format('create policy legacy on %I for all to authenticated using (true) with check (true)',t);
      end loop; end $$;
      insert into profiles(id,nome,ativo,todos_centros) values
      ('00000000-0000-0000-0000-000000000001','Admin',true,true),
      ('00000000-0000-0000-0000-000000000002','Representante',true,false),
      ('00000000-0000-0000-0000-000000000003','Inativo',false,true);
      insert into user_roles values ('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','representante'),('00000000-0000-0000-0000-000000000003','admin');
      insert into centros values ('10000000-0000-0000-0000-000000000001','A'),('10000000-0000-0000-0000-000000000002','B');
      insert into usuario_centros values ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
      insert into pessoas values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Próprio'),('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Outro');
      insert into pedidos select md5(i::text)::uuid,'10000000-0000-0000-0000-000000000001',null,current_date,'entregue',10 from generate_series(1,1005) i;
      insert into pedidos values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',null,current_date,'entregue',999);
      insert into contas_receber values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,10,5,2,3,20,'parcial',current_date-1);
    `);
    for (const file of [
      "fase79_seguranca_acesso.sql",
      "fase80_dashboard_resumo.sql",
      "fase81_liquidacao_boleto.sql",
    ]) {
      const sql = await readFile(new URL("../db/" + file, import.meta.url), "utf8");
      await db.exec(sql);
      await db.exec(sql); // Reapplying preserves state.
    }
    await db.exec(`create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
      insert into auth.users values ('00000000-0000-0000-0000-000000000004','{"nome":"Novo"}','novo@example.test');`);
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from user_roles where user_id='00000000-0000-0000-0000-000000000004'`,
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          `select todos_centros from profiles where id='00000000-0000-0000-0000-000000000004'`,
        )
      ).rows[0].todos_centros,
      false,
    );
    assert.equal(
      (await db.query(`select has_function_privilege('anon','unsafe_legacy()','EXECUTE') ok`))
        .rows[0].ok,
      false,
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);`,
    );
    await assert.rejects(
      db.exec(`update profiles set todos_centros=true where id=auth.uid()`),
      /Somente administradores/,
    );
    await db.exec(`update profiles set nome='Nome novo' where id=auth.uid()`);
    assert.equal((await db.query(`select count(*)::int n from pessoas`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n from pedidos`)).rows[0].n, 1005);
    await assert.rejects(
      db.exec(
        `update pessoas set nome='Ataque' where id='20000000-0000-0000-0000-000000000001'; update pessoas set representante_id='00000000-0000-0000-0000-000000000001' where id='20000000-0000-0000-0000-000000000001'`,
      ),
      /row-level security/,
    );
    const summary = (
      await db.query(`select dashboard_resumo('10000000-0000-0000-0000-000000000001') x`)
    ).rows[0].x;
    assert.equal(summary.vendasConfirmadas, 10050);
    assert.equal(summary.receber, 94);
    await assert.rejects(
      db.query(`select dashboard_resumo('10000000-0000-0000-0000-000000000002')`),
      /Centro nao autorizado/,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false)`,
    );
    assert.equal((await db.query(`select count(*)::int n from pedidos`)).rows[0].n, 0);
    assert.equal((await db.query(`select has_role(auth.uid(),'admin') ok`)).rows[0].ok, false);
    await assert.rejects(db.query(`select dashboard_resumo(null)`), /Acesso nao autorizado/);
    await db.exec(`reset role;
      alter table contas_receber add column data_pagamento date;
      insert into boletos values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',50,'registrado',0,null);
      set role authenticated;
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);`);
    await assert.rejects(
      db.query(`select liquidar_boleto('50000000-0000-0000-0000-000000000001',50)`),
      /Sem permissao/,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`,
    );
    await assert.rejects(
      db.query(`select liquidar_boleto('50000000-0000-0000-0000-000000000001',0)`),
      /Valor invalido/,
    );
    await db.query(`select liquidar_boleto('50000000-0000-0000-0000-000000000001',50)`);
    await db.query(`select liquidar_boleto('50000000-0000-0000-0000-000000000001',50)`);
    assert.equal(
      Number(
        (
          await db.query(
            `select valor_pago from contas_receber where id='40000000-0000-0000-0000-000000000001'`,
          )
        ).rows[0].valor_pago,
      ),
      70,
    );
  } finally {
    await db.close();
  }
});
