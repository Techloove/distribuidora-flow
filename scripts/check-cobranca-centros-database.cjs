const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;grant usage on schema auth to authenticated,anon,service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create table profiles(id uuid primary key,ativo boolean);create table user_roles(user_id uuid,role text);
create function has_role(uuid,text) returns boolean language sql security definer as $$select exists(select 1 from user_roles where user_id=$1 and role=$2)$$;
create function can_finance(uuid) returns boolean language sql security definer as $$select exists(select 1 from user_roles where user_id=$1 and role in ('admin','gestor','financeiro'))$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select has_role(auth.uid(),'admin') or $1='${id(10)}'::uuid$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select can_finance($1) and (has_role($1,'admin') or $2='${id(10)}'::uuid)$$;
create table centros(id uuid primary key,ativo boolean default true);
create table contas_financeiras(id uuid primary key,nome text,centro_id uuid,ativo boolean,created_at timestamptz default now());
create table categorias_financeiras(id uuid primary key,tipo text,grupo_dre text,parent_id uuid,ordem int);
create table contas_receber(id uuid primary key,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,status text,valor numeric(14,2),juros numeric(14,2) default 0,multa numeric(14,2) default 0,acrescimo numeric(14,2) default 0,desconto numeric(14,2) default 0,valor_pago numeric(14,2) default 0,vencimento date,conta_financeira_id uuid,forma_pagamento_id uuid,data_pagamento date,categoria_id uuid,observacao text);
create table boletos(id uuid primary key default gen_random_uuid(),conta_receber_id uuid,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,banco text,seu_numero text,nosso_numero text,valor numeric(14,2),valor_liquidado numeric(14,2),vencimento date,data_liquidacao date,status text,created_by uuid,cooperativa text,posto text,codigo_beneficiario text,ambiente text,tipo_cobranca text,qrcode_pix text,txid text,erro text,created_at timestamptz default now(),tentativas int,enviado_em timestamptz,linha_digitavel text,codigo_barras text,retorno jsonb,canal text not null default 'api');
create unique index boleto_seu_numero on boletos(banco,seu_numero);
create unique index boleto_ativo on boletos(conta_receber_id) where status in ('pendente','registrado','liquidado','em_processamento');
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric(14,2),categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,forma_pagamento_id uuid,conta_receber_id uuid);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create table sicredi_cnab_arquivos(tipo text,sequencia int);
insert into profiles values('${id(1)}',true),('${id(2)}',true),('${id(3)}',false);
insert into user_roles values('${id(1)}','admin'),('${id(2)}','financeiro'),('${id(3)}','admin');
insert into centros(id) values('${id(10)}'),('${id(11)}');
insert into contas_financeiras values('${id(20)}','Sicredi',null,true,now());
select set_config('request.jwt.claim.role','service_role',false);`);
    const readSql = (f) => fs.readFileSync(path.join(root, "db", f), "utf8");
    const apiSql = readSql("fase18_sicredi_config.sql");
    await db.exec(apiSql.slice(apiSql.indexOf("create table"), apiSql.indexOf("grant select")));
    const cnabSql = readSql("fase204_sicredi_cnab240.sql");
    await db.exec(
      cnabSql.slice(
        cnabSql.indexOf("create table"),
        cnabSql.indexOf("create table if not exists public.sicredi_cnab_arquivos"),
      ),
    );
    await db.exec(
      `create unique index sicredi_single on sicredi_config((true));create unique index cnab_single on sicredi_cnab_config((true));insert into sicredi_config(api_key,username,password,cooperativa,posto,codigo_beneficiario,tipo_cobranca) values('fixture-legacy-key','006230165','fixture-password','0165','02','00623','NORMAL');`,
    );
    const load = async (f, name) => {
      const s = readSql(f),
        start = s.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0);
      await db.exec(s.slice(start, s.indexOf("$$;", start) + 3));
    };
    await load("fase208_sicredi_configuracao_compartilhada.sql", "cnab_salvar_config");
    await load("fase131_reserva_emissao_sicredi.sql", "preparar_boleto_sicredi_servidor");
    await load(
      "fase129_idempotencia_persistencia_sicredi.sql",
      "registrar_boleto_sicredi_servidor",
    );
    await load("fase71_perimetro_financeiro_centros.sql", "receber_titulo");
    await db.exec(readSql("fase223_sicredi_convenio_unificado.sql"));
    const migration = readSql("fase224_sicredi_api_manual391.sql");
    await db.exec(migration);
    await db.exec(migration);

    // Real migrations18/204(schema),208(save),131/129/71(motors),223/224 above.
    // Access/catalogue fixtures isolate the centre-banking change from unrelated ERP modules.
    await db.exec(`create function usuario_ativo() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid() and ativo)$$;
      create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);
      create table role_permissoes(role text,permissao text,primary key(role,permissao));
      create table role_menus(role text,path text);
      insert into role_menus values('admin','/centros');
      create function acompanhar_pedido_236(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
      insert into contas_financeiras(id,nome,centro_id,ativo) values('${id(21)}','Sicoob','${id(11)}',true),('${id(22)}','Sicredi Ferragem','${id(10)}',true);
    `);
    await db.exec(
      `insert into sicredi_cnab_config(centro_id,nome,documento,cooperativa,posto,beneficiario,conta,conta_dv,conta_financeira_id,proxima_remessa,proximo_nosso_numero) values('${id(10)}','Legado','12345678000195','0165','02','00623','1234','5','${id(20)}',19,357)`,
    );
    const cnabBefore = (await db.query("select * from sicredi_cnab_config")).rows;
    const before = (await db.query("select * from sicredi_config")).rows;
    const migration237 = readSql("fase237_cobranca_por_centro.sql");
    await db.exec(migration237);
    await db.exec(migration237);
    assert.deepEqual((await db.query("select * from sicredi_config")).rows, before);
    assert.equal((await db.query("select count(*) n from cobranca_centros")).rows[0].n, 0);
    const title = async (n, centro = id(10)) => {
      await db.query(
        `insert into contas_receber(id,centro_id,status,valor,vencimento,documento,parcela,conta_financeira_id) values($1,$2,'aberto',100,'2026-11-30','MANUAL',1,$3)`,
        [id(n), centro, id(20)],
      );
      return id(n);
    };
    const prepare = async (t, actor = id(1)) =>
      (await db.query("select * from preparar_boleto_sicredi_servidor($1,$2)", [actor, t])).rows[0];
    const save = (
      bank,
      centre = id(10),
      active = true,
      account = id(22),
      api = {},
      actor = id(1),
    ) =>
      db.query("select salvar_cobranca_centro_237($1,$2,$3,$4,$5,$6)", [
        actor,
        centre,
        bank,
        active,
        account,
        api === null ? null : JSON.stringify(api),
      ]);
    const api = {
      ...before[0],
      ambiente: "producao",
      username: "006230165",
      tipo_cobranca: "NORMAL",
      api_key: "",
      password: "",
      sandbox_api_key: "",
    };
    const t = await title(30);
    await assert.rejects(prepare(t), /nao habilitado/);
    await assert.rejects(save("sicoob", id(11), true, id(21), null), /ainda nao implementada/);
    await save("sicoob", id(11), false, id(21), null);
    await assert.rejects(prepare(await title(31, id(11))), /nao habilitado/);
    await assert.rejects(save("sicredi", id(10), true, id(21), api), /conta financeira ativa/);
    await assert.rejects(
      save("sicredi", id(10), true, null, api),
      /conta financeira de recebimento/,
    );
    await assert.rejects(save("sicredi", id(10), true, id(22), api, id(2)), /administrador/);
    await assert.rejects(save("sicredi", id(10), true, id(22), api, id(3)), /sem acesso/);
    await save("sicredi", id(10), true, id(22), api);
    let cfg = (await db.query("select * from sicredi_config")).rows[0];
    assert.equal(cfg.api_key, "fixture-legacy-key");
    assert.equal(cfg.password, "fixture-password");
    await assert.rejects(save("sicredi", id(11), true, id(21), api), /outro centro/);
    const b = await prepare(t);
    assert.equal(b.centro_id, id(10));
    assert.equal(b.conta_cobranca_id, id(22));
    assert.equal(b.ambiente, "producao");
    assert.match(b.seu_numero, /^[0-9]{10}$/);
    await assert.rejects(prepare(t), /em processamento/);
    await assert.rejects(save("sicoob", id(10), false, id(22), null), /historico Sicredi/);
    await assert.rejects(
      save("sicredi", id(10), true, id(22), { ...api, cooperativa: "2222" }),
      /Preserve a identificacao/,
    );
    await assert.rejects(
      save("sicredi", id(10), true, id(22), { ...api, ambiente: "homologacao" }),
      /outro ambiente/,
    );
    await assert.rejects(
      save("sicredi", id(10), true, id(22), { ...api, tipo_cobranca: "HIBRIDO" }),
      /boleto normal/,
    );
    await assert.rejects(
      db.query("select sicredi_salvar_convenio_223($1,$2,null,true)", [id(1), JSON.stringify(api)]),
      /Centros de custo/,
    );
    // A later account change never re-routes an existing boleto to another account.
    await save("sicredi", id(10), true, id(20), api);
    const line = "74891121150039736789903123451001187340000000050",
      barcode = "748" + "1".repeat(41);
    await db.query(
      "select * from registrar_boleto_sicredi_servidor($1,$2,$3,$4,$5,$6,null,null,$7,$8,$9,$10,$11)",
      [
        id(1),
        t,
        b.seu_numero,
        "262000020",
        line,
        barcode,
        b.cooperativa,
        b.posto,
        b.codigo_beneficiario,
        b.ambiente,
        "{}",
      ],
    );
    const paid = { data: "2026-10-16", valor: 100, juros: 0, multa: 0, desconto: 0, abatimento: 0 };
    await db.query("select sicredi_liquidar_api_224($1,$2,$3)", [
      id(1),
      b.id,
      JSON.stringify(paid),
    ]);
    await db.query("select sicredi_liquidar_api_224($1,$2,$3)", [
      id(1),
      b.id,
      JSON.stringify(paid),
    ]);
    const movements = (await db.query("select * from movimentos_financeiros")).rows;
    assert.equal(movements.length, 1);
    assert.equal(movements[0].conta_id, id(22));
    assert.equal(movements[0].centro_id, id(10));
    assert.equal((await prepare(await title(32))).conta_cobranca_id, id(20));
    await save("sicredi", id(10), false, id(20), api);
    await assert.rejects(prepare(await title(33)), /nao habilitado/);
    await assert.rejects(
      db.query(`insert into boletos(banco,canal) values('sicredi','cnab240')`),
      /somente API/,
    );
    await assert.rejects(
      db.query(`insert into sicredi_cnab_arquivos(tipo,sequencia) values('remessa',99)`),
      /somente API/,
    );
    await db.query(`insert into sicredi_cnab_arquivos(tipo,sequencia) values('retorno',99)`);
    // Private RPCs stay private; table RLS filters centres for finance users.
    await db.exec(
      `set request.jwt.claim.sub='${id(2)}';set request.jwt.claim.role='authenticated';set role authenticated`,
    );
    assert.equal((await db.query("select count(*) n from cobranca_centros")).rows[0].n, 1);
    await assert.rejects(save("sicredi", id(10), true, id(22), api), /permission denied/);
    await assert.rejects(db.query(`update cobranca_centros set ativo=true`), /permission denied/);
    await db.exec("reset role;set role anon");
    await assert.rejects(db.query("select * from cobranca_centros"), /permission denied/);
    await db.exec("reset role;set request.jwt.claim.role='service_role'");
    await db.exec("delete from role_permissoes where permissao='centros_cobranca_configurar'");
    await db.exec(migration237);
    assert.equal((await db.query("select count(*) n from role_permissoes")).rows[0].n, 0);
    assert.equal((await db.query("select count(*) n from sicredi_cnab_arquivos")).rows[0].n, 1);
    assert.deepEqual((await db.query("select * from sicredi_cnab_config")).rows, cnabBefore);
    console.log(
      "Cobrança por centro OK: migração reaplicável e preservação de credenciais; Sicredi API restrito ao centro; Sicoob pendente; conta de recebimento por ciclo, liquidação idempotente, RLS, RPCs privadas, histórico e bloqueio de novas remessas CNAB.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
