const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('teste.jwt_role',true),''),'authenticated')$$;
create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);create table role_permissoes(role text,permissao text);create table role_menus(role text,path text);create table user_roles(user_id uuid,role text);
create table profiles(id uuid primary key,ativo boolean,precisa_completar_cadastro boolean);insert into profiles values('${id(1)}',true,false);
create table centros(id uuid primary key,ativo boolean,cnpj text,nome text,uf text,inscricao_estadual text,logradouro text,numero text,bairro text,cidade text,cep text);
insert into centros values('${id(2)}',true,'12.345.678/0001-95','Loja teste','ES','123','Rua A','1','Centro','Vitória','29010001');
create table pessoas(id uuid primary key);
create table clientes(id uuid primary key,pessoa_id uuid,representante_id uuid,tipo_pessoa text,cnpj_cpf text,razao_social text,logradouro text,numero text,bairro text,cidade text,uf text,cep text,inscricao_estadual text);
insert into clientes values('${id(3)}',null,null,'PJ','12345678000195','Cliente','Rua','1','Centro','Vitória','ES','29010001','123');
create table representantes(id uuid primary key,profile_id uuid,ativo boolean);
create table produtos(id uuid primary key,codigo text,descricao text,unidade text);insert into produtos values('${id(4)}','1','Cimento','SC');
create table loja_produtos(centro_id uuid,produto_id uuid,disponivel boolean);insert into loja_produtos values('${id(2)}','${id(4)}',true);
create table pedidos(id uuid primary key,numero int,centro_id uuid,cliente_id uuid,representante_id uuid,status text,total_itens numeric,total_liquido numeric,frete_valor numeric,desconto_valor numeric,entrega_nome_recebedor text,comissao_valor numeric);
insert into pedidos values('${id(5)}',1,'${id(2)}','${id(3)}',null,'faturado',100,100,0,0,null,0);
create table pedido_itens(id uuid primary key,pedido_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric,total numeric,quantidade_separada numeric);
insert into pedido_itens values('${id(6)}','${id(5)}','${id(4)}',1,100,0,100,1);
create table contas_receber(id uuid primary key,pedido_id uuid,parcela int,valor numeric,vencimento date,status text);
create table notas_saida(id uuid primary key,pedido_id uuid,cliente_id uuid,centro_id uuid,status text,nf_numero text,serie text,chave_acesso text,protocolo text,mensagem_retorno text,valor_total numeric,retorno jsonb,autorizada_em timestamptz,data_emissao date,xml_url text,danfe_url text,updated_at timestamptz);
insert into notas_saida values('${id(7)}','${id(5)}','${id(3)}','${id(2)}','pendente',null,'1',null,null,null,100,null,null,current_date,null,null,now());
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create function usuario_ativo() returns boolean language sql as $$select true$$;
create function can_manage(uuid) returns boolean language sql as $$select true$$;
create function can_bill(uuid) returns boolean language sql as $$select current_setting('teste.negado',true) is distinct from 'true'$$;
create function has_role(uuid,text) returns boolean language sql as $$select $2='admin'$$;
create function pode_rotina(text) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(2)}'::uuid$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select $2='${id(2)}'::uuid$$;
create function produto_categoria_loja_246(uuid,uuid) returns boolean language sql as $$select true$$;
create function bloqueio_faturamento(uuid) returns text language sql as $$select null::text$$;
`);
  for (const file of [
    "fase256_preparacao_faznotas.sql",
    "fase257_conexao_faznotas.sql",
    "fase258_tributacao_produtos_faznotas.sql",
    "fase259_emissao_faznotas.sql",
  ])
    await db.exec(readFileSync("db/" + file, "utf8"));
  await db.exec(readFileSync("db/fase259_emissao_faznotas.sql", "utf8"));
  await db.exec(
    `select salvar_loja_fiscal_256('${id(2)}','1','ES','1','5102','6102',true);select salvar_conexao_faznotas_257('${id(2)}','12345678000195','FICTICIO-NAO-REAL');select liberar_faznotas_259('${id(2)}','homologacao',true);`,
  );
  await db.exec(`update loja_fiscal_256 set serie='2'`);
  assert.equal(
    (await db.query(`select estado_liberacao_nfe_259('${id(2)}') s`)).rows[0].s.atual,
    false,
  );
  await db.exec(`update loja_fiscal_256 set serie='1'`);
  let context = (await db.query(`select contexto_nfe_259('${id(7)}') c`)).rows[0].c;
  assert.equal(JSON.stringify(context).includes("FICTICIO-NAO-REAL"), false);
  const snapshot = {
    cnpj: "12345678000195",
    ambiente: "homologacao",
    emissao: { serie: "1", "numero-origem": "CPR-NFE-" + id(7) },
    produtos: [{ referencia: "PRODUTO-FICTICIO" }],
  };
  const reservar = () =>
    db.query("select reservar_nfe_259($1::uuid,$2::uuid,$3,$4::jsonb)", [
      id(1),
      id(7),
      context.versao,
      JSON.stringify(snapshot),
    ]);
  await assert.rejects(reservar(), /exclusiva do servidor/);
  await db.exec(`set teste.jwt_role='service_role'`);
  await reservar();
  await assert.rejects(reservar(), /já reservada/);
  const assumir = async (recuperar = false) =>
    (await db.query("select assumir_nfe_259($1::uuid,$2::uuid,$3) j", [id(1), id(7), recuperar]))
      .rows[0].j;
  let job = await assumir();
  assert.ok(job.lease);
  assert.equal(await assumir(), null);
  const etapa = (acao, retorno, pronto = null, lease = job.lease) =>
    db.query("select registrar_etapa_nfe_259($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,$6)", [
      id(1),
      id(7),
      lease,
      acao,
      JSON.stringify(retorno),
      pronto,
    ]);
  await assert.rejects(
    etapa("envio", { status: "001", data: { recibo: "forjado" } }, null, id(9)),
    /expirou/,
  );
  await assert.rejects(etapa("iniciar_envio", {}), /sincronização/);
  await etapa("produto", { status: "001" }, "PRODUTO-FICTICIO");
  await etapa("iniciar_envio", {});
  await etapa("envio", { status: "001", data: { recibo: "RECIBO-TESTE" } });
  assert.equal((await db.query("select status from notas_saida")).rows[0].status, "pendente");
  assert.equal(await assumir(), null); // intervalo mínimo cinco segundos
  await db.exec(
    `update faznotas_emissoes_259 set proxima_consulta=now()-interval '1 second';set teste.jwt_role='authenticated'`,
  );
  await assert.rejects(db.exec(`update notas_saida set status='autorizada'`), /alteração manual/);
  await assert.rejects(db.exec(`update pedidos set total_liquido=99`), /dados comerciais/);
  await db.exec(
    `update pedidos set status='entregue',entrega_nome_recebedor='Recebedor',comissao_valor=3`,
  );
  await assert.rejects(db.exec(`update pedido_itens set quantidade=2`), /Itens preservados/);
  await assert.rejects(
    db.exec(`select abortar_preparacao_nfe_259('${id(7)}')`),
    /tentativa de envio/,
  );
  await db.exec(`set teste.jwt_role='service_role'`);
  job = await assumir();
  await etapa("consulta", { status: "900", data: { sefaz: { codigo: "217" } } });
  assert.equal(
    (await db.query("select faznotas_estado from notas_saida")).rows[0].faznotas_estado,
    "processando",
  );
  await db.exec(`update faznotas_emissoes_259 set proxima_consulta=now()-interval '1 second'`);
  job = await assumir();
  // Chave: ES(32), AAMM, CNPJ14, modelo55, série001, número000000123, tipo1, código8, DV1.
  const chave = "32261012345678000195550010000001231000000001";
  assert.equal(chave.length, 44);
  await etapa("consulta", {
    status: "004",
    data: {
      sefaz: {
        codigo: "100",
        chave: chave.replace("12345678000195", "00000000000000"),
        protocolo: "123456789012345",
      },
    },
  });
  assert.equal((await db.query("select status from notas_saida")).rows[0].status, "pendente");
  assert.equal(
    (await db.query("select faznotas_estado from notas_saida")).rows[0].faznotas_estado,
    "incerta",
  );
  await db.exec(`update faznotas_emissoes_259 set proxima_consulta=now()-interval '1 second'`);
  job = await assumir(true);
  await etapa("consulta", {
    status: "004",
    data: {
      sefaz: {
        codigo: "100",
        chave,
        protocolo: "123456789012345",
        "url-danfe": "https://example.test/danfe",
        "url-xml": "https://example.test/xml",
        "data-emissao": "2026-10-21 12:00:00",
      },
    },
  });
  const nota = (await db.query("select * from notas_saida")).rows[0];
  assert.equal(nota.status, "autorizada");
  assert.equal(nota.nf_numero, "123");
  assert.equal(nota.protocolo, "123456789012345");
  assert.equal(nota.danfe_url, "https://example.test/danfe");
  assert.equal((await db.query("select status from pedidos")).rows[0].status, "entregue"); // não regride logística
  assert.equal(await assumir(), null);
  await db.exec(`update faznotas_emissoes_259 set proxima_consulta=now()-interval '1 second'`);
  job = await assumir(true);
  await etapa("falha", { descricao: "Erro temporário de rede" });
  assert.equal((await db.query("select status from notas_saida")).rows[0].status, "autorizada");
  assert.equal(
    (await db.query("select faznotas_estado from notas_saida")).rows[0].faznotas_estado,
    "autorizada",
  );
  assert.equal(
    (await db.query("select protocolo from notas_saida")).rows[0].protocolo,
    "123456789012345",
  );
  assert.equal(
    (await db.query("select count(*)::int n from auditoria where acao='faznotas_autorizada'"))
      .rows[0].n,
    1,
  );
  await db.exec(`set teste.jwt_role='authenticated';set teste.negado='true'`);
  await assert.rejects(db.exec(`select status_nfe_259('${id(7)}')`), /Sem permissão/);
  await db.exec(`set role authenticated`);
  await assert.rejects(db.exec("select * from faznotas_emissoes_259"), /permission denied/);
  // Fase260: agendamento real é validado por stubs locais, sem rede/extensões externas.
  await db.exec(`reset role;set teste.negado='false';set teste.jwt_role='service_role';
create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1);return 1;end$$;
create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
update faznotas_emissoes_259 set estado='processando',lease=null,lease_ate=null,proxima_consulta=now()-interval '1 minute';`);
  const auto = readFileSync("db/fase260_faznotas_consulta_automatica.sql", "utf8")
    .replace(/create extension if not exists pg_cron;/, "")
    .replace(/create extension if not exists pg_net with schema extensions;/, "");
  await db.exec(auto);
  await db.exec(auto);
  assert.equal((await db.query(`select count(*)::int n from cron.job`)).rows[0].n, 1);
  await assert.rejects(db.exec(`select faznotas_auto_reservar_260('errado')`), /Credencial/);
  const secret = (await db.query(`select segredo from faznotas_auto_config_260`)).rows[0].segredo;
  const claim = async () =>
    (await db.query("select faznotas_auto_reservar_260($1) j", [secret])).rows[0].j;
  const automatic = await claim();
  assert.equal(automatic.nota, id(7));
  assert.equal(automatic.actor, id(1));
  assert.equal(automatic.recibo, "RECIBO-TESTE");
  assert.equal(automatic.snapshot, undefined);
  assert.equal(await claim(), null);
  assert.equal(await assumir(), null);
  await db.exec(
    `update faznotas_auto_config_260 set bloqueado_ate=null;update faznotas_emissoes_259 set lease=null,lease_ate=null,recibo=null;`,
  );
  assert.equal(await claim(), null); // Não emite/reenvia sem recibo.
  await db.exec(
    `update faznotas_auto_config_260 set bloqueado_ate=null;update faznotas_emissoes_259 set recibo='RECIBO-TESTE';set teste.negado='true';`,
  );
  assert.equal(await claim(), null); // Acesso revogado impede o processamento.
  await db.exec(`set role authenticated`);
  await assert.rejects(db.exec("select * from faznotas_auto_config_260"), /permission denied/);
  await assert.rejects(
    db.exec(`select faznotas_auto_reservar_260('qualquer')`),
    /permission denied/,
  );

  // Fase261: troca local sem chamadas remotas e sem reutilização de credenciais.
  await db.exec(`reset role;set teste.negado='false';set teste.jwt_role='authenticated';`);
  const preparacao = readFileSync("db/fase261_preparacao_forecast_fiscal.sql", "utf8");
  await db.exec(preparacao);
  await db.exec(preparacao);
  let provider = (await db.query(`select estado_provedor_fiscal_261('${id(2)}') s`)).rows[0].s;
  assert.equal(provider.provedor, "forecastfiscal");
  assert.equal(provider.emissao_disponivel, false);
  assert.equal(provider.cnpj_vinculado, null);
  await db.exec(`select salvar_provedor_fiscal_261('${id(2)}','forecastfiscal')`);
  provider = (await db.query(`select estado_provedor_fiscal_261('${id(2)}') s`)).rows[0].s;
  assert.equal(provider.cnpj_vinculado, "12345678000195");
  assert.equal(provider.vinculo_atual, true);
  assert.equal(JSON.stringify(provider).includes("FICTICIO"), false);
  await assert.rejects(
    db.exec(`select salvar_provedor_fiscal_261('${id(2)}','faznotas')`),
    /Provedor inválido/,
  );
  await assert.rejects(db.exec(`select estado_provedor_fiscal_261('${id(8)}')`), /Sem acesso/);
  await db.exec(`update centros set cnpj='00.000.000/0001-00'`);
  assert.equal(
    (await db.query(`select estado_provedor_fiscal_261('${id(2)}') s`)).rows[0].s.vinculo_atual,
    false,
  );
  await db.exec(`update centros set cnpj='12.345.678/0001-95';set teste.jwt_role='service_role'`);
  assert.equal((await db.query(`select ativo from faznotas_auto_config_260`)).rows[0].ativo, false);
  assert.equal(
    (await db.query(`select liberado from faznotas_liberacao_259`)).rows[0].liberado,
    false,
  );
  await assert.rejects(
    db.exec(`insert into faznotas_emissoes_259 select * from faznotas_emissoes_259 limit 1`),
    /Novas emissões FAZNOTAS desativadas/,
  );
  await db.exec(`update faznotas_emissoes_259 set recibo=null`);
  await assert.rejects(
    db.exec(`update faznotas_emissoes_259 set estado='enviando'`),
    /Novas emissões FAZNOTAS desativadas/,
  );
  await assert.rejects(
    db.exec(`update faznotas_liberacao_259 set liberado=true`),
    /Novas emissões FAZNOTAS desativadas/,
  );
  // Recibos anteriores continuam consultáveis sem emissão nova.
  await db.exec(
    `update faznotas_emissoes_259 set recibo='RECIBO-TESTE',estado='processando',proxima_consulta=now()-interval '1 minute',lease=null,lease_ate=null`,
  );
  assert.ok((await assumir()).lease);
  await db.exec(`set teste.jwt_role='authenticated';set role authenticated`);
  await assert.rejects(db.exec("select * from loja_provedor_fiscal_261"), /permission denied/);
  await db.exec(
    `reset role;create or replace function has_role(uuid,text) returns boolean language sql as $$select false$$;`,
  );
  await assert.rejects(
    db.exec(`select salvar_provedor_fiscal_261('${id(2)}','suspenso')`),
    /Somente administrador/,
  );
  console.log(
    "Forecast261: preparação por loja, isolamento, sigilo, bloqueio de nova emissão FAZNOTAS e preservação de recibos verificados",
  );
  // Fase263: retirar APIs legadas sem perder os documentos da fixture completa.
  await db.exec(`create or replace function has_role(uuid,text) returns boolean language sql as $$select $2='admin'$$;
alter table cron.job add column jobid bigint generated always as identity;
create function cron.unschedule(bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=$1;return found;end$$;`);
  await db.exec(readFileSync("db/fase262_conexao_forecast_fiscal.sql", "utf8"));
  await db.exec(
    `select salvar_conexao_forecast_262('${id(2)}','12345678000195','FORECAST-FICTICIO','homologacao')`,
  );
  if (!process.argv.includes("--sem263")) {
    const antes263 = (
      await db.query(
        `select (select count(*) from notas_saida) notas,(select count(*) from faznotas_emissoes_259) emissoes,(select count(*) from faznotas_eventos_259) eventos,(select count(*) from auditoria) auditoria,(select count(*) from role_permissoes) papeis`,
      )
    ).rows[0];
    for (let i = 0; i < 2; i++)
      await db.exec(readFileSync("db/fase263_forecast_api_unica.sql", "utf8"));
    assert.deepEqual(
      (
        await db.query(
          `select (select count(*) from notas_saida) notas,(select count(*) from faznotas_emissoes_259) emissoes,(select count(*) from faznotas_eventos_259) eventos,(select count(*) from auditoria) auditoria,(select count(*) from role_permissoes) papeis`,
        )
      ).rows[0],
      antes263,
    );
    assert.equal((await db.query(`select count(*)::int n from cron.job`)).rows[0].n, 0);
    assert.equal(
      (await db.query(`select nome from permissoes where codigo='faturamento_emitir_nfe'`)).rows[0]
        .nome,
      "Emitir e acompanhar NF-e via Forecast Fiscal",
    );
    assert.equal(
      (await db.query(`select estado_provedor_fiscal_261('${id(2)}') e`)).rows[0].e.estado,
      "conexao_disponivel_emissao_bloqueada",
    );
    for (const cmd of [
      `select salvar_conexao_faznotas_257('${id(2)}','12345678000195','OUTRO')`,
      `select liberar_faznotas_259('${id(2)}','homologacao',true)`,
      `select assumir_nfe_259('${id(1)}','${id(7)}',true)`,
      `select reservar_nfe_259('${id(1)}','${id(7)}','versao','{}')`,
      `select registrar_etapa_nfe_259('${id(1)}','${id(7)}','${id(8)}','consulta','{}',null)`,
      `select faznotas_auto_disparar_260()`,
      `select faznotas_auto_reservar_260('segredo')`,
      `select abortar_preparacao_nfe_259('${id(7)}')`,
    ])
      await assert.rejects(db.exec(cmd), /Integração fiscal anterior removida/);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.exec("select * from faznotas_credenciais_257"), /permission denied/);
      await assert.rejects(
        db.exec(`select salvar_conexao_faznotas_257('${id(2)}','12345678000195','OUTRO')`),
        /permission denied/,
      );
      await assert.rejects(db.exec(`select faznotas_auto_disparar_260()`), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec(
      `set role authenticated;select salvar_conexao_forecast_262('${id(2)}','12345678000195','FORECAST-FICTICIO-2','homologacao')`,
    );
    const conexao263 = (await db.query(`select estado_conexao_forecast_262('${id(2)}') e`)).rows[0]
      .e;
    assert.equal(conexao263.token_configurado, true);
    assert.equal(conexao263.vinculo_atual, true);
    assert.equal(conexao263.emissao_disponivel, false);
    assert.ok(!JSON.stringify(conexao263).includes("FORECAST-FICTICIO"));
    await assert.rejects(db.exec(`select estado_conexao_forecast_262('${id(8)}')`), /Sem acesso/);
    await db.exec(
      `reset role;create or replace function has_role(uuid,text) returns boolean language sql as $$select false$$;`,
    );
    await assert.rejects(
      db.exec(
        `select salvar_conexao_forecast_262('${id(2)}','12345678000195','OUTRO','homologacao')`,
      ),
      /Somente administrador/,
    );
    console.log(
      "Forecast263: reaplicação, cron removido, APIs e credenciais antigas inacessíveis, histórico preservado, papéis inalterados e conexão Forecast isolada por loja verificados sem rede.",
    );
  }
  // Fase264: remover objetos definitivamente, com e sem a fase263.
  await db.exec(`reset role;create or replace function has_role(uuid,text) returns boolean language sql as $$select $2='admin'$$;
create or replace function admin_limpar_dados_interno_f130(text) returns text language sql as $$select array_to_string(array['sicredi_config','faznotas_credenciais_257','faznotas_auto_config_260','loja_provedor_fiscal_261','forecast_credenciais_262'],',')$$;`);
  const antes264 = (
    await db.query(
      `select (select jsonb_agg(to_jsonb(n)-'faznotas_estado'-'faznotas_recibo'-'faznotas_request_id') from notas_saida n) notas,(select jsonb_agg(to_jsonb(p)) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(p)) from pedido_itens p) itens,(select jsonb_agg(to_jsonb(p)) from produtos p) produtos,(select count(*) from auditoria) auditoria,(select jsonb_agg(to_jsonb(p)) from role_permissoes p) papeis,(select jsonb_agg(to_jsonb(p)) from forecast_credenciais_262 p) forecast,(select jsonb_agg(to_jsonb(p)) from loja_fiscal_256 p) fiscal`,
    )
  ).rows[0];
  // Verificar RESTRICT: dependência desconhecida deve abortar, sem remoção parcial.
  await db.exec("create view dependencia_local_teste as select faznotas_estado from notas_saida");
  await assert.rejects(
    db.exec(readFileSync("db/fase264_remocao_completa_faznotas.sql", "utf8")),
    /depend/,
  );
  await db.exec("rollback");
  assert.equal(
    (await db.query("select to_regclass('public.faznotas_credenciais_257') t")).rows[0].t,
    "faznotas_credenciais_257",
  );
  await db.exec("drop view dependencia_local_teste");
  for (let i = 0; i < 2; i++)
    await db.exec(readFileSync("db/fase264_remocao_completa_faznotas.sql", "utf8"));
  assert.deepEqual(
    (
      await db.query(
        `select (select jsonb_agg(to_jsonb(n)) from notas_saida n) notas,(select jsonb_agg(to_jsonb(p)) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(p)) from pedido_itens p) itens,(select jsonb_agg(to_jsonb(p)) from produtos p) produtos,(select count(*) from auditoria) auditoria,(select jsonb_agg(to_jsonb(p)) from role_permissoes p) papeis,(select jsonb_agg(to_jsonb(p)) from forecast_credenciais_262 p) forecast,(select jsonb_agg(to_jsonb(p)) from loja_fiscal_256 p) fiscal`,
      )
    ).rows[0],
    antes264,
  );
  for (const table of [
    "faznotas_credenciais_257",
    "faznotas_emissoes_259",
    "faznotas_eventos_259",
    "faznotas_liberacao_259",
    "faznotas_auto_config_260",
    "loja_produto_fiscal_258",
  ])
    assert.equal((await db.query("select to_regclass($1) t", ["public." + table])).rows[0].t, null);
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='notas_saida' and column_name like 'faznotas_%'`,
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%faznotas%' or p.proname like '%_258' or p.proname like '%_259' or p.proname like '%_260')`,
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await db.query(`select count(*)::int n from cron.job`)).rows[0].n, 0);
  assert.equal(
    (await db.query(`select admin_limpar_dados_interno_f130('teste') d`)).rows[0].d,
    "sicredi_config,loja_provedor_fiscal_261,forecast_credenciais_262",
  );
  await db.exec(`set role authenticated`);
  let apos264 = (await db.query(`select estado_conexao_forecast_262('${id(2)}') e`)).rows[0].e;
  assert.equal(apos264.token_configurado, true);
  assert.equal(apos264.vinculo_atual, true);
  assert.equal(apos264.emissao_disponivel, false);
  await db.exec(
    `select salvar_conexao_forecast_262('${id(2)}','12345678000195','FORECAST-FINAL-FICTICIO','homologacao');select salvar_loja_fiscal_256('${id(2)}','1','ES','1','5102','6102',true);`,
  );
  await assert.rejects(db.exec(`select estado_conexao_forecast_262('${id(8)}')`), /Sem acesso/);
  await assert.rejects(db.exec("select * from forecast_credenciais_262"), /permission denied/);
  await db.exec("reset role");
  // CRUD ordinário não pode continuar referenciando tabelas/colunas já removidas.
  await db.exec(
    `update pedidos set status=status;update pedido_itens set quantidade=quantidade;update notas_saida set mensagem_retorno=mensagem_retorno;`,
  );
  console.log(
    "Forecast264: remoção completa, reaplicação, rollback por dependência desconhecida, dados gerais intactos, Forecast e fiscal geral funcionais, isolamento por loja e ausência de objetos antigos verificados (sem263=" +
      process.argv.includes("--sem263") +
      ").",
  );
  // Fase265: contexto de homologação somente leitura, sem service role.
  await db.exec(`create function escopo_representante() returns boolean language sql as $$select current_setting('teste.carteira',true)='true'$$;
  create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select current_setting('teste.fora_carteira',true) is distinct from 'true'$$;`);
  for (let i = 0; i < 2; i++)
    await db.exec(readFileSync("db/fase265_previa_homologacao_forecast.sql", "utf8"));
  const conferir265 = async () =>
    (await db.query("select contexto_homologacao_forecast_265($1) c", [id(7)])).rows[0].c;
  const fotografia265 = async () =>
    (
      await db.query(
        `select (select jsonb_agg(to_jsonb(n)) from notas_saida n) notas,(select jsonb_agg(to_jsonb(p)) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(i)) from pedido_itens i) itens,(select count(*) from auditoria) auditoria,(select jsonb_agg(to_jsonb(c)) from forecast_credenciais_262 c) credenciais`,
      )
    ).rows[0];
  const antes265 = await fotografia265();
  await db.exec("set role authenticated");
  const previa265 = await conferir265();
  await conferir265();
  assert.equal(previa265.nota.id, id(7));
  assert.equal(previa265.loja.id, id(2));
  assert.equal(previa265.cliente.cnpj_cpf, "12345678000195");
  assert.equal(previa265.conexao.token_configurado, true);
  assert.equal(previa265.conexao.ambiente_declarado, "homologacao");
  assert.equal(previa265.itens.length, 1);
  assert.equal(previa265.itens[0].disponivel_loja, true);
  assert.ok(!JSON.stringify(previa265).includes("FICTICIO"));
  assert.equal(previa265.conexao.token, undefined);
  await assert.rejects(
    db.query("select contexto_homologacao_forecast_265($1)", [id(99)]),
    /Nota indisponível/,
  );
  await db.exec("set teste.carteira='true';set teste.fora_carteira='true'");
  await assert.rejects(conferir265(), /fora da carteira/);
  await db.exec("set teste.fora_carteira='false'");
  await conferir265();
  await db.exec("set teste.carteira='false';set teste.negado='true'");
  await assert.rejects(conferir265(), /Sem permissão/);
  await db.exec("set teste.negado='false';reset role");
  assert.deepEqual(await fotografia265(), antes265);
  await db.exec(`update profiles set precisa_completar_cadastro=true`);
  await assert.rejects(conferir265(), /Sem permissão/);
  await db.exec(`update profiles set precisa_completar_cadastro=false`);
  await db.exec(`update profiles set ativo=false`);
  await assert.rejects(conferir265(), /Sem permissão/);
  await db.exec(`update profiles set ativo=true`);
  await db.exec(`update notas_saida set centro_id='${id(99)}'`);
  await assert.rejects(conferir265(), /Nota indisponível/);
  await db.exec(`update notas_saida set centro_id='${id(2)}'`);
  await db.exec(
    `create or replace function can_manage(uuid) returns boolean language sql as $$select false$$;`,
  );
  await assert.rejects(conferir265(), /Permissão fiscal/);
  await db.exec(
    `insert into user_roles values('${id(1)}','financeiro');insert into role_permissoes values('financeiro','faturamento_emitir_nfe');insert into role_menus values('financeiro','/notas');`,
  );
  await conferir265();
  await db.exec(`delete from role_menus where path='/notas'`);
  await assert.rejects(conferir265(), /Permissão fiscal/);
  await db.exec(
    `insert into role_menus values('financeiro','/notas');create or replace function can_manage(uuid) returns boolean language sql as $$select true$$;`,
  );
  // Alteração de CNPJ/produção impede que a prévia trate o vínculo como homologado.
  await db.exec(`update centros set cnpj='99999999000199'`);
  assert.equal((await conferir265()).conexao.vinculo_atual, false);
  await db.exec(`update centros set cnpj='12.345.678/0001-95'`);
  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    await assert.rejects(conferir265(), /permission denied/);
    await db.exec("reset role");
  }
  console.log(
    "Forecast265: reaplicação, contexto sem credenciais, permissão fiscal/menu, loja, carteira, usuário ativo e primeiro acesso, leitura sem efeitos e negação a anon/service role verificados.",
  );
  await require("./lib/check-forecast-envio266.cjs")(db, id);
  await require("./lib/check-forecast-documentos267.cjs")(db, id);
  await db.close();
  console.log(
    "FAZNOTAS259: migração reaplicável, sigilo, reserva, lease, polling, transições, prova fiscal, bloqueios manuais e logística verificados sem API real",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
