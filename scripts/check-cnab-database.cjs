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
create table clientes(id uuid primary key,representante_id uuid);
create table pedidos(id uuid primary key,cliente_id uuid,representante_id uuid,onda_id uuid);
create function meu_representante_id() returns uuid language sql as $$select null::uuid$$;
create function usuario_ativo() returns boolean language sql security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and ativo)$$;
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
  await db.exec(
    fs.readFileSync(path.join(repo, "db/fase205_sicredi_alteracao_vencimento.sql"), "utf8"),
  );
  // A fase205 pode ser repetida sem substituir o processamento financeiro original.
  await db.exec(
    fs.readFileSync(path.join(repo, "db/fase205_sicredi_alteracao_vencimento.sql"), "utf8"),
  );
  await db.exec(fs.readFileSync(path.join(repo, "db/fase206_carteira_representante.sql"), "utf8"));
  for (let repeat = 0; repeat < 2; repeat++) {
    await db.exec(fs.readFileSync(path.join(repo, "db/fase207_sicredi_cnab30.sql"), "utf8"));
  }
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
  await db.query("update sicredi_cnab_config set documento=$1", ["12ABC34501DE35"]);
  assert.equal(
    (await db.query("select documento from sicredi_cnab_config")).rows[0].documento,
    "12ABC34501DE35",
  );
  await db.query("update sicredi_cnab_config set documento=$1", ["12345678909"]);
  for (const invalid of ["ABCDEF12345", "12ABC34501DEAB", "12abc34501de35", "123"]) {
    await assert.rejects(db.query("update sicredi_cnab_config set documento=$1", [invalid]));
  }
  await db.query("update sicredi_cnab_config set documento=$1", [cfg.documento]);
  const migration208 = fs.readFileSync(
    path.join(repo, "db/fase208_sicredi_configuracao_compartilhada.sql"),
    "utf8",
  );
  await db.exec(migration208);
  await db.exec(migration208);
  assert.equal(
    (await db.query("select centro_id from contas_financeiras where id=$1", [conta])).rows[0]
      .centro_id,
    null,
  );
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
  // Um retorno reemitido pela versão nova inclui metadados ausentes na liquidação anterior.
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    actor,
    centro,
    "metadata.crt",
    "metadata",
    "8".repeat(64),
    JSON.stringify([{ ...event, vencimento: "2026-10-30", qrcode_pix: "metadata-fixture" }]),
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
  // Não muda vencimento antes da confirmação; duplicidade, divergência e rejeição são transacionais.
  const boletoHybrid = (
    await db.query("select * from boletos where conta_receber_id=$1", [hybridTitle])
  ).rows[0];
  async function solicitar(data, anterior, hash) {
    const configAtual = (await db.query("select * from sicredi_cnab_config")).rows[0];
    return (
      await db.query("select sicredi_solicitar_vencimento($1,$2,$3,$4,$5::jsonb) id", [
        actor,
        boletoHybrid.id,
        data,
        anterior,
        JSON.stringify({
          versao: configAtual.updated_at,
          sequencia: configAtual.proxima_remessa,
          nome: "alteracao.rem",
          conteudo: "fixture",
          sha256: hash.repeat(64),
        }),
      ])
    ).rows[0].id;
  }
  const seqNosso = (await db.query("select proximo_nosso_numero from sicredi_cnab_config")).rows[0]
    .proximo_nosso_numero;
  const change = await solicitar("2099-11-20", "2026-10-30", "2");
  assert.equal(
    (await db.query("select vencimento::text from boletos where id=$1", [boletoHybrid.id])).rows[0]
      .vencimento,
    "2026-10-30",
  );
  assert.equal(
    (await db.query("select proximo_nosso_numero from sicredi_cnab_config")).rows[0]
      .proximo_nosso_numero,
    seqNosso,
  );
  await assert.rejects(() => solicitar("2099-11-21", "2026-10-30", "3"));
  await assert.rejects(() =>
    db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
      actor,
      centro,
      "divergente.crt",
      "fixture",
      "4".repeat(64),
      JSON.stringify([{ ...register, ocorrencia: "14", vencimento: "2099-11-21" }]),
    ]),
  );
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    actor,
    centro,
    "confirmado.crt",
    "fixture",
    "5".repeat(64),
    JSON.stringify([{ ...register, ocorrencia: "14", vencimento: "2099-11-20" }]),
  ]);
  assert.equal(
    (
      await db.query("select vencimento::text,vencimento_solicitacao_id from boletos where id=$1", [
        boletoHybrid.id,
      ])
    ).rows[0].vencimento,
    "2099-11-20",
  );
  assert.equal(
    (await db.query("select vencimento::text from contas_receber where id=$1", [hybridTitle]))
      .rows[0].vencimento,
    "2099-11-20",
  );
  assert.equal(
    (await db.query("select estado from sicredi_boleto_alteracoes where id=$1", [change])).rows[0]
      .estado,
    "confirmado",
  );
  const rejected = await solicitar("2099-11-25", "2099-11-20", "6");
  await db.query("select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)", [
    actor,
    centro,
    "rejeitado.crt",
    "fixture",
    "7".repeat(64),
    JSON.stringify([{ ...register, ocorrencia: "26", vencimento: "2099-11-20" }]),
  ]);
  assert.equal(
    (await db.query("select estado from sicredi_boleto_alteracoes where id=$1", [rejected])).rows[0]
      .estado,
    "rejeitado",
  );
  assert.equal(
    (await db.query("select vencimento::text from boletos where id=$1", [boletoHybrid.id])).rows[0]
      .vencimento,
    "2099-11-20",
  );
  // Fixture API: envio pendente e confirmação bancária explícita, sem alterar movimentos.
  await db.query("update boletos set canal='api' where id=$1", [boletoHybrid.id]);
  const apiChange = (
    await db.query("select sicredi_solicitar_vencimento($1,$2,'2099-11-26','2099-11-20',null) id", [
      actor,
      boletoHybrid.id,
    ])
  ).rows[0].id;
  await db.query("select sicredi_finalizar_vencimento($1,$2,'enviado',null)", [actor, apiChange]);
  await assert.rejects(() =>
    db.query("select sicredi_finalizar_vencimento($1,$2,'confirmado','2099-11-27')", [
      actor,
      apiChange,
    ]),
  );
  await db.query("select sicredi_finalizar_vencimento($1,$2,'confirmado','2099-11-26')", [
    actor,
    apiChange,
  ]);
  assert.equal(
    (await db.query("select vencimento::text from contas_receber where id=$1", [hybridTitle]))
      .rows[0].vencimento,
    "2099-11-26",
  );
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 2);

  // Mesmo convênio nos dois centros: uma versão e um contador compartilhados.
  const centro2 = "00000000-0000-4000-8000-000000000070";
  const titleA = "00000000-0000-4000-8000-000000000071";
  const titleB = "00000000-0000-4000-8000-000000000072";
  const finance2 = "00000000-0000-4000-8000-000000000073";
  await db.query("insert into centros values($1)", [centro2]);
  for (const [id, center] of [
    [titleA, centro],
    [titleB, centro2],
  ]) {
    await db.query(
      "insert into contas_receber(id,centro_id,documento,parcela,status,valor,vencimento) values($1,$2,'TESTE208',1,'aberto',1234.56,'2026-10-30')",
      [id, center],
    );
  }
  const shared = (await db.query("select * from sicredi_cnab_config")).rows[0];
  function args208(config, center, id, suffix) {
    return [
      actor,
      center,
      config.updated_at,
      config.proxima_remessa,
      config.proximo_nosso_numero,
      `remessa208-${suffix}.rem`,
      "fixture",
      suffix.repeat(63) + "0",
      JSON.stringify([
        {
          conta_id: id,
          documento: `C208${suffix}`,
          nosso_numero: `262${String(config.proximo_nosso_numero).padStart(5, "0")}0`,
          valor: "1234.56",
          vencimento: "2026-10-30",
        },
      ]),
    ];
  }
  const emissionSql = "select cnab_gravar_remessa($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)";
  const attempts = await Promise.allSettled([
    db.query(emissionSql, args208(shared, centro, titleA, "a")),
    db.query(emissionSql, args208(shared, centro2, titleB, "b")),
  ]);
  assert.equal(attempts.filter((v) => v.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((v) => v.status === "rejected").length, 1);
  assert.match(attempts.find((v) => v.status === "rejected").reason.message, /Configuracao mudou/);
  const loser = attempts[0].status === "rejected" ? [centro, titleA, "a"] : [centro2, titleB, "b"];
  await db.query(
    emissionSql,
    args208((await db.query("select * from sicredi_cnab_config")).rows[0], ...loser),
  );
  const issued = (
    await db.query("select * from boletos where conta_receber_id in ($1,$2) order by centro_id", [
      titleA,
      titleB,
    ])
  ).rows;
  assert.equal(issued.length, 2);
  assert.notEqual(issued[0].nosso_numero, issued[1].nosso_numero);
  const advanced = (await db.query("select * from sicredi_cnab_config")).rows[0];
  assert.equal(advanced.proximo_nosso_numero, shared.proximo_nosso_numero + 2);
  assert.equal(advanced.proxima_remessa, shared.proxima_remessa + 2);
  assert.equal((await db.query("select count(*)::int n from sicredi_cnab_config")).rows[0].n, 1);
  await assert.rejects(
    db.query("select cnab_salvar_config($1,$2::jsonb)", [
      actor,
      JSON.stringify({ ...advanced, proximo_nosso_numero: 1 }),
    ]),
    /nao podem retroceder/,
  );
  await assert.rejects(
    db.query(
      "insert into sicredi_cnab_arquivos(centro_id,tipo,sequencia,nome,conteudo,sha256,quantidade,created_by) values($1,'remessa',$2,'duplicado','fixture',$3,1,$4)",
      [centro2, shared.proxima_remessa, "f".repeat(64), actor],
    ),
    /sicredi_cnab_remessa_global_uniq/,
  );

  await db.query("insert into auth.users values($1)", [finance2]);
  await db.query("insert into profiles values($1,true,false)", [finance2]);
  await db.query("insert into user_roles values($1,'financeiro')", [finance2]);
  await db.query("insert into usuario_centros values($1,$2)", [finance2, centro2]);
  const mixed = issued.map((b) => ({
    ...event,
    nosso_numero: b.nosso_numero,
    documento: b.seu_numero,
    ocorrencia: "02",
  }));
  const import208 = [
    actor,
    centro,
    "misto208.crt",
    "fixture-misto208",
    "8".repeat(63) + "a",
    JSON.stringify(mixed),
  ];
  const returnSql = "select cnab_gravar_retorno($1,$2,$3,$4,$5,$6::jsonb)";
  const filesBefore = (await db.query("select count(*)::int n from sicredi_cnab_arquivos")).rows[0]
    .n;
  await assert.rejects(
    db.query(returnSql, [finance2, centro2, ...import208.slice(2)]),
    /Sem acesso financeiro/,
  );
  await assert.rejects(
    db.query("select cnab_salvar_config($1,$2::jsonb)", [finance2, JSON.stringify(advanced)]),
    /Somente administrador/,
  );
  // Falha no segundo centro desfaz o registro no primeiro e todos os arquivos.
  await assert.rejects(
    db.query(returnSql, [
      ...import208.slice(0, 5),
      JSON.stringify([mixed[0], { ...mixed[1], valor_titulo: "999.00" }]),
    ]),
    /Valor nominal divergente/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from sicredi_cnab_arquivos")).rows[0].n,
    filesBefore,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from boletos where id in($1,$2) and status='pendente'",
        issued.map((b) => b.id),
      )
    ).rows[0].n,
    2,
  );
  await db.query(returnSql, import208);
  await db.query(returnSql, import208);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from boletos where id in($1,$2) and status='registrado'",
        issued.map((b) => b.id),
      )
    ).rows[0].n,
    2,
  );

  // Financeiro restrito ao centro2 vê a configuração, mas não o arquivo misto.
  await db.exec(
    "grant usage on schema auth to authenticated; grant select on user_roles,usuario_centros to authenticated;",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [finance2]);
  await db.exec(
    "select set_config('request.jwt.claim.role','authenticated',false); set role authenticated;",
  );
  assert.equal((await db.query("select count(*)::int n from sicredi_cnab_config")).rows[0].n, 1);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from sicredi_cnab_arquivos where cardinality(centros_retorno)>1",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select count(*)::int n from sicredi_cnab_arquivos where tipo='remessa'"))
      .rows[0].n,
    1,
  );
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false);");

  // Alteração do centro2 também consome a sequência global, sem novo nosso número.
  const beforeChange = (await db.query("select * from sicredi_cnab_config")).rows[0];
  const b2 = issued.find((b) => b.centro_id === centro2);
  await db.query("select sicredi_solicitar_vencimento($1,$2,'2099-11-20','2026-10-30',$3::jsonb)", [
    actor,
    b2.id,
    JSON.stringify({
      versao: beforeChange.updated_at,
      sequencia: beforeChange.proxima_remessa,
      nome: "alterar208.rem",
      conteudo: "fixture",
      sha256: "9".repeat(64),
    }),
  ]);
  const afterChange = (await db.query("select * from sicredi_cnab_config")).rows[0];
  assert.equal(afterChange.proxima_remessa, beforeChange.proxima_remessa + 1);
  assert.equal(afterChange.proximo_nosso_numero, beforeChange.proximo_nosso_numero);
  await db.query(returnSql, [
    actor,
    centro,
    "venc208.crt",
    "fixture",
    "0".repeat(64),
    JSON.stringify([
      {
        ...mixed.find((e) => e.nosso_numero === b2.nosso_numero),
        ocorrencia: "14",
        vencimento: "2099-11-20",
      },
    ]),
  ]);
  assert.equal(
    (await db.query("select vencimento::text from contas_receber where id=$1", [titleB])).rows[0]
      .vencimento,
    "2099-11-20",
  );

  // Liquidação mista mantém os centros nas entradas e nas tarifas da mesma conta.
  const paid = mixed.map((e) => ({ ...e, ocorrencia: "06" }));
  await db.query(returnSql, [
    actor,
    centro,
    "pago208.crt",
    "fixture",
    "1".repeat(63) + "b",
    JSON.stringify(paid),
  ]);
  await db.query(returnSql, [
    actor,
    centro2,
    "pago208.crt",
    "fixture",
    "1".repeat(63) + "b",
    JSON.stringify(paid),
  ]);
  assert.equal((await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n, 6);
  assert.equal(
    (
      await db.query("select count(*)::int n from movimentos_financeiros where centro_id=$1", [
        centro2,
      ])
    ).rows[0].n,
    2,
  );
  const beforeRerun = (await db.query("select * from sicredi_cnab_config")).rows[0];
  await db.exec("update sicredi_cnab_config set proxima_remessa=1,proximo_nosso_numero=1");
  await db.exec(migration208);
  const afterRerun = (await db.query("select * from sicredi_cnab_config")).rows[0];
  assert.equal(afterRerun.proximo_nosso_numero, beforeRerun.proximo_nosso_numero);
  assert.equal(afterRerun.proxima_remessa, beforeRerun.proxima_remessa);
  // Primeira configuração (ou restauração) também respeita os números do histórico.
  await db.exec("delete from sicredi_cnab_config");
  const fresh = { ...beforeRerun, proxima_remessa: 1, proximo_nosso_numero: 1 };
  delete fresh.centro_id;
  await db.query("select cnab_salvar_config($1,$2::jsonb)", [actor, JSON.stringify(fresh)]);
  const restored = (await db.query("select * from sicredi_cnab_config")).rows[0];
  assert.equal(restored.proxima_remessa, beforeRerun.proxima_remessa);
  assert.equal(restored.proximo_nosso_numero, beforeRerun.proximo_nosso_numero);
  console.log(
    "CNAB compartilhado: dois centros; versão concorrente rejeitada; retry sem duplicidade; sequência de vencimento; retorno misto atômico; RLS de arquivo misto; movimentos por centro; reaplicação sem reset PASS",
  );
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(() =>
    db.query("select cnab_salvar_config($1,$2::jsonb)", [actor, JSON.stringify(cfg)]),
  );
  console.log(
    "CNAB DB: migration parsed; atomic remessa; duplicate protection; receipt with interest/discount; bank fee; rollback; hybrid QR registration; PIX duplicate protection; CNAB/API due-date confirmation/rejection; service-only writes PASS",
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
