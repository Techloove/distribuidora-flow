const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
 create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid and $2='${id(10)}'::uuid$$;
 create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${id(1)}',true);
 create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,status text,retorno jsonb,erro text);
 insert into boletos values('${id(40)}','${id(10)}','sicredi','api','registrado','{}',null),('${id(41)}','${id(11)}','sicredi','api','registrado','{}',null);
 create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);`);
    const source = fs.readFileSync(
      path.join(root, "db/fase123_persistencia_sicredi_server_only.sql"),
      "utf8",
    );
    const start = source.indexOf(
      "create or replace function public.sincronizar_boleto_sicredi_servidor(",
    );
    await db.exec(source.slice(start, source.indexOf("$$;", start) + 3));
    const sql = fs.readFileSync(
      path.join(root, "db/fase281_cancelamento_boleto_sicredi.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const save = (boleto = id(40)) =>
      db.query("select sicredi_registrar_pedido_baixa_281($1,$2,$3)", [
        id(1),
        boleto,
        JSON.stringify({ statusComando: "MOVIMENTO_ENVIADO", tipoMensagem: "BAIXA" }),
      ]);
    const sync = (status) =>
      db.query("select sincronizar_boleto_sicredi_servidor($1,$2,$3,$4)", [
        id(1),
        id(40),
        status,
        "{}",
      ]);
    await assert.rejects(() => save(id(41)), /acesso/);
    await db.exec("set test.role='authenticated'");
    await assert.rejects(() => save(), /servidor/);
    await db.exec("set test.role='service_role'");
    await db.exec(`update profiles set ativo=false`);
    await assert.rejects(() => save(), /ativo/);
    await db.exec(`update profiles set ativo=true`);
    await save();
    let b = (await db.query("select * from boletos where id=$1", [id(40)])).rows[0];
    assert.equal(b.status, "registrado");
    assert.equal(b.retorno.cancelamento_sicredi_pendente, true);
    for (const terminal of ["baixado", "cancelado", "liquidado"]) {
      await db.query("update boletos set status=$1,retorno=$2 where id=$3", [
        terminal,
        JSON.stringify({ confirmacao: "preservada" }),
        id(40),
      ]);
      await save();
      b = (await db.query("select * from boletos where id=$1", [id(40)])).rows[0];
      assert.equal(b.status, terminal);
      assert.deepEqual(b.retorno, { confirmacao: "preservada" });
      await assert.rejects(() => sync("registrado"), /reaberto/);
    }
    await db.query("update boletos set status='registrado' where id=$1", [id(40)]);
    await sync("baixado");
    assert.equal(
      (await db.query("select status from boletos where id=$1", [id(40)])).rows[0].status,
      "baixado",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from auditoria where acao='pedido_baixa_sicredi_281'",
        )
      ).rows[0].n,
      4,
    );
    await db.exec("set role authenticated");
    await assert.rejects(() => save(), /permission denied/);
    await db.exec("reset role");
    console.log(
      "Cancelamento281 OK: retorno aceito sem baixa antecipada, loja/ator/servidor, concorrência preserva estados terminais, consulta atrasada não reabre, auditoria e reaplicação.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
