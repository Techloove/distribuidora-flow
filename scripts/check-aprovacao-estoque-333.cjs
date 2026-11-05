const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
create table pedidos(id uuid primary key,status text);
create table efeitos(tipo text);
create function escopo_representante() returns boolean language sql stable as $$select current_setting('test.rep',true)='true'$$;
create function alertas_estoque_pedido_332(uuid) returns table(insuficiente boolean) language sql stable as $$select current_setting('test.falta',true)='true'$$;
create function confirmar_pedido(_pedido_id uuid) returns pedidos language plpgsql security definer set search_path=public as $$declare ped pedidos;begin
select * into ped from public.pedidos where id = _pedido_id for update;
insert into efeitos values('estoque'),('financeiro'),('comissao');
update pedidos set status='confirmado' where id=_pedido_id returning * into ped;return ped;end $$;
create function avancar_pedido(_pedido_id uuid,_novo_status text) returns pedidos language plpgsql security definer set search_path=public as $$declare ped pedidos;begin
select * into ped from public.pedidos where id = _pedido_id for update;
update pedidos set status=_novo_status where id=_pedido_id returning * into ped;return ped;end $$;
insert into pedidos values('00000000-0000-4000-8000-000000000094','rascunho');
select set_config('test.rep','true',false),set_config('test.falta','true',false);`);
    const m = fs.readFileSync("db/fase333_aprovacao_estoque_representante.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    const q = (s) => db.query(s);
    const pid = "'00000000-0000-4000-8000-000000000094'";
    await assert.rejects(() => q(`select confirmar_pedido(${pid})`), /Estoque insuficiente/);
    assert.equal((await q("select * from efeitos")).rows.length, 0);
    await q(`select avancar_pedido(${pid},'aguardando_aprovacao')`);
    await assert.rejects(
      () => q(`select avancar_pedido(${pid},'aprovado')`),
      /decisão cabe à gestão/,
    );
    await assert.rejects(() => q(`update pedidos set status='aprovado'`), /decisão cabe à gestão/);
    await q("select set_config('test.rep','false',false)");
    await q(`select avancar_pedido(${pid},'aprovado')`);
    await q("select set_config('test.rep','true',false)");
    await assert.rejects(() => q(`select confirmar_pedido(${pid})`), /Estoque insuficiente/);
    await q("select set_config('test.falta','false',false)");
    await q(`select confirmar_pedido(${pid})`);
    assert.equal((await q("select * from efeitos")).rows.length, 3);
    await db.exec(
      "truncate efeitos;select set_config('test.rep','false',false),set_config('test.falta','true',false)",
    );
    await q(`select confirmar_pedido(${pid})`);
    assert.equal((await q("select * from efeitos")).rows.length, 3);
    console.log(
      "Fase333 OK: representante sem estoque bloqueado antes dos efeitos; envio permitido; aprovação protegida; admin e estoque suficiente preservados; instalação idempotente.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
