const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create table profiles(id uuid primary key,ativo boolean);create table user_roles(user_id uuid,role text);
create function has_role(uuid,text) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=$1 and role=$2)$$;
create function can_finance(uuid) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=$1 and role in ('admin','gestor','financeiro'))$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select has_role(auth.uid(),'admin') or $1='${id(10)}'::uuid$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select can_finance($1) and (has_role($1,'admin') or $2='${id(10)}'::uuid)$$;
create table centros(id uuid primary key);
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
insert into centros values('${id(10)}'),('${id(11)}');
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
    const row = async (table, key, value) =>
      (
        await db.query(
          `select * from ${table}${key ? " where " + key + "=$1" : ""}`,
          key ? [value] : [],
        )
      ).rows[0];
    assert.equal((await row("sicredi_config")).sandbox_api_key, "fixture-legacy-key");
    assert.equal((await row("sicredi_config")).api_key, "fixture-legacy-key");
    const title = async (n, centro = id(10)) => {
      await db.query(
        `insert into contas_receber(id,centro_id,status,valor,vencimento,documento,parcela,conta_financeira_id) values($1,$2,'aberto',100,'2026-11-30','MANUAL',1,$3)`,
        [id(n), centro, id(20)],
      );
      return id(n);
    };
    // Calling a composite with .* can evaluate repeatedly; use FROM for a single invocation.
    const prepare = async (t, actor = id(1)) =>
      (await db.query("select * from preparar_boleto_sicredi_servidor($1,$2)", [actor, t])).rows[0];
    const sandbox = await prepare(await title(30));
    assert.equal(sandbox.cooperativa, "6789");
    assert.equal(sandbox.posto, "03");
    assert.equal(sandbox.codigo_beneficiario, "12345");
    const liquidar = (b, d, actor = id(1)) =>
      db.query("select sicredi_liquidar_api_224($1,$2,$3)", [actor, b.id, JSON.stringify(d)]);
    const paid = { data: "2026-10-14", valor: 107, juros: 5, multa: 2, desconto: 0, abatimento: 0 };
    await assert.rejects(liquidar(sandbox, paid), /producao/);
    assert.equal((await db.query("select count(*) n from movimentos_financeiros")).rows[0].n, 0);
    // Sandbox identification does not replace or block the real common covenant.
    let api = await row("sicredi_config");
    await db.query("select sicredi_salvar_convenio_223($1,$2,null,true)", [
      id(1),
      JSON.stringify({
        ...api,
        cooperativa: "2222",
        username: "006232222",
        sandbox_api_key: "fixture-new-sandbox-key",
      }),
    ]);
    assert.equal((await row("sicredi_config")).cooperativa, "2222");
    assert.equal((await row("sicredi_config")).sandbox_api_key, "fixture-new-sandbox-key");
    await db.exec("update sicredi_config set ambiente='producao'");
    await assert.rejects(prepare(id(30)), /outro ambiente/);
    const b = await prepare(await title(31));
    assert.equal(b.cooperativa, "2222");
    const line = "74891121150039736789903123451001187340000000050",
      barcode = "748" + "1".repeat(41);
    const register = (b, actor = id(1), nosso = "262000020") =>
      db.query(
        "select * from registrar_boleto_sicredi_servidor($1,$2,$3,$4,$5,$6,null,null,$7,$8,$9,$10,$11)",
        [
          actor,
          b.conta_receber_id,
          b.seu_numero,
          nosso,
          line,
          barcode,
          b.cooperativa,
          b.posto,
          b.codigo_beneficiario,
          b.ambiente,
          "{}",
        ],
      );
    await register(b);
    // O esquema real possui conta (texto), ausente na fixture antiga.
    await db.exec("alter table contas_financeiras add column conta text");
    await assert.rejects(
      liquidar(b, paid),
      (error) => error.code === "42702" && error.message.includes('"conta"'),
    );
    assert.equal(Number((await row("contas_receber", "id", id(31))).valor_pago), 0);
    assert.equal((await db.query("select count(*) n from movimentos_financeiros")).rows[0].n, 0);
    await db.exec(readSql("fase249_correcao_conta_recebimento.sql"));
    await db.exec(readSql("fase249_correcao_conta_recebimento.sql"));
    await liquidar(b, paid);
    let cr = await row("contas_receber", "id", id(31));
    assert.equal(Number(cr.valor_pago), 107);
    assert.equal(Number(cr.juros), 5);
    assert.equal(Number(cr.multa), 2);
    assert.equal(cr.status, "pago");
    let movimentos = (await db.query("select * from movimentos_financeiros")).rows;
    assert.equal(movimentos.length, 1);
    assert.equal(Number(movimentos[0].valor), 107);
    assert.equal(movimentos[0].centro_id, id(10));
    assert.equal(movimentos[0].conta_id, id(20));
    await liquidar(b, paid);
    assert.equal((await db.query("select count(*) n from movimentos_financeiros")).rows[0].n, 1);
    await assert.rejects(liquidar(b, { ...paid, juros: 6 }), /anterior divergente/);
    const disc = await prepare(await title(32));
    await register(disc);
    await liquidar(disc, { ...paid, valor: 95, juros: 0, multa: 0, desconto: 3, abatimento: 2 });
    cr = await row("contas_receber", "id", id(32));
    assert.equal(Number(cr.valor_pago), 95);
    assert.equal(Number(cr.desconto), 5);
    assert.equal(cr.status, "pago");
    const partial = await prepare(await title(33));
    await register(partial);
    const before = (await db.query("select count(*) n from movimentos_financeiros")).rows[0].n;
    await assert.rejects(liquidar(partial, { ...paid, valor: 50, juros: 0, multa: 0 }), /parcial/);
    assert.equal((await row("contas_receber", "id", id(33))).status, "aberto");
    assert.equal(
      (await db.query("select count(*) n from movimentos_financeiros")).rows[0].n,
      before,
    );
    await db.exec(`update contas_receber set valor_pago=1 where id='${id(33)}'`);
    await assert.rejects(liquidar(partial, paid), /Saldo do titulo mudou/);
    const changed = await prepare(await title(34));
    await db.exec(`update contas_receber set valor=101 where id='${id(34)}'`);
    await assert.rejects(register(changed), /Titulo mudou/);
    assert.equal((await row("boletos", "id", changed.id)).status, "em_processamento");
    const another = await prepare(await title(35, id(11)));
    await register(another);
    await assert.rejects(liquidar(another, paid, id(2)), /Sem acesso/);
    await assert.rejects(liquidar(another, paid, id(3)), /servidor ativo/);
    // Shared production identity cannot be changed after a real reservation.
    api = await row("sicredi_config");
    await assert.rejects(
      db.query("select sicredi_salvar_convenio_223($1,$2,null,true)", [
        id(1),
        JSON.stringify({ ...api, cooperativa: "3333" }),
      ]),
      /Preserve a identificacao/,
    );
    const legacy = await prepare(await title(37));
    await db.query("update boletos set status='erro',tentativas=null where id=$1", [legacy.id]);
    const retry = await prepare(id(37));
    assert.equal(retry.tentativas, 1);
    assert.equal(retry.emissao_retentativa, true);
    const recovered = await prepare(await title(38));
    await register(recovered, id(1), "");
    assert.equal((await row("boletos", "id", recovered.id)).nosso_numero, null);
    const link = (number, linha = line) =>
      db.query("select sicredi_vincular_numero_224($1,$2,$3,$4)", [
        id(1),
        recovered.id,
        number,
        linha,
      ]);
    await assert.rejects(link("262000039", "748" + "1".repeat(44)), /nao corresponde/);
    await link("262000038");
    await link("262000038");
    assert.equal((await row("boletos", "id", recovered.id)).nosso_numero, "262000038");
    await assert.rejects(link("262000039"), /Nao substitua/);
    const hash = "a".repeat(64),
      claim = async () =>
        (await db.query("select sicredi_token_reservar_224($1) value", [hash])).rows[0].value;
    const first = await claim();
    assert.ok(first.lease);
    assert.equal((await claim()).busy, true);
    const complete = (lease, data) =>
      db.query("select sicredi_token_concluir_224($1,$2,$3)", [
        hash,
        lease,
        data === null ? null : JSON.stringify(data),
      ]);
    await complete(first.lease, {
      access_token: "fixture-access",
      expires_in: 300,
      refresh_token: "fixture-refresh",
      refresh_expires_in: 900,
    });
    assert.equal((await claim()).access_token, "fixture-access");
    await db.exec("update sicredi_tokens_224 set access_expira=now()-interval '1 second'");
    const renew = await claim();
    assert.equal(renew.refresh_token, "fixture-refresh");
    assert.ok(renew.lease);
    await assert.rejects(
      complete(first.lease, { access_token: "stale", expires_in: 300 }),
      /Reserva de token/,
    );
    await assert.rejects(
      complete(renew.lease, { access_token: "invalid", expires_in: "NaN" }),
      /Token ou prazo/,
    );
    await complete(renew.lease, null);
    await db.exec("update sicredi_tokens_224 set refresh_expira=now()-interval '1 second'");
    const expired = await claim();
    assert.equal(expired.refresh_token, null);
    await complete(expired.lease, null);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from sicredi_tokens_224"), /permission denied/);
      await assert.rejects(claim(), /permission denied/);
      await assert.rejects(liquidar(b, paid), /permission denied/);
      await db.exec("reset role");
    }
    console.log(
      "API Sicredi DB OK: migração reaplicável, sandbox separado sem caixa real, reservas identificadas, convênio de produção protegido, juros/multa/descontos reais e idempotência, rollback/centros, registro após mudanças bloqueado, tokens privados com validade/renovação/lease concorrente e RPCs sem acesso público.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
