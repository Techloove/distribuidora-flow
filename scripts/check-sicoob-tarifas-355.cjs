// Sicoob: banco descartável, Vault simulado e nenhuma chamada de rede bancária.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema vault;
create function auth.uid() returns uuid language sql as $$select coalesce(nullif(current_setting('test.actor',true),''),'${id(1)}')::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('test.jwtrole',true),''),'service_role')$$;
create table profiles(id uuid primary key,ativo boolean default true,precisa_completar_cadastro boolean default false,todos_centros boolean default false);
create table user_roles(user_id uuid,role text);create table usuario_centros(user_id uuid,centro_id uuid);
create function has_role(uuid,text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_roles where user_id=$1 and role=$2)$$;
create function usuario_ativo() returns boolean language sql security definer set search_path=public as $$select coalesce((select ativo from profiles where id=auth.uid()),false)$$;
create function can_finance(uuid) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_roles where user_id=$1 and role in('admin','gestor','financeiro'))$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql security definer set search_path=public as $$select has_role(auth.uid(),'admin') or exists(select 1 from usuario_centros where user_id=auth.uid() and centro_id=$1)$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql security definer set search_path=public as $$select can_finance($1) and (has_role($1,'admin') or exists(select 1 from usuario_centros where user_id=$1 and centro_id=$2))$$;
create function status_comissao_valido_302(text,text) returns boolean language sql as $$select $2='pedido' and $1 in('aprovado','conferido','faturado','entregue')$$;
create function bloqueio_boleto(uuid) returns text language sql as $$select nullif(current_setting('test.bloqueio',true),'')$$;
create table centros(id uuid primary key,nome text,ativo boolean default true);
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo boolean default true);
create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);
create table role_menus(role text,path text);create table role_permissoes(role text,permissao text,primary key(role,permissao));
create table pedidos(id uuid primary key,centro_id uuid,status text,tipo_documento text);
create table contas_receber(id uuid primary key,centro_id uuid,cliente_id uuid,pedido_id uuid,status text,documento text,parcela int,valor numeric,juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0,valor_pago numeric default 0,vencimento date);
create table boletos(id uuid primary key default gen_random_uuid(),conta_receber_id uuid,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,banco text,canal text,seu_numero text,nosso_numero text,valor numeric,vencimento date,data_emissao date,status text,tentativas int,enviado_em timestamptz,created_by uuid,ambiente text,conta_cobranca_id uuid,retorno jsonb,erro text,linha_digitavel text,codigo_barras text,created_at timestamptz default now());
create unique index boletos_conta_ativa_uq on boletos(conta_receber_id) where status in('pendente','em_processamento','registrado','liquidado');
create table cobranca_centros(centro_id uuid primary key references centros(id),banco text,canal text,ativo boolean,conta_financeira_id uuid,updated_at timestamptz default now(),constraint cobranca_centros_check check(banco='sicredi' and canal='api' or banco<>'sicredi' and canal='pendente' and not ativo));
create table auditoria(id uuid default gen_random_uuid(),tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default null,new_key_id uuid default null) returns uuid language plpgsql as $$declare ident uuid;begin insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into ident;return ident;end$$;
create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null) returns void language sql as $$update vault.secrets set secret=coalesce(new_secret,secret) where id=secret_id$$;
grant usage on schema auth to authenticated,service_role;
insert into profiles(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');insert into user_roles values('${id(1)}','admin'),('${id(2)}','financeiro'),('${id(3)}','financeiro');insert into usuario_centros values('${id(2)}','${id(10)}'),('${id(3)}','${id(11)}');
insert into centros values('${id(10)}','Cimento',true),('${id(11)}','Ferragens',true);
insert into contas_financeiras values('${id(70)}','${id(10)}',true),('${id(71)}','${id(11)}',true);
insert into cobranca_centros values('${id(11)}','sicredi','api',true,'${id(71)}',now());
insert into role_menus values('admin','/boletos'),('financeiro','/boletos');
insert into pedidos values('${id(30)}','${id(10)}','conferido','pedido');
insert into contas_receber(id,centro_id,cliente_id,pedido_id,status,documento,parcela,valor,vencimento) values('${id(40)}','${id(10)}','${id(20)}','${id(30)}','aberto','PED-30',1,100,'2027-01-20');
`);
    await db.exec(`alter table contas_financeiras add column nome text default 'Conta da fixture';
create table categorias_financeiras(id uuid primary key,nome text,tipo text,grupo_dre text,parent_id uuid,ativo boolean default true);
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric,categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,status text default 'ativo');
create function pode_rotina(text) returns boolean language sql as $$select true$$;
create schema cron;create table cron.job(jobname text primary key,schedule text);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1,$2);return 1;end$$;
create schema net;create table net.chamadas(url text,headers jsonb);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$begin insert into net.chamadas values(url,headers);return 1;end$$;
`);
    const q = async (s, a = []) => (await db.query(s, a)).rows;
    const scalar = async (s, a = []) => Object.values((await q(s, a))[0])[0];
    for (const f of [
      "fase316_sicoob_cobranca_v3.sql",
      "fase319_sicoob_ativacao_sandbox.sql",
      "fase320_sicoob_resposta_simulada.sql",
      "fase351_sicoob_condicoes_emissao.sql",
      "fase352_sicoob_extrato_leitura.sql",
    ])
      await db.exec(fs.readFileSync("db/" + f, "utf8"));
    const lancar = fs.readFileSync("db/fase71_perimetro_financeiro_centros.sql", "utf8");
    const p = lancar.indexOf("create or replace function public.lancar_movimento(");
    await db.exec(lancar.slice(p, lancar.indexOf("$$;", p) + 3));
    const migration = fs.readFileSync("db/fase355_sicoob_tarifas_financeiro.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const hoje = await scalar("select current_date::text");
    await q(
      "insert into categorias_financeiras values($1,'Tarifas bancárias','despesa','despesa_financeira',null,true)",
      [id(201)],
    );
    const cfg = { client_id: "cobranca-fixture", numero_cliente: 12345, numero_conta: 67890 };
    await q("select sicoob_config_salvar_316($1,$2,$3,$4,false,0,$5,'producao')", [
      id(1),
      id(10),
      cfg,
      id(70),
      { pfx: "falso", senha: "falsa" },
    ]);
    await q("select sicoob_extrato_salvar_352($1,$2,'extrato-fixture','67890',0,$3)", [
      id(1),
      id(10),
      { pfx: "falso", senha: "falsa" },
    ]);
    for (const [ident, nn, emitido] of [
      [210, "12345", true],
      [211, "891", false],
    ]) {
      await q(
        "insert into boletos(id,centro_id,banco,canal,ambiente,status,nosso_numero,valor,data_emissao,conta_cobranca_id,sicoob_snapshot_316) values($1,$2,'sicoob','api','producao','registrado',$3,100,current_date,$4,$5)",
        [id(ident), id(10), nn, id(70), { numero_conta: 67890 }],
      );
      if (emitido)
        await q(
          "insert into sicoob_operacoes_316(boleto_id,centro_id,tipo,chave,esperado,requisicao,motivo,created_by) values($1,$2,'emissao',gen_random_uuid(),'{}','{}','Fixture de emissão',$3)",
          [id(ident), id(10), id(1)],
        );
    }
    const contasAntes = await q("select to_jsonb(t) from contas_receber t order by id");
    const boletosAntes = await q("select to_jsonb(b) from boletos b order by id");
    await assert.rejects(
      () =>
        q("select sicoob_tarifas_salvar_355($1,$2,$3,current_date,true,0)", [
          id(2),
          id(10),
          id(201),
        ]),
      /administrador/,
    );
    await q("select sicoob_tarifas_salvar_355($1,$2,$3,current_date,true,0)", [
      id(1),
      id(10),
      id(201),
    ]);
    const reservar = async () => {
      await db.exec("update sicoob_extrato_config_352 set ultima_consulta='epoch'");
      return scalar("select sicoob_tarifas_reservar_355(null,$1,$2)", [id(1), id(10)]);
    };
    const finalizar = async (m) => {
      const r = await reservar();
      return scalar("select sicoob_tarifas_finalizar_355($1,$2)", [r.lease, m]);
    };
    const fee = (idv, nn = "12345", valor = 1.02, tipo = "DEBITO") => ({
      id: idv,
      nosso_numero: nn,
      valor,
      tipo,
      data: hoje,
      descricao: "TARIFA REGISTRO",
      documento: "nao-usar-como-referencia",
    });
    assert.equal(
      (
        await finalizar([
          fee("evt-novo-1"),
          fee("evt-antigo-1", "891"),
          fee("evt-sem-referencia", ""),
          fee("evt-credito", "12345", 1.02, "CREDITO"),
        ])
      ).lancados,
      1,
    );
    assert.equal(await scalar("select count(*)::int from sicoob_tarifas_financeiro_355"), 1);
    assert.equal((await finalizar([fee("evt-novo-1")])).lancados, 0);
    assert.equal((await finalizar([fee("evt-novo-2")])).lancados, 1);
    assert.equal(
      Number(await scalar("select sum(valor) from movimentos_financeiros where tipo='saida'")),
      2.04,
    );
    assert.equal((await finalizar([fee("evt-novo-1", "12345", 2.04)])).lancados, 0);
    assert.equal(
      await scalar(
        "select estado from sicoob_tarifas_financeiro_355 where transaction_id='evt-novo-1'",
      ),
      "retorno_divergente",
    );
    await db.exec(
      "update movimentos_financeiros set status='estornado' where id=(select movimento_id from sicoob_tarifas_financeiro_355 where transaction_id='evt-novo-2')",
    );
    await finalizar([fee("evt-novo-2")]);
    assert.equal(
      await scalar(
        "select estado from sicoob_tarifas_financeiro_355 where transaction_id='evt-novo-2'",
      ),
      "estornado",
    );
    await q(
      "insert into movimentos_financeiros(conta_id,data,tipo,valor,centro_id) values($1,current_date,'saida',3,$2)",
      [id(70), id(10)],
    );
    assert.equal((await finalizar([fee("evt-manual", "12345", 3)])).conferir, 1);
    assert.equal(await scalar("select count(*)::int from movimentos_financeiros"), 3);
    assert.deepEqual(await q("select to_jsonb(t) from contas_receber t order by id"), contasAntes);
    assert.deepEqual(await q("select to_jsonb(b) from boletos b order by id"), boletosAntes);
    assert.equal(
      await scalar(
        "select has_function_privilege('authenticated','sicoob_tarifas_finalizar_355(uuid,jsonb,text)','execute')",
      ),
      false,
    );
    if (process.argv.includes("--liqui"))
      await require("./check-sicoob-tarifa-liqui-361.cjs")({
        db,
        q,
        scalar,
        id,
        reservar,
        finalizar,
        fee,
        hoje,
      });
    await q("select sicoob_tarifas_salvar_355($1,$2,$3,current_date,false,1)", [
      id(1),
      id(10),
      id(201),
    ]);
    assert.deepEqual(await reservar(), {});
    console.log(
      "OK355: somente emissão ERP; legado e sem referência excluídos; repetição idempotente; despesas iguais distintas preservadas; divergências, estorno e manual não duplicam; títulos e boletos preservados; pausa e permissões.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
