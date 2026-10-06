const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("node:path");
const repo = path.resolve(__dirname, "..");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create table auth.users(id uuid primary key);
create table centros(id uuid primary key);
create table profiles(id uuid primary key,ativo boolean,todos_centros boolean);
create table user_roles(user_id uuid,role text);
create table usuario_centros(user_id uuid,centro_id uuid);
create function has_role(u uuid,r text) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=u and role=r)$$;
create function can_finance(u uuid) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=u and role in ('admin','gestor','financeiro'))$$;
create function usuario_pode_acessar_centro(c uuid) returns boolean language sql as $$select has_role(auth.uid(),'admin') or exists(select 1 from usuario_centros where user_id=auth.uid() and centro_id=c)$$;
create function ator_financeiro_pode_acessar_centro(u uuid,c uuid) returns boolean language sql as $$select can_finance(u) and (has_role(u,'admin') or exists(select 1 from usuario_centros where user_id=u and centro_id=c))$$;
create table contas_financeiras(id uuid primary key,nome text,centro_id uuid,ativo boolean,created_at timestamptz default now());
create table categorias_financeiras(id uuid primary key,nome text,tipo text,grupo_dre text,parent_id uuid,ordem int);
create table contas_receber(id uuid primary key,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,status text,valor numeric(14,2),juros numeric(14,2) default 0,multa numeric(14,2) default 0,acrescimo numeric(14,2) default 0,desconto numeric(14,2) default 0,valor_pago numeric(14,2) default 0,vencimento date,conta_financeira_id uuid,forma_pagamento_id uuid,data_pagamento date,categoria_id uuid,observacao text);
create table boletos(id uuid primary key default gen_random_uuid(),conta_receber_id uuid,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,banco text,seu_numero text,nosso_numero text,valor numeric(14,2),valor_liquidado numeric(14,2) default 0,vencimento date,data_liquidacao date,status text,created_by uuid,cooperativa text,posto text,codigo_beneficiario text,tipo_cobranca text,qrcode_pix text,txid text,erro text);
create unique index boleto_ativo on boletos(conta_receber_id) where status in ('pendente','registrado','liquidado','em_processamento');
create unique index seu_numero_unico on boletos(banco,seu_numero);
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric(14,2),categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,forma_pagamento_id uuid,conta_receber_id uuid);
create table auditoria(id uuid default gen_random_uuid(),tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
`);
  let sql = fs.readFileSync(path.join(repo, "db/fase71_perimetro_financeiro_centros.sql"), "utf8");
  for (const name of ["lancar_movimento", "receber_titulo"]) {
    const start = sql.indexOf("create or replace function public." + name + "(");
    const end = sql.indexOf("$$;", start) + 3;
    await db.exec(sql.slice(start, end));
  }
  await db.exec(fs.readFileSync(path.join(repo, "db/fase204_sicredi_cnab240.sql"), "utf8"));
  const actor = "00000000-0000-4000-8000-000000000001",
    centro = "00000000-0000-4000-8000-000000000002",
    conta = "00000000-0000-4000-8000-000000000003",
    cat = "00000000-0000-4000-8000-000000000004",
    titulo = "00000000-0000-4000-8000-000000000005";
  await db.exec(
    `insert into auth.users values('${actor}');insert into centros values('${centro}');insert into profiles values('${actor}',true,true);insert into user_roles values('${actor}','admin');insert into contas_financeiras values('${conta}','Sicredi','${centro}',true,now());insert into categorias_financeiras values('${cat}','Tarifas','despesa','despesas_financeiras',null,1);insert into contas_receber(id,centro_id,documento,parcela,status,valor,vencimento) values('${titulo}','${centro}','PED1',1,'aberto',1234.56,'2026-10-30');select set_config('request.jwt.claim.role','service_role',false);`,
  );
  const cfg = {
    centro_id: centro,
    nome: "TESTE",
    documento: "12345678000195",
    cooperativa: "0165",
    posto: "02",
    beneficiario: "00623",
    conta: "45981",
    conta_dv: "3",
    conta_financeira_id: conta,
    categoria_tarifa_id: cat,
    proxima_remessa: 1,
    proximo_nosso_numero: 1,
    homologado: true,
    juros_mensal: 0,
    multa_percentual: 0,
  };
  await db.query("select cnab_salvar_config($1,$2::jsonb)", [actor, JSON.stringify(cfg)]);
  const c = (await db.query("select * from sicredi_cnab_config")).rows[0];
  const titles = JSON.stringify([
    {
      conta_id: titulo,
      documento: "C123456789",
      nosso_numero: "262000010",
      valor: "1234.56",
      vencimento: "2026-10-30",
    },
  ]);
  const args = [actor, centro, c.updated_at, 1, 1, "teste.rem", "remessa", "a".repeat(64), titles];
  await db.query("select cnab_gravar_remessa($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", args);
  assert.equal((await db.query("select status from boletos")).rows[0].status, "pendente");
  await assert.rejects(() =>
    db.query("select cnab_gravar_remessa($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", args),
  );
  assert.equal((await db.query("select count(*)::int n from sicredi_cnab_arquivos")).rows[0].n, 1);
  const event = {
    nosso_numero: "262000010",
    documento: "C123456789",
    ocorrencia: "06",
    motivos: "0000000000",
    valor_titulo: "1234.56",
    valor_recebido: "1235.06",
    valor_liquido: "1232.06",
    juros: "1.00",
    desconto: "0.50",
    abatimento: "0.00",
    iof: "0.00",
    tarifas: "3.00",
    outras_despesas: "0.00",
    outros_creditos: "0.00",
    data_ocorrencia: "2026-10-30",
    data_credito: "2026-10-31",
  };
  const importArgs = [
    actor,
    centro,
    "teste.crt",
    "retorno",
    "b".repeat(64),
    JSON.stringify([event]),
  ];
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", importArgs);
  assert.equal((await db.query("select status from contas_receber")).rows[0].status, "pago");
  assert.equal((await db.query("select status from boletos")).rows[0].status, "liquidado");
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 2);
  assert.equal(
    Number(
      (
        await db.query(
          "select sum(case when tipo='entrada' then valor else -valor end) saldo from movimentos_financeiros",
        )
      ).rows[0].saldo,
    ),
    1232.06,
  );
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", importArgs);
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    ...importArgs.slice(0, 4),
    "c".repeat(64),
    importArgs[5],
  ]);
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 2);
  await assert.rejects(() =>
    db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
      actor,
      centro,
      "erro.crt",
      "erro",
      "d".repeat(64),
      JSON.stringify([{ ...event, valor_recebido: "999.00" }]),
    ]),
  );
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 2);
  // Mesmo recebimento comunicado como PIX não pode gerar novo crédito.
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    actor,
    centro,
    "pix.crt",
    "pix",
    "e".repeat(64),
    JSON.stringify([{ ...event, ocorrencia: "61" }]),
  ]);
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 2);
  // Híbrido: reserva com tipo correto e QR somente após confirmação bancária.
  const cfgNow = (await db.query("select * from sicredi_cnab_config")).rows[0];
  await db.query("select cnab_salvar_config($1,$2::jsonb)", [
    actor,
    JSON.stringify({
      ...cfgNow,
      tipo_cobranca: "HIBRIDO",
      chave_pix: "a1234567-1234-1234-1234-123456789abc",
    }),
  ]);
  const hybridCfg = (await db.query("select * from sicredi_cnab_config")).rows[0];
  const hybridTitle = "00000000-0000-4000-8000-000000000006";
  await db.query(
    "insert into contas_receber(id,centro_id,status,valor,vencimento) values($1,$2,'aberto',100,'2026-10-30')",
    [hybridTitle, centro],
  );
  await db.query("select cnab_gravar_remessa($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [
    actor,
    centro,
    hybridCfg.updated_at,
    hybridCfg.proxima_remessa,
    hybridCfg.proximo_nosso_numero,
    "hibrido.rem",
    "remessa hybrid",
    "f".repeat(64),
    JSON.stringify([
      {
        conta_id: hybridTitle,
        documento: "C987654321",
        nosso_numero: "262000020",
        valor: "100.00",
        vencimento: "2026-10-30",
      },
    ]),
  ]);
  assert.equal(
    (await db.query("select tipo_cobranca from boletos where conta_receber_id=$1", [hybridTitle]))
      .rows[0].tipo_cobranca,
    "HIBRIDO",
  );
  const qr =
    "00020101021226910014br.gov.bcb.pix2569pix-qrcode.sicredi.com.br/qr/v2/cobv/040360d740164ea286651ad210d76bc15204000053039865802BR5903PIX6006Cidade62070503***6304EB02";
  const register = {
    ...event,
    nosso_numero: "262000020",
    documento: "C987654321",
    ocorrencia: "02",
    valor_titulo: "100.00",
    qrcode_pix: qr,
    pix: {
      url: "pix-qrcode.sicredi.com.br/qr/v2/cobv/040360d740164ea286651ad210d76bc1",
      txid: "100090400888000020210324000094507",
    },
  };
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    actor,
    centro,
    "hibrido.crt",
    "retorno hybrid",
    "1".repeat(64),
    JSON.stringify([register]),
  ]);
  const hybrid = (
    await db.query("select status,qrcode_pix,txid from boletos where conta_receber_id=$1", [
      hybridTitle,
    ])
  ).rows[0];
  assert.equal(hybrid.status, "registrado");
  assert.equal(hybrid.qrcode_pix, qr);
  assert.equal(hybrid.txid, register.pix.txid);
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(() =>
    db.query("select cnab_salvar_config($1,$2::jsonb)", [actor, JSON.stringify(cfg)]),
  );
  console.log(
    "CNAB DB: migration parsed; atomic remessa; duplicate protection; receipt with interest/discount; bank fee; rollback; hybrid QR registration; PIX duplicate protection; service-only writes PASS",
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
