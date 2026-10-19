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
 create type app_role as enum('admin','gestor','comercial','representante','financeiro','estoque','expedicao');
 create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
 create table profiles(id uuid primary key references auth.users(id),nome text,email text,telefone text,ativo boolean default true,todos_centros boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
 create table user_roles(user_id uuid references profiles(id),role app_role,primary key(user_id,role));
 create table centros(id uuid primary key,nome text,ativo boolean default true);
 create table usuario_centros(user_id uuid references profiles(id),centro_id uuid references centros(id),primary key(user_id,centro_id));
 
 create table representantes(id uuid primary key default gen_random_uuid(),nome text,email text,telefone text,profile_id uuid references profiles(id),ativo boolean default true,pessoa_id uuid,regiao text,comissao_percentual numeric default 0);
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
    for (const name of [
      "usuario_ativo",
      "has_role",
      "can_manage",
      "can_finance",
      "can_stock",
      "can_operate",
      "proteger_campos_perfil",
    ])
      await load("fase99_usuario_ativo_execucao_rpc.sql", name);
    await db.exec(
      `alter table profiles enable row level security;create policy leitura on profiles for select to authenticated using(id=auth.uid() or can_manage(auth.uid()));create policy edicao on profiles for update to authenticated using(id=auth.uid() or can_manage(auth.uid())) with check(id=auth.uid() or can_manage(auth.uid()));create trigger proteger_perfil before update on profiles for each row execute function proteger_campos_perfil();`,
    );
    await load("fase28_admin_usuarios.sql", "admin_atualizar_usuario");
    await load("fase27_centros_usuario.sql", "definir_centros_usuario");
    await load("fase47_usuario_representante.sql", "admin_vincular_representante");
    await load("fase4_logistica_relatorios.sql", "can_ship");
    const pessoaDDL = fs.readFileSync(path.join(root, "db/fase10_cadastro_unificado.sql"), "utf8");
    await db.exec(
      pessoaDDL.slice(
        pessoaDDL.indexOf("create table if not exists public.pessoas"),
        pessoaDDL.indexOf("create index if not exists pessoas_razao_idx"),
      ),
    );
    await db.exec(`alter table pessoas add column is_transportadora boolean default false;alter table pessoas add column centro_id uuid;alter table pessoas add column rota_id uuid;alter table pessoas add column codigo_ibge text;
      create table clientes(id uuid primary key default gen_random_uuid(),pessoa_id uuid,representante_id uuid);
      create table fornecedores(id uuid primary key,pessoa_id uuid);create table transportadoras(id uuid primary key,pessoa_id uuid);
      create table cobranca_centros(id uuid primary key);alter table clientes enable row level security;
      create policy carteira on clientes for all to authenticated using(can_operate(auth.uid()));
      grant select on clientes to authenticated;
    `);
    // O gatilho real deve atualizar o representante existente, sem gerar uma segunda carteira.
    const sync = fs.readFileSync(
      path.join(root, "db/fase198_cliente_espelha_centro_rota.sql"),
      "utf8",
    );
    await db.exec(sync.slice(0, sync.indexOf("-- backfill")));
    await db.exec(
      `create trigger trg_sincronizar_pessoa after insert or update on pessoas for each row execute function sincronizar_pessoa();`,
    );
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
    const apply = () =>
      db.exec(
        fs.readFileSync(path.join(root, "db/fase238_primeiro_acesso_representante.sql"), "utf8"),
      );
    const oldOid = (await db.query("select 'can_operate(uuid)'::regprocedure::oid n")).rows[0].n;
    await apply();
    await apply();
    assert.equal(
      (await db.query("select 'can_operate(uuid)'::regprocedure::oid n")).rows[0].n,
      oldOid,
    );
    assert.equal(
      (await db.query("select count(*) n from profiles where precisa_completar_cadastro")).rows[0]
        .n,
      0,
      "Legados preservados",
    );
    await db.exec(`select set_config('request.jwt.claim.sub','',false);
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${id(100)}','novo@example.test',now(),'{"nome":"Novo representante"}');
      insert into clientes(id,representante_id) values('${id(500)}','${id(20)}');`);
    await login(100);
    await assert.rejects(db.query("select meu_cadastro_inicial_238()"), /após aprovação/);
    await assert.rejects(db.query("select completar_meu_cadastro_238('{}')"), /após aprovação/);
    await login(1);
    await db.query("select admin_decidir_cadastro_221($1,true,$2,$3,null)", [
      id(100),
      id(20),
      [id(10)],
    ]);
    assert.equal(
      (await db.query("select precisa_completar_cadastro ok from profiles where id=$1", [id(100)]))
        .rows[0].ok,
      true,
    );
    await db.exec(
      `reset role;update representantes set comissao_percentual=7.5,regiao='Zona A' where id='${id(20)}';`,
    );
    await login(100);
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, false);
    assert.equal((await db.query("select can_operate(auth.uid()) ok")).rows[0].ok, false);
    assert.equal(
      (await db.query("select has_role(auth.uid(),'representante') ok")).rows[0].ok,
      false,
    );
    assert.equal((await db.query("select count(*) n from clientes")).rows[0].n, 0);
    assert.equal(
      (await db.query("select meu_cadastro_inicial_238() dados")).rows[0].dados.email,
      "novo@example.test",
    );
    await assert.rejects(
      db.query(
        "update profiles set precisa_completar_cadastro=false,cadastro_completo_em=now() where id=$1",
        [id(100)],
      ),
      /formulário inicial/,
    );
    await assert.rejects(
      db.query("insert into cadastro_complementos_238 values($1,$2,now())", [id(100), id(300)]),
      /permission denied/,
    );
    const payload = {
      nome: "Representante Completo",
      tipo_pessoa: "PF",
      cnpj_cpf: "123.456.789-09",
      telefone: "27999999999",
      logradouro: "Rua Um",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      cidade: "Venda Nova",
      uf: "ES",
      cep: "29375-000",
    };
    const complete = (data) =>
      db.query("select completar_meu_cadastro_238($1) pessoa", [JSON.stringify(data)]);
    await assert.rejects(complete({ ...payload, comissao_percentual: "99" }), /não altera acesso/);
    await assert.rejects(complete({ ...payload, pessoa_id: id(999) }), /não altera acesso/);
    await assert.rejects(complete({ ...payload, uf: "ZZ" }), /UF válida/);
    await assert.rejects(complete({ ...payload, cnpj_cpf: "11111111111" }), /Confira CPF/);
    await assert.rejects(complete({ ...payload, telefone: 12345678 }), /como texto/);
    await db.exec(
      `reset role;insert into pessoas(razao_social,cnpj_cpf) values('Outra pessoa','12345678909');set role authenticated;`,
    );
    await assert.rejects(complete(payload), /Documento já cadastrado/);
    assert.equal(
      (await db.query("select precisa_completar_cadastro ok from profiles where id=$1", [id(100)]))
        .rows[0].ok,
      true,
    );
    await db.exec(
      `reset role;delete from pessoas where cnpj_cpf='12345678909';set role authenticated;`,
    );
    const pessoa = (await complete(payload)).rows[0].pessoa;
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, true);
    assert.equal((await db.query("select count(*) n from clientes")).rows[0].n, 1);
    await assert.rejects(complete(payload), /após aprovação/);
    await db.exec("reset role");
    const rep = (await db.query("select * from representantes where id=$1", [id(20)])).rows[0];
    assert.equal(rep.pessoa_id, pessoa);
    assert.equal(rep.profile_id, id(100));
    assert.equal(Number(rep.comissao_percentual), 7.5);
    assert.equal(rep.regiao, "Zona A");
    assert.equal(rep.ativo, true);
    assert.equal(
      (await db.query("select count(*) n from representantes")).rows[0].n,
      1,
      "Não duplica carteira",
    );
    const person = (await db.query("select * from pessoas where id=$1", [pessoa])).rows[0];
    assert.equal(person.is_representante, true);
    assert.equal(person.is_usuario, true);
    assert.equal(person.profile_id, id(100));
    assert.equal(person.uf, "ES");
    assert.equal(person.cep, "29375000");
    assert.equal(person.cnpj_cpf, "12345678909");
    assert.equal(
      (await db.query("select representante_id from clientes")).rows[0].representante_id,
      id(20),
    );
    assert.equal(
      (await db.query("select centro_id from usuario_centros where user_id=$1", [id(100)])).rows[0]
        .centro_id,
      id(10),
    );
    assert.deepEqual(
      (await db.query("select role from user_roles where user_id=$1", [id(100)])).rows.map(
        (r) => r.role,
      ),
      ["representante"],
    );
    await apply();
    assert.equal(
      (await db.query("select precisa_completar_cadastro ok from profiles where id=$1", [id(100)]))
        .rows[0].ok,
      false,
    );
    // Cadastro público com carteira nova também conclui sem duplicar representante.
    await db.exec(
      `select set_config('request.jwt.claim.sub','',false);insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${id(101)}','segundo@example.test',now(),'{"nome":"Segundo representante"}');`,
    );
    await login(1);
    await db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(101), [id(10)]]);
    await login(101);
    const segundo = (
      await complete({ ...payload, nome: "Segundo representante", cnpj_cpf: "98765432100" })
    ).rows[0].pessoa;
    await db.exec("reset role");
    assert.notEqual(segundo, pessoa);
    assert.equal(
      (await db.query("select count(*) n from representantes where profile_id=$1", [id(101)]))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*) n from pessoas where profile_id=$1", [id(101)])).rows[0].n,
      1,
    );
    await login(1);
    const interno = (
      await db.query(
        "select admin_criar_usuario('interno238@example.test','fixture-password','Interno',null) id",
      )
    ).rows[0].id;
    assert.equal(
      (await db.query("select precisa_completar_cadastro ok from profiles where id=$1", [interno]))
        .rows[0].ok,
      false,
    );
    console.log(
      "Primeiro acesso OK: aprovação real221, helpers/OIDs, bloqueio RLS, proteção contra PATCH/elevação, validação, duplicidade com rollback, gatilho real198, carteira/comissão/centros preservados, legado e reexecução.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
