const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
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
    for (const name of [
      "escopo_representante",
      "cliente_na_minha_carteira",
      "documento_na_minha_carteira",
    ])
      await fn("fase206_carteira_representante.sql", name);
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await d.exec(`
 alter table pedidos add column numero int,add column representante_id uuid,add column data_entrega date;
 create table expedicoes(id uuid primary key,pedido_id uuid,centro_id uuid,status text,data_saida date,previsao_entrega date,data_entrega date,created_at timestamptz default now());
 create table entrega_registros(id uuid primary key,expedicao_id uuid,pedido_id uuid,centro_id uuid,tipo text,recebedor text,data_entrega date,created_at timestamptz default now(),comprovante text,arquivo_path text);
 create table entrega_itens(registro_id uuid);
 create table cargas(id uuid primary key,numero int,centro_id uuid,status text);
 create table carga_pedidos(carga_id uuid,pedido_id uuid);
 create function despachar_carga_233(uuid,date) returns void language sql as $$select null::void$$;
 insert into permissoes values('entrega_registrar','Entrega','Entregas',105,'/entregas');
 insert into role_menus values('representante','/pedidos'),('financeiro','/pedidos');
 delete from pedidos;
 insert into pedidos(id,numero,cliente_id,representante_id,centro_id,status,data_pedido,data_entrega) values
 ('${id(100)}',1,'${id(40)}','${id(20)}','${id(10)}','entregue','2026-10-15','2026-10-16'),
 ('${id(101)}',2,'${id(41)}','${id(21)}','${id(10)}','entregue','2026-10-15','2026-10-16'),
 ('${id(102)}',3,'${id(40)}','${id(20)}','${id(11)}','entregue','2026-10-15','2026-10-16'),
 ('${id(103)}',4,'${id(40)}','${id(21)}','${id(10)}','entregue','2026-10-15','2026-10-16'),
 ('${id(104)}',5,'${id(41)}','${id(20)}','${id(10)}','entregue','2026-10-15','2026-10-16'),
 ('${id(105)}',6,'${id(40)}','${id(20)}','${id(10)}','confirmado','2026-10-15',null);
 insert into expedicoes(id,pedido_id,centro_id,status,data_saida,previsao_entrega,data_entrega) select id,id,centro_id,'entregue','2026-10-15','2026-10-17','2026-10-16' from pedidos where numero<6;
 insert into entrega_registros(id,expedicao_id,pedido_id,centro_id,tipo,recebedor,data_entrega,comprovante,arquivo_path)
 select id,id,id,centro_id,'entrega',case when numero=1 then 'Maria Souza' else 'RECEBEDOR OUTRA CARTEIRA' end,'2026-10-16','COMPROVANTE SECRETO','ARQUIVO SECRETO' from pedidos where numero<6;
 insert into cargas values('${id(200)}',7,'${id(10)}','concluida');
 insert into carga_pedidos values('${id(200)}','${id(100)}'),('${id(200)}','${id(101)}');
 -- The representative cannot query logistics tables directly, nor operate deliveries.
 alter table expedicoes enable row level security;alter table entrega_registros enable row level security;
 grant select on expedicoes,entrega_registros to authenticated;
 `);
    const sql = fs.readFileSync(path.join(root, "db/fase235_acompanhamento_pedidos.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, args = []) => (await d.query(s, args)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
    const read = async (n) => (await q("select acompanhar_pedido_235($1) r", [id(n)]))[0].r;
    const denied = async (n, re = /sem acesso/) => assert.rejects(read(n), re);
    await actor(1);
    assert.equal((await q("select count(*) n from entrega_registros"))[0].n, 0);
    let r = await read(100);
    assert.equal(r.recebedor, "Maria Souza");
    assert.equal(r.data_entrega, "2026-10-16");
    assert.equal(r.carga_numero, 7);
    assert(!JSON.stringify(r).includes("SECRETO"));
    assert(!JSON.stringify(r).includes("OUTRA CARTEIRA"));
    assert.equal((await q("select pode_rotina('entrega_registrar') ok"))[0].ok, false);
    for (const n of [101, 102, 103, 104, 999]) await denied(n);
    r = await read(105);
    assert.equal(r.status, "confirmado");
    assert.equal(r.recebedor, null);
    assert.equal(r.data_entrega, null);
    assert.equal(r.carga_numero, null);
    await actor(5);
    await denied(100);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','gestor'),('${id(1)}','financeiro')`);
    await actor(1);
    await denied(101);
    await denied(102);
    await denied(103);
    // Admin remains the explicit exception, including across centres.
    await actor(3);
    assert.equal((await read(102)).numero, 3);
    assert.equal((await read(101)).recebedor, "RECEBEDOR OUTRA CARTEIRA");
    await d.exec("reset role");
    await d.exec(`update profiles set ativo=false where id='${id(1)}'`);
    await actor(1);
    await denied(100, /não liberado/);
    await d.exec("reset role");
    await d.exec(
      `update profiles set ativo=true where id='${id(1)}';delete from user_roles where user_id='${id(1)}' and role<>'representante'`,
    );
    // Permission/menu revocations must remain effective after reapplying the migration.
    await d.exec(
      "delete from role_permissoes where role='representante' and permissao='pedidos_acompanhar'",
    );
    await d.exec(sql);
    await actor(1);
    await denied(100, /não liberado/);
    await d.exec(
      "reset role;insert into role_permissoes values('representante','pedidos_acompanhar');delete from role_menus where role='representante' and path='/pedidos'",
    );
    await actor(1);
    await denied(100, /não liberado/);
    await d.exec("reset role;insert into role_menus values('representante','/pedidos')");
    // Cancelled old expedition/proof must not supply a receiver to the current expedition.
    await d.exec(
      `insert into expedicoes(id,pedido_id,centro_id,status,created_at) values('${id(300)}','${id(100)}','${id(10)}','cancelada',now()+interval '1 day')`,
    );
    await actor(1);
    assert.equal((await read(100)).recebedor, "Maria Souza");
    await d.exec("reset role");
    await d.exec(
      `insert into entrega_itens values('${id(100)}');update pedidos set status='parcial' where id='${id(100)}'`,
    );
    await actor(1);
    r = await read(100);
    assert.equal(r.recebedor, null);
    assert.equal(r.data_entrega, null);
    assert.equal(r.possui_entrega_parcial, true);
    assert.equal(r.recebedor_ultima_visita, "Maria Souza");
    // A receipt in another centre cannot leak into this permitted order.
    await d.exec("reset role");
    await d.exec(
      `update pedidos set status='entregue' where id='${id(100)}';update entrega_registros set centro_id='${id(11)}' where id='${id(100)}'`,
    );
    await actor(1);
    assert.equal((await read(100)).recebedor, null);
    await d.exec("reset role");
    const before = await q("select to_jsonb(p) r from pedidos p order by numero");
    for (const status of [
      "rascunho",
      "aguardando_aprovacao",
      "aprovado",
      "confirmado",
      "separacao",
      "separado",
      "conferido",
      "faturado",
      "em_carga",
      "em_rota",
      "entregue",
      "cancelado",
      "devolvido",
    ]) {
      await d.query("update pedidos set status=$1 where numero=6", [status]);
      await actor(1);
      r = await read(105);
      assert.equal(r.status, status);
      assert.equal(r.recebedor, null);
      await d.exec("reset role");
    }
    await d.exec("update pedidos set status='confirmado' where numero=6");
    assert.deepEqual(await q("select to_jsonb(p) r from pedidos p order by numero"), before);
    assert.equal((await q("select count(*) n from auditoria"))[0].n, 0);
    await d.exec("set role anon");
    await denied(100, /permission denied/);
    console.log(
      "OK acompanhamento235: consulta sem perfil logístico, data/recebedor, sem campos privados, carteira atual + representante do pedido + centro, papéis mistos, admin, usuário inativo, sem vínculo, revogação/reaplicação, romaneio cancelado, parcial sem falsa entrega completa, status e ausência de escrita.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
