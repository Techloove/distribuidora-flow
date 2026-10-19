const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const sql = fs.readFileSync(
    path.join(__dirname, "../db/vincular_edson_cadastro_unificado.sql"),
    "utf8",
  ),
  rep = "dfa871a6-0b2e-4624-aaa4-c2e0cc71f548",
  profile = "da658606-70de-44b0-a0ba-0315492bde28";
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function has_role(uuid,text) returns boolean language sql as $$select true$$;
create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${profile}',true);
create table pessoas(id uuid primary key default gen_random_uuid(),codigo text,razao_social text,tipo_pessoa text,email text,telefone text,regiao text,comissao_percentual numeric,ativo boolean,is_representante boolean,is_usuario boolean,profile_id uuid references profiles(id));
create table representantes(id uuid primary key default gen_random_uuid(),nome text,email text,telefone text,regiao text,comissao_percentual numeric,ativo boolean,profile_id uuid references profiles(id),pessoa_id uuid unique references pessoas(id));
create table clientes(id uuid,representante_id uuid references representantes(id));create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
insert into representantes values('${rep}','Édson Luiz Cardoso','edson@example.test','27999999999','ES',5,true,'${profile}',null);
insert into clientes select gen_random_uuid(),'${rep}'::uuid from generate_series(1,12);
create function sincronizar() returns trigger language plpgsql as $$begin if new.is_representante then
 if exists(select 1 from representantes where pessoa_id=new.id) then update representantes set nome=new.razao_social,email=new.email,telefone=new.telefone,regiao=new.regiao,comissao_percentual=new.comissao_percentual,ativo=new.ativo,profile_id=new.profile_id where pessoa_id=new.id;
 else insert into representantes(nome,pessoa_id,profile_id,ativo) values(new.razao_social,new.id,new.profile_id,new.ativo);end if;end if;return new;end$$;
create trigger replica after insert or update on pessoas for each row execute function sincronizar();`);
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query("select count(*) n from representantes")).rows[0].n, 1);
    assert.equal((await db.query("select count(*) n from pessoas")).rows[0].n, 1);
    const p = (await db.query("select * from pessoas")).rows[0];
    assert.equal(p.is_representante, true);
    assert.equal(p.is_usuario, true);
    assert.equal(p.profile_id, profile);
    assert.equal((await db.query("select count(*) n from clientes")).rows[0].n, 12);
    assert.equal(
      (await db.query("select comissao_percentual from representantes")).rows[0]
        .comissao_percentual,
      "5",
    );
    await db.exec(
      `update pessoas set profile_id=null;insert into pessoas(razao_social) values('Edson Luiz Cardoso')`,
    );
    await assert.rejects(db.exec(sql));
    await db.exec("rollback");
    assert.equal((await db.query("select count(*) n from representantes")).rows[0].n, 1);
    console.log(
      "Vínculo Edson OK: pessoa criada e associada antes da sincronização, sem duplicar representante, funções e login corretos, 12 clientes/comissão preservados e reexecução segura.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
