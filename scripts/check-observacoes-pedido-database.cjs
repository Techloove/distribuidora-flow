const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
 create table flags(ativo boolean,operar boolean,rotina boolean,loja boolean,representante boolean,carteira boolean);
 insert into flags values(true,true,true,true,false,true);
 create function usuario_ativo() returns boolean language sql as $$select ativo from flags$$;
 create function can_operate(uuid) returns boolean language sql as $$select operar from flags$$;
 create function pode_rotina(text) returns boolean language sql as $$select rotina from flags$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select loja from flags$$;
 create function escopo_representante() returns boolean language sql as $$select representante from flags$$;
 create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select carteira from flags$$;
 create function orcamento_acessivel_236(uuid) returns boolean language sql as $$select true$$;
 create table pedidos(id uuid primary key,centro_id uuid,status text,tipo_documento text default 'pedido',orcamento_situacao text,orcamento_validade date,observacoes text,total numeric default 150);
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 insert into pedidos(id,centro_id,status) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','rascunho');`);
  const sql = fs.readFileSync(
    require("node:path").join(__dirname, "../db/fase274_observacoes_pedido.sql"),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  const save = (text, prev) =>
    db.query(
      `select * from salvar_observacoes_pedido_274('00000000-0000-0000-0000-000000000002',$1,$2)`,
      [text, prev],
    );
  await save("Linha 1\nLinha 2", "");
  assert.equal(
    (await db.query("select observacoes from pedidos")).rows[0].observacoes,
    "Linha 1\nLinha 2",
  );
  await assert.rejects(() => save("Conflito", ""), /outro usuário/);
  await assert.rejects(() => save("a".repeat(4001), "Linha 1\nLinha 2"), /4000/);
  for (const flag of ["ativo", "operar", "rotina", "loja"]) {
    await db.exec(`update flags set ${flag}=false`);
    await assert.rejects(() => save("Negado", "Linha 1\nLinha 2"));
    await db.exec(`update flags set ${flag}=true`);
  }
  await db.exec("update flags set representante=true,carteira=false");
  await assert.rejects(() => save("Negado", "Linha 1\nLinha 2"), /carteira/);
  await db.exec("update flags set carteira=true");
  await save("", "Linha 1\nLinha 2");
  assert.equal((await db.query("select observacoes from pedidos")).rows[0].observacoes, null);
  for (const status of ["confirmado", "entregue", "cancelado"]) {
    await db.query("update pedidos set status=$1", [status]);
    await assert.rejects(() => save("Negado", ""), /digitação/);
  }
  await db.exec(
    "update pedidos set status='rascunho',tipo_documento='orcamento',orcamento_situacao='negociacao',orcamento_validade=current_date-1",
  );
  await assert.rejects(() => save("Negado", ""), /reabra/);
  await db.exec("update pedidos set orcamento_validade=current_date+1");
  await save("Proposta", "");
  assert.equal((await db.query("select total from pedidos")).rows[0].total, "150");
  assert.equal((await db.query("select count(*)::int n from auditoria")).rows[0].n, 3);
  await db.close();
  console.log(
    "Observações274: gravação, remoção, concorrência, limite, loja/carteira, status e proposta OK.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
