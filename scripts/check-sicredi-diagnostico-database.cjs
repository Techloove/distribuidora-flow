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
create table boletos(id uuid primary key,status text);
create table sicredi_auto_fila_247(boleto_id uuid primary key,lease uuid,lease_ate timestamptz,actor uuid,ultima_consulta timestamptz,resultado text,erro text,proxima_consulta timestamptz);
create function sicredi_liquidar_api_224(uuid,uuid,jsonb) returns void language plpgsql as $$begin raise exception 'Baixa não deve ser chamada neste teste';end$$;
create function sincronizar_boleto_sicredi_servidor(uuid,uuid,text,jsonb) returns void language plpgsql as $$begin raise exception 'Baixa não deve ser chamada neste teste';end$$;
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
insert into boletos values('${id(1)}','registrado'),('${id(2)}','liquidado');
insert into sicredi_auto_fila_247(boleto_id,lease,lease_ate) values('${id(1)}','${id(9)}',now()+interval '1 hour'),('${id(2)}','${id(9)}',now()+interval '1 hour');`);
    const source = fs.readFileSync(
      path.join(root, "db/fase247_sicredi_consulta_automatica.sql"),
      "utf8",
    );
    const start = source.indexOf("create or replace function public.sicredi_auto_finalizar_247(");
    await db.exec(source.slice(start, source.indexOf("$$;", start) + 3));
    await db.exec(
      "revoke all on function sicredi_auto_finalizar_247(uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function sicredi_auto_finalizar_247(uuid,uuid,text,jsonb) to service_role",
    );
    const original = (
      await db.query(
        "select pg_get_functiondef('sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'::regprocedure) d",
      )
    ).rows[0].d;
    const sql = fs.readFileSync(
      path.join(root, "db/fase277_diagnostico_consulta_sicredi.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)','EXECUTE') p",
        )
      ).rows[0].p,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role','sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)','EXECUTE') p",
        )
      ).rows[0].p,
      true,
    );
    const patched = (
      await db.query(
        "select pg_get_functiondef('sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'::regprocedure) d",
      )
    ).rows[0].d;
    assert.equal(
      patched.replace(
        "diagnostico_277=case when estado='consulta_falhou' then public.sicredi_diagnostico_seguro_277(_dados) else null end, ",
        "",
      ),
      original,
    );
    const finish = (boleto, situacao, dados) =>
      db.query("select sicredi_auto_finalizar_247($1,$2,$3,$4) r", [
        id(9),
        boleto,
        situacao,
        dados,
      ]);
    await finish(id(1), "consulta_falhou", {
      diagnostico: { etapa: "consulta", tipo: "http", http_status: 503, token: "NUNCA_GRAVAR" },
      password: "NUNCA_GRAVAR",
    });
    let row = (await db.query("select * from sicredi_auto_fila_247 where boleto_id=$1", [id(1)]))
      .rows[0];
    assert.deepEqual(row.diagnostico_277, { etapa: "consulta", tipo: "http", http_status: 503 });
    assert.equal(row.erro, "CONSULTA_FALHOU");
    assert.equal(row.resultado, "consulta_falhou");
    assert.equal(row.lease, null);
    assert(row.proxima_consulta > row.ultima_consulta);
    assert(!JSON.stringify(row).includes("NUNCA_GRAVAR"));
    await db.query(
      "update sicredi_auto_fila_247 set lease=$1,lease_ate=now()+interval '1 hour' where boleto_id=$2",
      [id(9), id(1)],
    );
    await finish(id(1), "pendente", null);
    row = (await db.query("select * from sicredi_auto_fila_247 where boleto_id=$1", [id(1)]))
      .rows[0];
    assert.equal(row.diagnostico_277, null);
    assert.equal(row.erro, null);
    await finish(id(2), "consulta_falhou", {
      diagnostico: { etapa: "token", tipo: "http", http_status: 401 },
    });
    assert.equal(
      (await db.query("select resultado from sicredi_auto_fila_247 where boleto_id=$1", [id(2)]))
        .rows[0].resultado,
      "ja_processado",
    );
    assert.equal(
      (
        await db.query("select diagnostico_277 from sicredi_auto_fila_247 where boleto_id=$1", [
          id(2),
        ])
      ).rows[0].diagnostico_277,
      null,
    );
    assert.equal((await db.query("select count(*)::int n from auditoria")).rows[0].n, 0);
    assert.equal(
      (await db.query("select status from boletos where id=$1", [id(1)])).rows[0].status,
      "registrado",
    );
    assert.equal(
      (
        await db.query("select sicredi_diagnostico_seguro_277($1) d", [
          { diagnostico: { etapa: "token", tipo: "http", http_status: 999 } },
        ])
      ).rows[0].d.http_status,
      undefined,
    );
    assert.equal(
      (
        await db.query("select sicredi_diagnostico_seguro_277($1) d", [
          { diagnostico: { etapa: "NUNCA_GRAVAR", tipo: "http" } },
        ])
      ).rows[0].d,
      null,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select sicredi_diagnostico_seguro_277(null)"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec(
      "alter table sicredi_auto_fila_247 drop column diagnostico_277;create or replace function sicredi_auto_finalizar_247(_lease uuid,_boleto uuid,_situacao text,_dados jsonb default null) returns text language plpgsql security definer as $$begin return 'incompatível';end$$;",
    );
    await assert.rejects(db.exec(sql), /incompatível/);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from information_schema.columns where table_name='sicredi_auto_fila_247' and column_name='diagnostico_277'",
        )
      ).rows[0].n,
      0,
    );
    console.log(
      "Sicredi277 OK: corpo do finalizador preservado, diagnóstico filtrado, idempotência, limpeza após recuperação, pago não reprocessado, sem baixas e sem exposição de segredos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
