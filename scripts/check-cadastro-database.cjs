const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create type app_role as enum('admin','gestor','representante','financeiro','estoque','expedicao');
 create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,encrypted_password text default 'hash-original-fixture');
 create table profiles(id uuid primary key references auth.users(id),nome text,email text,telefone text,ativo boolean default true,todos_centros boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
 create table user_roles(user_id uuid references profiles(id),role app_role,primary key(user_id,role));
 create table centros(id uuid primary key,nome text,ativo boolean default true);
 create table usuario_centros(user_id uuid references profiles(id),centro_id uuid references centros(id),primary key(user_id,centro_id));
 create table pessoas(id uuid primary key,profile_id uuid);
 create table representantes(id uuid primary key default gen_random_uuid(),nome text,email text,telefone text,profile_id uuid references profiles(id),ativo boolean default true,pessoa_id uuid);
 create table auditoria(id uuid default gen_random_uuid(),tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$begin insert into profiles(id,nome,email) values(new.id,'Usuário',new.email);return new;end $$;
 create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
 insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','admin@example.test',now()),('${id(2)}','gestor@example.test',now()),('${id(3)}','inativo@example.test',now());
 insert into user_roles values('${id(1)}','admin'),('${id(2)}','gestor'),('${id(3)}','admin');update profiles set ativo=false where id='${id(3)}';
 insert into centros values('${id(10)}','Centro A',true),('${id(11)}','Centro B',false);
 insert into representantes(id,nome) values('${id(20)}','Carteira existente');
 create function admin_criar_usuario(_email text,_senha text,_nome text default '',_telefone text default null) returns uuid language plpgsql security definer set search_path=public as $$declare novo_id uuid:=gen_random_uuid();begin if not has_role(auth.uid(),'admin') then raise exception 'Somente admin';end if;insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values(novo_id,_email,jsonb_build_object('nome',_nome),now());return novo_id;end $$;
 grant usage on schema public,auth to authenticated,anon;grant select on profiles,user_roles to authenticated;grant update on profiles to authenticated;
 `);
    const load = async (file, name) => {
      const sql = fs.readFileSync(path.join(root, "db", file), "utf8"),
        start = sql.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0, name);
      await db.exec(sql.slice(start, sql.indexOf("$$;", start) + 3));
    };
    for (const name of ["usuario_ativo", "has_role", "can_manage", "proteger_campos_perfil"])
      await load("fase99_usuario_ativo_execucao_rpc.sql", name);
    await db.exec(
      `alter table profiles enable row level security;create policy leitura on profiles for select to authenticated using(id=auth.uid() or can_manage(auth.uid()));create policy edicao on profiles for update to authenticated using(id=auth.uid() or can_manage(auth.uid())) with check(id=auth.uid() or can_manage(auth.uid()));create trigger proteger_perfil before update on profiles for each row execute function proteger_campos_perfil();`,
    );
    await load("fase28_admin_usuarios.sql", "admin_atualizar_usuario");
    await load("fase27_centros_usuario.sql", "definir_centros_usuario");
    await load("fase47_usuario_representante.sql", "admin_vincular_representante");
    const migration = () =>
      db.exec(
        fs.readFileSync(path.join(root, "db/fase221_cadastro_representante_aprovacao.sql"), "utf8"),
      );
    await migration();
    await migration();
    const login = async (n) =>
      db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
      );
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','',false);insert into auth.users(id,email,raw_user_meta_data) values('${id(100)}','novo@example.test','{"nome":"Novo representante","telefone":"27999999999","role":"admin","ativo":true,"todos_centros":true,"cadastro_status":"aprovado"}'),('${id(101)}','recusa@example.test','{"nome":"Recusado"}');`,
    );
    const p = (await db.query("select * from profiles where id=$1", [id(100)])).rows[0];
    assert.equal(p.cadastro_status, "pendente");
    assert.equal(p.ativo, false);
    assert.equal(p.todos_centros, false);
    assert.deepEqual(
      (await db.query("select role from user_roles where user_id=$1", [id(100)])).rows.map(
        (r) => r.role,
      ),
      ["representante"],
    );
    await login(100);
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, false);
    await assert.rejects(
      db.query("update profiles set ativo=true where id=$1", [id(100)]),
      /autorizar|administrador/i,
    );
    await assert.rejects(
      db.query("update profiles set cadastro_status='interno',ativo=true where id=$1", [id(100)]),
      /administrador/i,
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(100), [id(10)]]),
      /administrador/,
    );
    for (const n of [2, 3]) {
      await login(n);
      await assert.rejects(
        db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(100), [id(10)]]),
        /administrador/,
      );
    }
    await login(1);
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(100), [id(10)]]),
      /confirmar o e-mail/,
    );
    await db.exec(
      `reset role;update auth.users set email_confirmed_at=now() where id='${id(100)}';set role authenticated;`,
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(100), []]),
      /centros/,
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(100), [id(11)]]),
      /centros/,
    );
    await db.query("select admin_decidir_cadastro_221($1,true,$2,$3,null)", [
      id(100),
      id(20),
      [id(10)],
    ]);
    // Aprovar o cadastro não deve substituir nem apagar a credencial do Auth.
    await db.exec("reset role");
    assert.equal(
      (await db.query("select encrypted_password from auth.users where id=$1", [id(100)])).rows[0]
        .encrypted_password,
      "hash-original-fixture",
    );
    await login(1);
    assert.equal(
      (await db.query("select cadastro_status from profiles where id=$1", [id(100)])).rows[0]
        .cadastro_status,
      "aprovado",
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,$2,$3,null)", [
        id(100),
        id(20),
        [id(10)],
      ]),
      /já autorizado/,
    );
    await login(100);
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, true);
    await login(1);
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,false,null,null,'')", [id(101)]),
      /justificativa/,
    );
    await db.query(
      "select admin_decidir_cadastro_221($1,false,null,null,'Cadastro não reconhecido')",
      [id(101)],
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select cadastro_status from profiles where id=$1", [id(101)])).rows[0]
        .cadastro_status,
      "recusado",
    );
    await login(101);
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, false);
    await login(1);
    await assert.rejects(
      db.query("select admin_atualizar_usuario($1,null,null,null,true,null)", [id(101)]),
      /Autorize/,
    ); // RPC de edição não substitui a autorização.
    await assert.rejects(
      db.query("update profiles set ativo=true where id=$1", [id(101)]),
      /Autorize/,
    );
    await db.exec(
      `reset role;insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values('${id(102)}','carteira-nova@example.test','{"nome":"Carteira nova"}',now());insert into user_roles values('${id(102)}','financeiro');set role authenticated;`,
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,$2,$3,null)", [
        id(102),
        id(20),
        [id(10)],
      ]),
      /outro usuário/,
    );
    await db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(102), [id(10)]]);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from representantes where profile_id=$1", [id(102)]))
        .rows[0].n,
      1,
    );
    assert.deepEqual(
      (await db.query("select role from user_roles where user_id=$1", [id(102)])).rows.map(
        (r) => r.role,
      ),
      ["representante"],
    );
    await login(1);
    await db.exec(
      `reset role;update auth.users set email_confirmed_at=now() where id='${id(101)}';set role authenticated;`,
    );
    await db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(101), [id(10)]]);
    assert.equal(
      (await db.query("select cadastro_status from profiles where id=$1", [id(101)])).rows[0]
        .cadastro_status,
      "aprovado",
      "Recusa pode ser reavaliada explicitamente pelo admin",
    );
    const interno = (
      await db.query(
        "select admin_criar_usuario('interno@example.test','senha-fixture','Interno',null) id",
      )
    ).rows[0].id;
    assert.equal(
      (await db.query("select cadastro_status,ativo from profiles where id=$1", [interno])).rows[0]
        .cadastro_status,
      "interno",
    );
    assert.equal(
      (await db.query("select ativo from profiles where id=$1", [interno])).rows[0].ativo,
      true,
    );
    await db.exec("reset role");
    await migration();
    assert.equal(
      (await db.query("select cadastro_status from profiles where id=$1", [id(100)])).rows[0]
        .cadastro_status,
      "aprovado",
    );
    const gateSource = fs.readFileSync(
      path.join(root, "db/fase148_gate_revisao_codex.sql"),
      "utf8",
    );
    const gateStart = gateSource.indexOf("-- 3)"),
      gate = gateSource.slice(gateStart, gateSource.indexOf("end $$;", gateStart) + 7);
    await db.exec(gate);
    await db.exec(
      `create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$begin insert into profiles(id,nome,email,ativo,todos_centros,cadastro_status) values(new.id,'Teste',new.email,true,true,'interno');insert into user_roles(user_id,role) values(new.id,'admin');return new;end $$;`,
    );
    await assert.rejects(db.exec(gate), /fora do fluxo pendente/);
    await migration();
    await db.exec("set role anon");
    assert.equal(
      (await db.query("select cadastro_representante_disponivel_221() ok")).rows[0].ok,
      true,
    );
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,false,null,null,'Teste')", [id(100)]),
      /permission denied/,
    );
    console.log(
      "Cadastro OK: metadados não elevam acesso, pendente/recusado bloqueados, só admin ativo decide, e-mail/centros/vínculo exigidos, criação administrativa preservada e migração reaplicável.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
