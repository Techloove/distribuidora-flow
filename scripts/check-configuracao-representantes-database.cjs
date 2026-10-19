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
    await db.exec(
      fs.readFileSync(path.join(root, "db/fase238_primeiro_acesso_representante.sql"), "utf8"),
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','',false);insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${id(100)}','legado@example.test',now(),'{"nome":"Legado"}'),('${id(101)}','novo239@example.test',now(),'{"nome":"Novo"}');`,
    );
    await login(1);
    await db.query("select admin_decidir_cadastro_221($1,true,$2,$3,null)", [
      id(100),
      id(20),
      [id(10)],
    ]);
    const apply = () =>
      db.exec(
        fs.readFileSync(
          path.join(root, "db/fase239_configuracao_representantes_admin.sql"),
          "utf8",
        ),
      );
    await db.exec("reset role");
    await apply();
    await apply();
    await login(1);
    const list = async () =>
      (await db.query("select * from admin_configuracoes_representantes_239()")).rows;
    let rows = await list();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].pendencias, ["Definir e confirmar comissão"]);
    assert.equal(
      (await db.query("select ativo from profiles where id=$1", [id(100)])).rows[0].ativo,
      true,
      "Legado não desativado",
    );
    const configure = (centros, comissao) =>
      db.query("select admin_configurar_representante_239($1,$2,$3)", [id(20), centros, comissao]);
    await assert.rejects(configure([], 5), /centro de custo ativo/);
    await assert.rejects(configure([id(11)], 5), /centro de custo ativo/);
    await assert.rejects(configure([id(10)], null), /Defina a comissão/);
    await assert.rejects(configure([id(10)], 101), /Defina a comissão/);
    await assert.rejects(configure([id(10)], 0.001), /duas casas/);
    await configure([id(10)], 0); // Zero explícito é uma configuração válida.
    assert.deepEqual((await list())[0].pendencias, []);
    await db.query("select definir_centros_usuario($1,false,$2)", [id(100), []]);
    assert.deepEqual((await list())[0].pendencias, ["Definir centros de custo"]);
    await configure([id(10)], 7.5);
    await login(100);
    await assert.rejects(list(), /Somente administrador/);
    await assert.rejects(configure([id(10)], 99), /Somente administrador/);
    // O primeiro acesso continua preservando a comissão confirmada pelo administrador.
    const dados = {
      nome: "Legado Completo",
      tipo_pessoa: "PF",
      cnpj_cpf: "12345678909",
      telefone: "27999999999",
      logradouro: "Rua Um",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      cidade: "Venda Nova",
      uf: "ES",
      cep: "29375000",
    };
    const pessoa = (
      await db.query("select completar_meu_cadastro_238($1) id", [JSON.stringify(dados)])
    ).rows[0].id;
    await db.exec("reset role");
    assert.equal(
      Number(
        (await db.query("select comissao_percentual from pessoas where id=$1", [pessoa])).rows[0]
          .comissao_percentual,
      ),
      7.5,
    );
    await login(1);
    assert.deepEqual((await list())[0].pendencias, []);
    // Mudança posterior no Cadastro Unificado invalida a confirmação anterior.
    await db.exec(
      `reset role;update pessoas set comissao_percentual=8 where id='${pessoa}';set role authenticated;`,
    );
    assert.deepEqual((await list())[0].pendencias, ["Definir e confirmar comissão"]);
    await configure([id(10)], 8);
    await login(100);
    // O gatilho barra fraude mesmo se o invasor conseguisse um UPDATE fora das policies.
    await db.exec(
      `reset role;grant select,insert,update on representantes to authenticated;set role authenticated;`,
    );
    await assert.rejects(
      db.query(
        "update representantes set comissao_definida_em=now(),comissao_definida_por=$1 where id=$2",
        [id(100), id(20)],
      ),
      /Somente administrador/,
    );
    await assert.rejects(
      db.query(
        "insert into representantes(nome,comissao_definida_em,comissao_definida_por) values('Tentativa de confirmação',now(),$1)",
        [id(100)],
      ),
      /Somente administrador/,
    );
    await login(2);
    await assert.rejects(configure([id(10)], 10), /Somente administrador/);
    await login(1);
    // Clientes antigos não perdem a carteira e a RPC antiga não ignora a nova exigência.
    await assert.rejects(
      db.query("select admin_decidir_cadastro_221($1,true,null,$2,null)", [id(101), [id(10)]]),
      /definir e confirmar a comissão/,
    );
    const approve = (comissao, centros = [id(10)]) =>
      db.query("select admin_decidir_cadastro_239($1,true,null,$2,null,$3)", [
        id(101),
        centros,
        comissao,
      ]);
    await assert.rejects(approve(null), /Defina a comissão/);
    await assert.rejects(approve(3, []), /centros/);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from representantes")).rows[0].n,
      1,
      "Tentativa inválida reverte representante e comissão",
    );
    assert.equal(
      (await db.query("select cadastro_status from profiles where id=$1", [id(101)])).rows[0]
        .cadastro_status,
      "pendente",
    );
    await login(1);
    await approve(3);
    rows = await list();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.pendencias.length === 0));
    await db.exec("reset role");
    const novo = (await db.query("select * from representantes where profile_id=$1", [id(101)]))
      .rows[0];
    assert.equal(Number(novo.comissao_percentual), 3);
    assert.equal(novo.comissao_definida_por, id(1));
    assert.equal(
      (await db.query("select precisa_completar_cadastro ok from profiles where id=$1", [id(101)]))
        .rows[0].ok,
      true,
    );
    await login(101);
    await db.query("select completar_meu_cadastro_238($1)", [
      JSON.stringify({ ...dados, nome: "Novo Completo", cnpj_cpf: "98765432100" }),
    ]);
    assert.equal((await db.query("select usuario_ativo() ok")).rows[0].ok, true);
    await db.exec("reset role");
    await apply();
    await login(1);
    assert.ok((await list()).every((r) => r.pendencias.length === 0));
    await db.exec("set role anon");
    await assert.rejects(list(), /permission denied/);
    console.log(
      "Configuração239 OK: admin exclusivo, centros ativos obrigatórios, comissão explícita inclusive zero, aprovação antiga protegida, rollback, pendências, revisão por alteração, espelhamento, primeiro acesso238 e reexecução.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
