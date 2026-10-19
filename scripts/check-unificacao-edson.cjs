const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = fs.readFileSync(
  path.join(__dirname, "../db/unificar_representantes_edson_cardoso.sql"),
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function has_role(uuid,text) returns boolean language sql as $$select true$$;
create table pessoas(id uuid primary key,razao_social text,is_representante boolean,ativo boolean,profile_id uuid,representante_id uuid);
create table representantes(id uuid primary key,nome text,ativo boolean,profile_id uuid,pessoa_id uuid references pessoas(id));
alter table pessoas add foreign key(representante_id) references representantes(id);
create table clientes(id uuid primary key,representante_id uuid references representantes(id),nome text);
create table pedidos(id uuid primary key,representante_id uuid references representantes(id),total_liquido numeric,status text);
create table comissoes(id uuid primary key,representante_id uuid references representantes(id),valor numeric,status text);
create table representante_rotas(id uuid primary key,representante_id uuid references representantes(id),rota_id uuid,unique(representante_id,rota_id));
create table metas_vendas(id uuid primary key,representante_id uuid references representantes(id),ano int,mes int,valor_meta numeric,unique(representante_id,ano,mes));
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
insert into pessoas values('${id(11)}','EDSON CARDOSO',true,true,null,null),('${id(12)}','Édson Luiz Cardoso',true,true,'${id(99)}',null);
insert into representantes values('${id(1)}','EDSON CARDOSO',true,null,'${id(11)}'),('${id(2)}','Édson Luiz Cardoso',true,'${id(99)}','${id(12)}');
insert into clientes values('${id(20)}','${id(1)}','Cliente origem'),('${id(21)}','${id(2)}','Cliente destino');
insert into pedidos values('${id(30)}','${id(1)}',100,'entregue');insert into comissoes values('${id(31)}','${id(1)}',5,'paga');
insert into representante_rotas values('${id(40)}','${id(1)}','${id(60)}'),('${id(41)}','${id(2)}','${id(60)}'),('${id(42)}','${id(1)}','${id(61)}');
insert into metas_vendas values('${id(50)}','${id(1)}',2026,10,1000);
`);
  return db;
}
(async () => {
  let db = await fixture();
  try {
    await db.exec(sql);
    assert.equal(
      (await db.query(`select count(*) n from clientes where representante_id='${id(2)}'`)).rows[0]
        .n,
      2,
    );
    assert.equal((await db.query("select count(*) n from representante_rotas")).rows[0].n, 2);
    assert.deepEqual((await db.query("select valor,status from comissoes")).rows, [
      { valor: "5", status: "paga" },
    ]);
    assert.equal(
      (await db.query(`select ativo from representantes where id='${id(1)}'`)).rows[0].ativo,
      false,
    );
    assert.equal(
      (await db.query(`select profile_id from representantes where id='${id(2)}'`)).rows[0]
        .profile_id,
      id(99),
    );
    await db.exec(sql);
    assert.equal((await db.query("select count(*) n from clientes")).rows[0].n, 2);
  } finally {
    await db.close();
  }
  // O bloco pode ser executado sozinho no SQL Editor, sem tabela temporária prévia.
  db = await fixture();
  try {
    const bloco = sql.slice(
      sql.indexOf("do $unificar$"),
      sql.indexOf("$unificar$;") + "$unificar$;".length,
    );
    await db.exec(bloco);
    assert.equal(
      (await db.query(`select count(*) n from clientes where representante_id='${id(2)}'`)).rows[0]
        .n,
      2,
    );
    assert.equal((await db.query("select count(*) n from auditoria")).rows[0].n, 1);
  } finally {
    await db.close();
  }
  for (const kind of ["login", "metas", "gatilho", "nome"]) {
    db = await fixture();
    try {
      if (kind === "login")
        await db.exec(`update representantes set profile_id='${id(98)}' where id='${id(1)}'`);
      if (kind === "metas")
        await db.exec(`insert into metas_vendas values('${id(51)}','${id(2)}',2026,10,2000)`);
      if (kind === "nome")
        await db.exec(
          `insert into representantes values('${id(3)}','EDSON CARDOSO',true,null,null)`,
        );
      if (kind === "gatilho")
        await db.exec(
          `create function alterar_valor() returns trigger language plpgsql as $$begin new.valor:=new.valor+100;return new;end$$;create trigger errado before update on comissoes for each row execute function alterar_valor()`,
        );
      await assert.rejects(db.exec(sql));
      await db.exec("rollback");
      assert.equal(
        (await db.query(`select representante_id from clientes where id='${id(20)}'`)).rows[0]
          .representante_id,
        id(1),
      );
      assert.equal((await db.query("select count(*) n from auditoria")).rows[0].n, 0);
    } finally {
      await db.close();
    }
  }
  console.log(
    "Unificação Edson OK: carteira/pedidos/comissões/metas e rotas transferidos, login preservado, duplicado inativo, reexecução, valores mantidos e rollback por conflitos ou efeitos de triggers.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
