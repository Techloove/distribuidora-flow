const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    const fixture = fs.readFileSync(
        path.join(__dirname, "check-agenda-unificada-database.cjs"),
        "utf8",
      ),
      a = fixture.indexOf("`create role anon"),
      b = fixture.indexOf("`.replaceAll", a);
    await d.exec(
      fixture
        .slice(a + 1, b)
        .replace(/\$\{id\((\d+)\)\}/g, (_, n) => id(Number(n)))
        .replaceAll("select1", "select 1"),
    );
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert(a >= 0);
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await d.exec(`create role service_role;
 create function can_stock(uuid) returns boolean language sql stable security definer set search_path=public as $$select can_manage($1) or has_role($1,'comercial')$$;
 create table fornecedores(id uuid primary key,cnpj_cpf text);
 create table formas_pagamento(id uuid primary key,ativo boolean);
 create table produtos(id uuid primary key);
 create table compras(id uuid primary key default gen_random_uuid(),numero int generated always as identity,fornecedor_id uuid,centro_id uuid,data_entrada date,observacoes text,nf_numero text,chave_acesso text,valor_impostos numeric,status text,forma_pagamento_id uuid,frete_valor numeric default 0,desconto_valor numeric default 0,total_liquido numeric default 0);
 create table compra_itens(id uuid primary key default gen_random_uuid(),compra_id uuid,produto_id uuid,quantidade numeric,custo_unitario numeric,lote text,validade date);
 create table contas_pagar(compra_id uuid,status text);
 create function recalcular_compra(uuid) returns void language sql security definer set search_path=public as $$update compras set total_liquido=coalesce((select sum(quantidade*custo_unitario) from compra_itens where compra_id=$1),0)+coalesce(frete_valor,0)-coalesce(desconto_valor,0) where id=$1$$;
 -- Sentinel receiver: this test checks the added access guard, not the unchanged receiving motor.
 create function receber_compra(uuid) returns void language plpgsql security definer set search_path=public as $$begin raise exception 'motor_recebimento_preservado'; end$$;
 grant execute on function receber_compra(uuid) to authenticated;
 create view vw_sugestao_compras_centro with(security_invoker=on) as select 1 as sugestao;
 create view vw_reposicao_209 with(security_invoker=on) as select 1 as compra_recomendada where pode_rotina('reposicao_ver');
 grant select on vw_sugestao_compras_centro,vw_reposicao_209 to authenticated;
 create function relatorio_vendas_filtros_230() returns jsonb language sql as $$select '{}'::jsonb$$;
 insert into role_menus values('financeiro','/compras'),('comercial','/planejamento-compras'),('representante','/compras'),('representante','/planejamento-compras');
 insert into permissoes values('reposicao_ver','Reposição','Compras',102,'/planejamento-compras'),('compra_xml_importar','XML','Compras',127,'/compras');
 insert into role_permissoes values('financeiro','reposicao_ver'),('comercial','reposicao_ver'),('representante','reposicao_ver'),('comercial','compra_xml_importar'),('financeiro','compra_xml_importar');
 insert into profiles(id,nome) values('${id(6)}','Planejador');insert into user_roles values('${id(6)}','comercial');
 insert into fornecedores values('${id(70)}','12345678000195');insert into produtos values('${id(71)}');
 `);
    await d.exec(
      fs.readFileSync(path.join(root, "db/fase109_crud_controlado_compras.sql"), "utf8"),
    );
    await d.exec(
      fs.readFileSync(path.join(root, "db/fase111_hardening_compra_comprada.sql"), "utf8"),
    );
    await fn("fase218_compras_xml.sql", "importar_compra_xml_218");
    await d.exec(
      "revoke all on function importar_compra_xml_218(uuid,uuid,jsonb,jsonb) from public,anon; grant execute on function importar_compra_xml_218(uuid,uuid,jsonb,jsonb) to authenticated",
    );
    const sql = fs.readFileSync(path.join(root, "db/fase231_compras_unificadas.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
    const denied = async (f, re) => {
      let e;
      try {
        await f();
      } catch (err) {
        e = err;
      }
      assert(e, "Expected denial");
      if (re) assert.match(e.message, re);
    };
    const criar = () => q("select * from criar_compra_rascunho($1,$2)", [id(70), id(10)]);
    await actor(6);
    assert.equal((await q("select pode_rotina('compras_planejar') ok"))[0].ok, true);
    assert.equal((await q("select pode_rotina('compras_operar') ok"))[0].ok, false);
    assert.equal((await q("select * from vw_sugestao_compras_centro")).length, 1);
    assert.equal((await q("select * from vw_reposicao_209")).length, 1);
    await denied(criar, /não liberada/);
    await denied(() => q("select receber_compra($1)", [id(90)]), /não liberada/);
    await denied(
      () => q("select importar_compra_xml_218($1,$2,'{}','[]')", [id(70), id(10)]),
      /não liberada/,
    );
    await actor(4);
    assert.equal((await q("select pode_rotina('compras_operar') ok"))[0].ok, true);
    assert.equal((await q("select pode_rotina('compras_planejar') ok"))[0].ok, false);
    assert.equal((await q("select * from vw_sugestao_compras_centro")).length, 0);
    assert.equal((await q("select * from vw_reposicao_209")).length, 0);
    const compra = (await criar())[0];
    const item = (
      await q("select * from adicionar_item_compra($1,$2,2,5)", [compra.id, id(71)])
    )[0];
    await q("select atualizar_item_compra($1,3,6)", [item.id]);
    await q("select atualizar_compra_comercial($1,null,2,1)", [compra.id]);
    assert.equal(
      Number(
        (await q("select total_liquido from compras where id=$1", [compra.id]))[0].total_liquido,
      ),
      19,
    );
    await denied(() => q("select receber_compra($1)", [compra.id]), /motor_recebimento_preservado/);
    await denied(() => q("select criar_compra_rascunho($1,$2)", [id(70), id(11)]), /Centro/);
    await q("select marcar_compra_comprada($1)", [compra.id]);
    await denied(() => q("select adicionar_item_compra($1,$2,1,2)", [compra.id, id(71)]), /status/);
    await q("select cancelar_compra($1)", [compra.id]);
    assert.equal(
      (await q("select status from compras where id=$1", [compra.id]))[0].status,
      "cancelada",
    );
    const outra = (await criar())[0],
      it2 = (await q("select * from adicionar_item_compra($1,$2,1,5)", [outra.id, id(71)]))[0];
    await q("select remover_item_compra($1)", [it2.id]);
    assert.equal((await q("select * from compra_itens where id=$1", [it2.id])).length, 0);
    await actor(3);
    assert.equal((await q("select * from vw_sugestao_compras_centro")).length, 1);
    await q(
      "select admin_salvar_acesso('comercial',array['/planejamento-compras','/relatorios'],array['compras_planejar'])",
    );
    await d.exec("reset role");
    assert.deepEqual(
      (await q("select path from role_menus where role='comercial' order by path")).map(
        (r) => r.path,
      ),
      ["/compras", "/relatorio-vendas"],
    );
    await d.exec(
      "delete from role_permissoes where role='financeiro' and permissao='compras_operar'",
    );
    await d.exec(sql);
    await actor(4);
    await denied(criar, /não liberada/);
    await denied(() => q("select atualizar_compra_comercial($1)", [outra.id]), /não liberada/);
    await denied(() => q("select remover_item_compra($1)", [item.id]), /não liberada/);
    await actor(1);
    assert.equal((await q("select pode_rotina('compras_operar') ok"))[0].ok, true);
    assert.equal((await q("select pode_rotina('compras_planejar') ok"))[0].ok, true);
    await d.exec("reset role");
    await d.exec(`update profiles set ativo=false where id='${id(1)}'`);
    await actor(1);
    await denied(criar, /não liberada/);
    assert.equal((await q("select * from vw_sugestao_compras_centro")).length, 0);
    await d.exec("reset role;set role anon");
    await denied(criar, /permission denied/);
    console.log(
      "OK compras231: migração idempotente, acessos planejamento/operação separados, CRUD109 e comprado111 preservados, motor de recebimento protegido, XML, views, centros, revogações, aliases no editor, inatividade e anonimato.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
