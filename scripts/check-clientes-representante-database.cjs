const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table profiles(id uuid primary key,ativo boolean default true);
   create table user_roles(user_id uuid,role text);
   create table role_menus(role text,path text,primary key(role,path));
   create table permissoes(codigo text primary key,nome text,grupo text,ordem integer,modulo text);
   create table role_permissoes(role text,permissao text,primary key(role,permissao));
   create table centros(id uuid primary key,nome text,ativo boolean default true);
   create table usuario_centros(user_id uuid,centro_id uuid);
   create table representantes(id uuid primary key,nome text,profile_id uuid,pessoa_id uuid,ativo boolean default true);
   create table rotas(id uuid primary key,nome text,ativo boolean default true);
   create table representante_rotas(representante_id uuid,rota_id uuid);
   create function has_role(u uuid,r text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_roles where user_id=u and role=r)$$;
   create function can_manage(u uuid) returns boolean language sql security definer set search_path=public as $$select has_role(u,'admin') or has_role(u,'gestor')$$;
   create function usuario_ativo() returns boolean language sql security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and ativo)$$;
   create function escopo_representante() returns boolean language sql security definer set search_path=public as $$select has_role(auth.uid(),'representante') and not has_role(auth.uid(),'admin')$$;
   create function meu_representante_id() returns uuid language sql security definer set search_path=public as $$select id from representantes where profile_id=auth.uid() limit 1$$;
   create function usuario_pode_acessar_centro(c uuid) returns boolean language sql security definer set search_path=public as $$select usuario_ativo() and (c is null or exists(select 1 from usuario_centros where user_id=auth.uid() and centro_id=c))$$;
   create table pessoas(id uuid primary key default gen_random_uuid(),razao_social text not null,nome_fantasia text,tipo_pessoa text default 'PJ',cnpj_cpf text unique,inscricao_estadual text,email text,telefone text,
    logradouro text,numero text,complemento text,bairro text,cidade text,uf text,cep text,codigo_ibge text,observacoes text,centro_id uuid,rota_id uuid,
    is_cliente boolean default false,is_fornecedor boolean default false,is_representante boolean default false,is_usuario boolean default false,is_transportadora boolean default false,profile_id uuid,
    representante_id uuid,limite_credito numeric(14,2) default 0,condicao_pagamento text,tabela_preco text,status text default 'ativo',ativo boolean default true,created_at timestamptz default now());
   create table clientes(like pessoas including defaults);alter table clientes add primary key(id);alter table clientes add column pessoa_id uuid unique references pessoas(id);
   create table fornecedores(id uuid,pessoa_id uuid,ativo boolean);create table transportadoras(id uuid,pessoa_id uuid,ativo boolean);
   create table pedidos(id uuid primary key default gen_random_uuid(),cliente_id uuid references clientes(id),representante_id uuid,centro_id uuid,data_pedido date,total_liquido numeric,status text,tipo_documento text default 'pedido');
   create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
   create function agenda_cliente_acessivel_228(c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from clientes where id=c and representante_id=meu_representante_id() and usuario_pode_acessar_centro(centro_id))$$;
   grant usage on schema public,auth to authenticated,anon;grant all on all tables in schema public to authenticated;
  `);
    const load = (file, name, end = "$$;") => {
      const sql = readFileSync(file, "utf8"),
        start = sql.toLowerCase().indexOf("create or replace function public." + name + "(");
      assert(start >= 0, name);
      return db.exec(sql.slice(start, sql.indexOf(end, start) + end.length));
    };
    await load("db/fase211_acessos_rotinas.sql", "pode_rotina");
    await load("db/fase198_cliente_espelha_centro_rota.sql", "sincronizar_pessoa", "$function$;");
    await db.exec(`create trigger trg_sincronizar_pessoa after insert or update on pessoas for each row execute function sincronizar_pessoa();
   insert into profiles(id) values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}'),('${id(5)}'),('${id(6)}');
   update profiles set ativo=false where id='${id(6)}';
   insert into user_roles values('${id(1)}','representante'),('${id(2)}','representante'),('${id(3)}','admin'),('${id(4)}','gestor'),('${id(5)}','representante'),('${id(6)}','representante');
   insert into role_menus values('representante','/pessoas');
   insert into centros values('${id(10)}','Loja A',true),('${id(20)}','Loja B',true);
   insert into usuario_centros values('${id(1)}','${id(10)}'),('${id(2)}','${id(10)}'),('${id(3)}','${id(10)}'),('${id(3)}','${id(20)}'),('${id(4)}','${id(10)}'),('${id(5)}','${id(10)}'),('${id(6)}','${id(10)}');
   insert into representantes values('${id(100)}','A','${id(1)}',null,true),('${id(200)}','B','${id(2)}',null,true),('${id(600)}','Inativo','${id(6)}',null,true);
   insert into rotas values('${id(11)}','Rota compartilhada',true),('${id(22)}','Outra rota',true);
   insert into representante_rotas values('${id(100)}','${id(11)}'),('${id(200)}','${id(11)}'),('${id(200)}','${id(22)}');
   insert into pessoas(id,razao_social,cnpj_cpf,is_cliente,representante_id,centro_id,rota_id,limite_credito) values
    ('${id(101)}','Legado A','11111111111',true,'${id(100)}','${id(10)}','${id(11)}',500),
    ('${id(201)}','Legado B','22222222222',true,'${id(200)}','${id(10)}','${id(11)}',500),
    ('${id(102)}','Loja sem acesso','33333333333',true,'${id(100)}','${id(20)}','${id(11)}',500);
  `);
    await db.exec(readFileSync("db/fase206_carteira_representante.sql", "utf8"));
    await db.exec(
      "create policy operacao_pedidos on pedidos for all to authenticated using(true) with check(true)",
    );
    await db.exec(readFileSync("db/fase200_cliente_todos_centros.sql", "utf8"));
    await db.exec(
      `insert into pessoas(id,razao_social,is_cliente,limite_credito) values('${id(103)}','Compartilhado legado',true,500)`,
    );
    const lojasMigration = readFileSync("db/fase287_cliente_vinculo_loja.sql", "utf8");
    await db.exec(lojasMigration);
    await db.exec(lojasMigration);
    assert.equal(
      (await db.query("select loja_pendente from pessoas where id=$1", [id(103)])).rows[0]
        .loja_pendente,
      false,
    );
    const migration = readFileSync("db/fase284_clientes_representante_credito_painel.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    for (const table of ["pessoas", "clientes"])
      await db.exec(
        `alter table ${table} enable row level security;create policy carteira on ${table} for all to authenticated using(usuario_ativo() and (not escopo_representante() or representante_id=meu_representante_id()) and usuario_pode_acessar_centro(centro_id)) with check(usuario_ativo() and (not escopo_representante() or representante_id=meu_representante_id()) and usuario_pode_acessar_centro(centro_id));`,
      );
    const login = (n) =>
      db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`,
      );
    const dados = {
      razao_social: "Novo cliente",
      cnpj_cpf: "52998224725",
      centro_id: id(10),
      rota_id: id(11),
    };
    const cadastrar = (d = dados) =>
      db.query("select cadastrar_cliente_representante_284($1) id", [d]);
    const liberar = (p, v) => db.query("select liberar_credito_cliente_284($1,$2)", [p, v]);
    await login(1);
    for (const patch of [
      { limite_credito: "500" },
      { representante_id: id(200) },
      { credito_pendente: "false" },
      { status: "ativo" },
    ])
      await assert.rejects(cadastrar({ ...dados, ...patch }), /Campo de cadastro inválido/);
    await assert.rejects(cadastrar({ ...dados, centro_id: id(20) }), /loja permitida/);
    await assert.rejects(cadastrar({ ...dados, rota_id: id(22) }), /rota vinculada/);
    await assert.rejects(cadastrar({ ...dados, cnpj_cpf: "123" }), /11 ou 14/);
    const pessoa = (await cadastrar()).rows[0].id;
    const opcoes = async () =>
      (await db.query("select rotas_cadastro_representante_284() r")).rows[0].r;
    assert.deepEqual(
      (await opcoes()).map((r) => r.id),
      [id(11)],
    );
    await db.exec(`reset role;delete from representante_rotas where representante_id='${id(100)}'`);
    await login(1);
    assert.deepEqual(
      (await opcoes()).map((r) => r.id),
      [id(11)],
      "Rotas da carteira continuam disponíveis sem vínculo adicional",
    );
    await db.exec("begin");
    const direto = (
      await db.query(
        "insert into pessoas(razao_social,cnpj_cpf,is_cliente,representante_id,centro_id,rota_id,credito_pendente,status) values('Direto','11144477735',true,$1,$2,$3,false,'ativo') returning credito_pendente,status,limite_credito",
        [id(100), id(10), id(11)],
      )
    ).rows[0];
    assert.equal(direto.credito_pendente, true);
    assert.equal(direto.status, "bloqueado");
    assert.equal(direto.limite_credito, "0.00");
    await db.exec("rollback");
    await login(2);
    const outraPessoa = (await cadastrar({ ...dados, cnpj_cpf: "12345678000195" })).rows[0].id;
    await login(1);
    await assert.rejects(
      db.query(
        "insert into clientes(razao_social,pessoa_id,representante_id,centro_id,rota_id,status) values('Forjado',$1,$2,$3,$4,'bloqueado')",
        [outraPessoa, id(100), id(10), id(11)],
      ),
      /cadastro unificado/,
    );
    let p = (await db.query("select * from pessoas where id=$1", [pessoa])).rows[0];
    assert.equal(p.credito_pendente, true);
    assert.equal(p.limite_credito, "0.00");
    assert.equal(p.status, "bloqueado");
    assert.equal(p.representante_id, id(100));
    const cliente = (await db.query("select * from clientes where pessoa_id=$1", [pessoa])).rows[0];
    assert.equal(cliente.status, "bloqueado");
    assert.equal(cliente.representante_id, id(100));
    assert.equal(cliente.limite_credito, "0.00");
    await assert.rejects(cadastrar(), /Já existe cadastro/);
    for (const t of ["pessoas", "clientes"]) {
      const key = t === "pessoas" ? pessoa : cliente.id;
      await assert.rejects(
        db.query(`update ${t} set limite_credito=100 where id=$1`, [key]),
        /administrador/,
      );
      await assert.rejects(
        db.query(`update ${t} set status='ativo' where id=$1`, [key]),
        /administrador|liberação/,
      );
      await assert.rejects(db.query(`delete from ${t} where id=$1`, [key]), /excluir/);
    }
    await assert.rejects(
      db.query("update pessoas set credito_pendente=false where id=$1", [pessoa]),
      /administrador/,
    );
    await assert.rejects(
      db.query("update pessoas set is_usuario=true where id=$1", [pessoa]),
      /funções/,
    );
    await assert.rejects(
      db.query("update pessoas set rota_id=$1 where id=$2", [id(22), pessoa]),
      /fora da sua carteira/,
    );
    await assert.rejects(
      db.query("update clientes set rota_id=$1 where id=$2", [id(22), cliente.id]),
      /fora da sua carteira/,
    );
    await assert.rejects(liberar(pessoa, 100), /administrador/);
    const order = (
      await db.query(
        "insert into pedidos(cliente_id,representante_id,centro_id,status,data_pedido,total_liquido) values($1,$2,$3,'rascunho','2026-01-01',25) returning id",
        [cliente.id, id(100), id(10)],
      )
    ).rows[0].id;
    for (const status of ["aprovado", "confirmado", "faturado"])
      await assert.rejects(
        db.query("update pedidos set status=$1 where id=$2", [status, order]),
        /liberar o limite/,
      );
    await login(3);
    await assert.rejects(
      db.query("update pedidos set status='confirmado' where id=$1", [order]),
      /liberar o limite/,
    );
    for (const v of [0, -1, "NaN", 100.001])
      await assert.rejects(liberar(pessoa, v), /limite positivo/);
    await liberar(pessoa, 1234.56);
    p = (await db.query("select * from pessoas where id=$1", [pessoa])).rows[0];
    assert.equal(p.credito_pendente, false);
    assert.equal(p.status, "ativo");
    assert.equal(p.limite_credito, "1234.56");
    assert.equal(
      (await db.query("select limite_credito from clientes where id=$1", [cliente.id])).rows[0]
        .limite_credito,
      "1234.56",
    );
    await assert.rejects(liberar(pessoa, 2000), /pendente indisponível/);
    await db.query("update pedidos set status='confirmado' where id=$1", [order]);
    await login(4);
    await assert.rejects(liberar(pessoa, 500), /administrador/);
    await login(5);
    await assert.rejects(cadastrar(), /não liberado/);
    await login(6);
    await assert.rejects(cadastrar(), /não liberado/);
    await login(2);
    assert.equal((await db.query("select id from pessoas where id=$1", [pessoa])).rows.length, 0);
    await assert.rejects(liberar(pessoa, 500), /administrador/);
    await db.exec(`reset role;insert into user_roles values('${id(1)}','gestor');`);
    await login(1);
    await assert.rejects(
      db.query("update pessoas set limite_credito=9999 where id=$1", [pessoa]),
      /administrador/,
    );
    await db.exec(`reset role;delete from user_roles where user_id='${id(1)}' and role='gestor';
   insert into pedidos(cliente_id,representante_id,centro_id,data_pedido,total_liquido,status,tipo_documento) select c.id,c.representante_id,c.centro_id,'2026-02-01',100,'separado','pedido' from clientes c where c.pessoa_id='${id(101)}';
   insert into pedidos(cliente_id,representante_id,centro_id,data_pedido,total_liquido,status) select c.id,c.representante_id,c.centro_id,'2026-02-02',9999,'confirmado' from clientes c where c.pessoa_id in ('${id(201)}','${id(102)}');
   insert into pedidos(cliente_id,representante_id,centro_id,data_pedido,total_liquido,status,tipo_documento) select c.id,c.representante_id,c.centro_id,'2026-02-03',9999,'confirmado','orcamento' from clientes c where c.pessoa_id='${id(101)}';
   insert into pedidos(cliente_id,representante_id,centro_id,data_pedido,total_liquido,status) select c.id,c.representante_id,c.centro_id,'2026-03-01',9999,'cancelado' from clientes c where c.pessoa_id='${id(101)}';
  `);
    await login(1);
    const painel = async (ano = 2026, centro = id(10)) =>
      (await db.query("select painel_vendas_representante_284($1,$2) p", [ano, centro])).rows[0].p;
    const r = await painel();
    assert.equal(r.meses.length, 12);
    assert.equal(r.total, 125);
    assert.equal(r.meses[0].valor, 25);
    assert.equal(r.meses[1].valor, 100);
    assert.equal(r.meses[2].valor, 0);
    assert.equal(r.carteira, 2);
    assert.equal(r.credito_pendente, 0);
    await assert.rejects(painel(2026, id(20)), /sem acesso/);
    await assert.rejects(painel(1999), /Ano inválido/);
    assert.equal((await painel(2025)).total, 0);
    await db.exec("reset role;delete from role_permissoes where permissao='clientes_cadastrar'");
    await db.exec(migration);
    await login(1);
    await assert.rejects(cadastrar({ ...dados, cnpj_cpf: "11144477735" }), /não liberado/);
    await db.exec("reset role;delete from role_menus where path='/dashboard'");
    await db.exec(migration);
    await login(1);
    await assert.rejects(painel(), /não liberado/);
    await db.exec("reset role;set role anon");
    await assert.rejects(cadastrar(), /permission denied/);

    await login(3);
    await db.query("update pessoas set loja_pendente=true,centro_id=null where id=$1", [id(103)]);
    const novoSemLoja = (await db.query("select * from clientes where pessoa_id=$1", [id(103)]))
      .rows[0];
    assert.equal(novoSemLoja.loja_pendente, true);
    assert.equal(novoSemLoja.centro_id, null);
    await assert.rejects(
      db.query("insert into pedidos(cliente_id,centro_id,status) values($1,$2,'rascunho')", [
        novoSemLoja.id,
        id(10),
      ]),
      /Cliente sem loja/,
    );
    await assert.rejects(
      db.query("update clientes set loja_pendente=false where id=$1", [novoSemLoja.id]),
      /Cadastro unificado/,
    );
    await assert.rejects(
      db.query("update pessoas set centro_id=$1 where id=$2", [id(10), id(103)]),
      /sem loja/,
    );
    await db.query("update pessoas set loja_pendente=false,centro_id=$1 where id=$2", [
      id(10),
      id(103),
    ]);
    assert.equal(
      (await db.query("select loja_pendente from clientes where id=$1", [novoSemLoja.id])).rows[0]
        .loja_pendente,
      false,
    );
    const pedidoTeste = (
      await db.query(
        "insert into pedidos(cliente_id,centro_id,status) values($1,$2,'rascunho') returning id",
        [novoSemLoja.id, id(10)],
      )
    ).rows[0].id;
    await db.query("update pessoas set loja_pendente=false,centro_id=null where id=$1", [id(103)]);
    assert.equal(
      (await db.query("select centro_id from clientes where id=$1", [novoSemLoja.id])).rows[0]
        .centro_id,
      null,
    );
    await db.query("update pessoas set loja_pendente=true where id=$1", [id(103)]);
    await assert.rejects(
      db.query("update pedidos set status='aprovado' where id=$1", [pedidoTeste]),
      /Cliente sem loja/,
    );
    await db.query("update pedidos set status='cancelado' where id=$1", [pedidoTeste]);
    await db.exec("reset role");
    const entregue = (
      await db.query(
        "insert into pedidos(cliente_id,centro_id,status,tipo_documento) values($1,$2,'em_rota','orcamento') returning id",
        [novoSemLoja.id, id(10)],
      )
    ).rows[0].id;
    await db.query("update pedidos set tipo_documento='pedido',status='entregue' where id=$1", [
      entregue,
    ]);
    await login(4);
    await db.query("update pessoas set loja_pendente=false,centro_id=null where id=$1", [id(103)]);
    await login(1);
    await assert.rejects(
      db.query("update pessoas set loja_pendente=true,centro_id=null where id=$1", [id(101)]),
      /permissão/,
    );
    // Fase334: cadastro real pelo representante, pedido na fila e decisão administrativa.
    await db.exec(`reset role;
      insert into role_permissoes values('representante','clientes_cadastrar') on conflict do nothing;
      create table efeitos334(tipo text);grant select on efeitos334 to authenticated;
      create function confirmar_pedido(_pedido_id uuid) returns pedidos language plpgsql security definer set search_path=public as $$declare ped pedidos;begin
        select * into ped from public.pedidos where id = _pedido_id for update;
        insert into efeitos334 values('estoque'),('financeiro'),('comissao');
        update pedidos set status='confirmado' where id=_pedido_id returning * into ped;return ped;end $$;
      create function avancar_pedido(_pedido_id uuid,_novo_status text) returns pedidos language plpgsql security definer set search_path=public as $$declare ped pedidos;begin
        select * into ped from public.pedidos where id = _pedido_id for update;
        update pedidos set status=_novo_status where id=_pedido_id returning * into ped;return ped;end $$;
      create function validar_pedido(_pedido_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare cli clientes;begin
        select c.* into cli from clientes c join pedidos p on p.cliente_id=c.id where p.id=_pedido_id;
        return jsonb_build_object('nivel','bloqueio','mensagem','Cliente bloqueado no cadastro');end $$;
    `);
    const cadastro334 = readFileSync("db/fase334_pedido_cliente_cadastro_pendente.sql", "utf8");
    await db.exec(cadastro334);
    await db.exec(cadastro334);
    await login(1);
    const novo334 = (await cadastrar({ ...dados, cnpj_cpf: "98765432000198" })).rows[0].id;
    const cli334 = (await db.query("select id from clientes where pessoa_id=$1", [novo334])).rows[0]
      .id;
    const ped334 = (
      await db.query(
        "insert into pedidos(cliente_id,centro_id,representante_id,status,total_liquido) values($1,$2,$3,'rascunho',100) returning id",
        [cli334, id(10), id(100)],
      )
    ).rows[0].id;
    await db.query("select avancar_pedido($1,'aguardando_aprovacao')", [ped334]);
    await db.query("update pedidos set total_liquido=150 where id=$1", [ped334]);
    assert.match(
      (await db.query("select validar_pedido($1) v", [ped334])).rows[0].v.mensagem,
      /Aguardando aprovação de cadastro/,
    );
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [ped334]),
      /Aguardando aprovação de cadastro/,
    );
    await assert.rejects(liberar(novo334, 500), /administrador/);
    await login(2);
    assert.equal((await db.query("select id from pedidos where id=$1", [ped334])).rows.length, 0);
    await login(3);
    await assert.rejects(
      db.query("select avancar_pedido($1,'aprovado')", [ped334]),
      /Aguardando aprovação de cadastro/,
    );
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [ped334]),
      /Aguardando aprovação de cadastro/,
    );
    await assert.rejects(
      db.query("update pedidos set status='aprovado' where id=$1", [ped334]),
      /Aguardando aprovação de cadastro/,
    );
    assert.equal((await db.query("select * from efeitos334")).rows.length, 0);
    await liberar(novo334, 500);
    assert.equal(
      (await db.query("select status from pedidos where id=$1", [ped334])).rows[0].status,
      "aguardando_aprovacao",
    );
    await db.query("select avancar_pedido($1,'aprovado')", [ped334]);
    await db.query("select confirmar_pedido($1)", [ped334]);
    assert.equal((await db.query("select * from efeitos334")).rows.length, 3);
    // Fase336: representante sem consulta de rotas cadastra e monta pedido pendente.
    await db.exec(`reset role;
      alter table pedidos add column rota_id uuid,add column forma_pagamento_id uuid,add column previsao_entrega date,add column observacoes text,add column numero bigserial;
      alter table pedidos alter column status set default 'rascunho';
      alter table clientes add column sequencia_entrega integer;
      create table formas_pagamento(id uuid,ativo boolean);insert into formas_pagamento values('${id(30)}',true);
      create function can_operate(u uuid) returns boolean language sql security definer set search_path=public as $$select usuario_ativo() and (has_role(u,'admin') or has_role(u,'representante') or has_role(u,'gestor'))$$;
      create function rota_por_cidade(text,text) returns uuid language sql as $$select '${id(22)}'::uuid$$;
      create function sequencia_por_cidade(text,text) returns integer language sql as $$select 1$$;
      insert into profiles(id) values('${id(7)}');insert into user_roles values('${id(7)}','representante');
      insert into representantes values('${id(700)}','Sem rotas','${id(7)}',null,true);
      insert into usuario_centros values('${id(7)}','${id(10)}');
    `);
    await load("db/fase50_rota_cidades.sql", "cliente_rota_por_cidade");
    await db.exec(
      "create trigger trg_cliente_rota_por_cidade before insert or update of cidade,uf,rota_id on clientes for each row execute function cliente_rota_por_cidade()",
    );
    await load("db/fase81_hardening_crud_pedidos.sql", "criar_pedido_rascunho");
    await db.exec(readFileSync("db/fase206_carteira_representante.sql", "utf8"));
    const cadastro336 = readFileSync("db/fase336_cadastro_representante_sem_rota.sql", "utf8");
    await db.exec(cadastro336);
    await db.exec(cadastro336);
    await db.exec(
      "revoke all on rotas from authenticated;revoke execute on function rotas_cadastro_representante_284() from authenticated",
    );
    await login(7);
    await assert.rejects(db.query("select * from rotas"), /permission denied/);
    await assert.rejects(
      db.query("select rotas_cadastro_representante_284()"),
      /permission denied/,
    );
    const semRota = { ...dados, cnpj_cpf: "96765432000190", cidade: "Cidade sem rota acessível" };
    delete semRota.rota_id;
    const pessoa336 = (await cadastrar(semRota)).rows[0].id;
    const cliente336 = (await db.query("select * from clientes where pessoa_id=$1", [pessoa336]))
      .rows[0];
    assert.equal(cliente336.rota_id, null);
    assert.equal(cliente336.status, "bloqueado");
    assert.equal(
      (await db.query("select credito_pendente from pessoas where id=$1", [pessoa336])).rows[0]
        .credito_pendente,
      true,
    );
    await assert.rejects(
      cadastrar({ ...semRota, cnpj_cpf: "96765432000191", rota_id: id(22) }),
      /Rota fora/,
    );
    const pedido336 = (
      await db.query(
        "select (criar_pedido_rascunho($1,$2,null,$3,current_date,null,null,null)).id id",
        [cliente336.id, id(10), id(30)],
      )
    ).rows[0].id;
    await db.query("select avancar_pedido($1,'aguardando_aprovacao')", [pedido336]);
    assert.equal(
      (await db.query("select rota_id from pedidos where id=$1", [pedido336])).rows[0].rota_id,
      null,
    );
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [pedido336]),
      /Aguardando aprovação de cadastro/,
    );
    await assert.rejects(
      db.query("update pessoas set rota_id=$1 where id=$2", [id(22), pessoa336]),
      /Rota fora/,
    );
    await login(3);
    await assert.rejects(liberar(pessoa336, 500), /rota ativa/);
    await db.query("update pessoas set rota_id=$1 where id=$2", [id(11), pessoa336]);
    const pedidoComRota336 = (
      await db.query(
        "insert into pedidos(cliente_id,centro_id,representante_id,rota_id,status,numero) values($1,$2,$3,$4,'aguardando_aprovacao',336) returning id",
        [cliente336.id, id(10), id(700), id(22)],
      )
    ).rows[0].id;
    await liberar(pessoa336, 500);
    const revisado = (await db.query("select rota_id,status from pedidos where id=$1", [pedido336]))
      .rows[0];
    assert.equal(revisado.rota_id, id(11));
    assert.equal(revisado.status, "aguardando_aprovacao");
    assert.equal(
      (await db.query("select rota_id from pedidos where id=$1", [pedidoComRota336])).rows[0]
        .rota_id,
      id(22),
    );

    await db.query("update pedidos set rota_id=null where id=$1", [pedido336]);
    const efeitosAntes336 = (await db.query("select count(*) n from efeitos334")).rows[0].n;
    await assert.rejects(db.query("select confirmar_pedido($1)", [pedido336]), /rota ativa/);
    assert.equal((await db.query("select count(*) n from efeitos334")).rows[0].n, efeitosAntes336);
    await assert.rejects(
      db.query("select avancar_pedido($1,'aprovado')", [pedido336]),
      /rota ativa/,
    );
    await db.query("update pedidos set rota_id=$1 where id=$2", [id(11), pedido336]);
    await db.query("select avancar_pedido($1,'aprovado')", [pedido336]);
    await login(7);
    await assert.rejects(
      db.query("select criar_pedido_rascunho($1,$2,null,$3,current_date,null,null,null)", [
        cliente336.id,
        id(10),
        id(30),
      ]),
      /Rota de entrega obrigatoria/,
    );
    console.log(
      "Clientes/representante OK: carteira e lojas, crédito pendente, espelho real198, aprovação exclusiva, cadastro sem acesso a rotas336, revisão de rota e pedido pendente íntegros, pedidos aguardando cadastro334, bloqueio antecipado sem efeitos, liberação sem confirmação automática, vendas mensais isoladas, revogações e reexecução preservadas.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
