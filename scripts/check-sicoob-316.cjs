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
    const q = async (s, a = []) => (await db.query(s, a)).rows,
      scalar = async (s, a = []) => Object.values((await q(s, a))[0])[0];
    const antesSicredi = await scalar(
      `select to_jsonb(c) from cobranca_centros c where centro_id='${id(11)}'`,
    );
    const migration = fs.readFileSync("db/fase316_sicoob_cobranca_v3.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const fix = fs.readFileSync("db/fase319_sicoob_ativacao_sandbox.sql", "utf8");
    await db.exec(fix);
    await db.exec(fix);
    const mockFix = fs.readFileSync("db/fase320_sicoob_resposta_simulada.sql", "utf8");
    await db.exec(mockFix);
    await db.exec(mockFix);
    assert.deepEqual(
      await scalar(`select to_jsonb(c) from cobranca_centros c where centro_id='${id(11)}'`),
      antesSicredi,
    );
    assert.equal(
      await scalar(`select ativo from cobranca_centros where centro_id='${id(10)}'`),
      false,
    );
    const cfg = {
      client_id: "client-test",
      numero_cliente: 12345,
      numero_conta: 67890,
      numero_contrato: 1,
    };
    const salvar = (modo, versao, ativo = false, segredo = null, actor = id(1), dados = cfg) =>
      q("select sicoob_config_salvar_316($1,$2,$3,$4,$5,$6,$7,$8)", [
        actor,
        id(10),
        dados,
        modo === "producao" ? id(70) : null,
        ativo,
        versao,
        segredo,
        modo,
      ]);
    await assert.rejects(
      () => salvar("homologacao", 0, true, { sandbox_token: "token-falso-testes" }),
      /Salve desativado/,
    );
    await salvar("homologacao", 0, false, { sandbox_token: "token-falso-testes" });
    await assert.rejects(() => salvar("homologacao", 0), /outra sessão/);
    await assert.rejects(() => salvar("homologacao", 1, true), /teste a autenticação/);
    await q("select sicoob_autenticado_316($1,$2,1,$3)", [id(1), id(10), "homologacao"]);
    // A conta escolhida na seção de produção não participa da ativação sandbox.
    await q("select sicoob_config_salvar_316($1,$2,$3,$4,true,1,null,'homologacao')", [
      id(1),
      id(10),
      cfg,
      id(70),
    ]);
    assert.equal(
      await scalar(
        `select versao from sicoob_config_316 where centro_id='${id(10)}' and ambiente='homologacao'`,
      ),
      1,
    );
    assert.equal(
      await scalar(
        `select ativo from sicoob_config_316 where centro_id='${id(10)}' and ambiente='homologacao'`,
      ),
      true,
    );
    assert.equal(
      await scalar(`select ativo from cobranca_centros where centro_id='${id(10)}'`),
      false,
      "Sandbox não ativa produção",
    );
    await assert.rejects(() => salvar("producao", 0, false, null, id(2)), /administrador/);
    await assert.rejects(
      () => q("select sicoob_privado_316($1,$2,$3)", [id(2), id(11), "homologacao"]),
      /sem acesso/,
    );
    await salvar("producao", 0, false, {
      pfx: "certificado-falso-somente-fixture",
      senha: "senha-teste",
    });
    await assert.rejects(() => salvar("producao", 1, true), /teste a autenticação/);
    await q("select sicoob_autenticado_316($1,$2,1,$3)", [id(1), id(10), "producao"]);
    await salvar("producao", 1, true);
    const payload = {
      numeroCliente: 12345,
      numeroContaCorrente: 67890,
      valor: 100,
      dataVencimento: "2027-01-20",
      pagador: { numeroCpfCnpj: "98765432185" },
    };
    const reservar = () =>
      scalar("select sicoob_reservar_emissao_316($1,$2,$3)", [id(1), id(40), payload]);
    await db.exec("set test.bloqueio='Confira a separação'");
    await assert.rejects(reservar, /Confira a separação/);
    await db.exec("set test.bloqueio=''");
    await db.query("update pedidos set status='rascunho' where id=$1", [id(30)]);
    await assert.rejects(reservar, /Aprove/);
    await db.query("update pedidos set status='conferido' where id=$1", [id(30)]);
    let r = await reservar();
    const original = r.boleto;
    assert.equal(r.recuperar, false);
    let repetir = await reservar();
    assert.equal(repetir.recuperar, true);
    assert.equal(repetir.boleto.id, original.id);
    const send = (o) => scalar("select sicoob_enviar_316($1,$2)", [id(1), o.id]);
    assert.equal(await send(r.operacao), true);
    assert.equal(await send(r.operacao), false);
    const banco = (b, extra = {}) => ({
      nossoNumero: "10001",
      numeroCliente: 12345,
      codigoModalidade: 1,
      seuNumero: b.seu_numero,
      valor: 100,
      vencimento: "2027-01-20",
      abatimento: 0,
      tipoDesconto: 0,
      descontos: [],
      situacao: "EM ABERTO",
      linhaDigitavel: "756" + "1".repeat(44),
      codigoBarras: "756" + "2".repeat(41),
      ...extra,
    });
    const sync = (b, c, actor = id(1), sandbox = false) =>
      scalar(
        `select ${sandbox ? "sicoob_sandbox_sincronizar_316" : "sicoob_sincronizar_316"}($1,$2,$3)`,
        [actor, b.id, c],
      );
    await assert.rejects(() => sync(original, banco(original, { valor: 99 })), /não corresponde/);
    await assert.rejects(() => sync(original, banco(original), id(3)), /sem acesso/);
    await sync(original, banco(original));
    assert.equal(
      await scalar("select status from boletos where id=$1", [original.id]),
      "registrado",
    );
    const alterar = (b, tipo, anterior, esperado, chave = id(80), sandbox = false, actor = id(1)) =>
      scalar(
        `select to_jsonb(${sandbox ? "sicoob_sandbox_alterar_316" : "sicoob_reservar_alteracao_316"}($1,$2,$3,$4,$5,$6,$7,$8))`,
        [
          actor,
          b.id,
          chave,
          tipo,
          anterior,
          esperado,
          { tipo, teste: true },
          "Negociação de teste",
        ],
      );
    let c = banco(original),
      novo = { ...c, vencimento: "2027-02-20" };
    let op = await alterar(original, "vencimento", c, novo);
    await send(op);
    assert.equal(
      await scalar("select vencimento::text from contas_receber where id=$1", [id(40)]),
      "2027-01-20",
    );
    assert.equal((await sync(original, c)).pendente, true);
    await sync(original, novo);
    assert.equal(
      await scalar("select vencimento::text from contas_receber where id=$1", [id(40)]),
      "2027-02-20",
    );
    c = novo;
    novo = { ...c, abatimento: 5 };
    await assert.rejects(
      () => alterar(original, "abatimento", c, novo, id(81), false, id(2)),
      /administrador/,
    );
    op = await alterar(original, "abatimento", c, novo, id(81));
    assert.equal((await alterar(original, "abatimento", c, novo, id(81))).id, op.id);
    await send(op);
    await sync(original, novo);
    assert.equal(
      Number(await scalar("select desconto from contas_receber where id=$1", [id(40)])),
      0,
      "Abatimento bancário não inventa recebimento financeiro",
    );
    c = novo;
    novo = { ...c, tipoDesconto: 1, descontos: [{ ordem: 1, valor: 2, data: "2027-02-10" }] };
    op = await alterar(original, "desconto", c, novo, id(82));
    await send(op);
    await sync(original, novo);
    c = novo;
    novo = { ...c, situacao: "BAIXADO" };
    op = await alterar(original, "baixar", c, novo, id(83));
    await send(op);
    assert.equal((await sync(original, c)).pendente, true);
    await sync(original, novo);
    assert.equal(
      await scalar("select status from contas_receber where id=$1", [id(40)]),
      "aberto",
      "Baixa do banco não paga nem cancela a dívida",
    );
    await assert.rejects(() => sync(original, c), /ciclo encerrado/);
    // Reemissão real é outro ciclo e outro identificador.
    payload.dataVencimento = "2027-02-20";
    r = await reservar();
    assert.notEqual(r.boleto.id, original.id);
    assert.notEqual(r.boleto.seu_numero, original.seu_numero);
    const realAntes = await q("select to_jsonb(b) dados from boletos b order by id"),
      tituloAntes = await scalar("select to_jsonb(t) from contas_receber t");
    const teste = await scalar("select sicoob_sandbox_reservar_316($1,$2,$3,$4)", [
      id(1),
      id(10),
      id(90),
      payload,
    ]);
    assert.equal(
      (
        await scalar("select sicoob_sandbox_reservar_316($1,$2,$3,$4)", [
          id(1),
          id(10),
          id(90),
          payload,
        ])
      ).boleto.id,
      teste.boleto.id,
    );
    await send(teste.operacao);
    let sb = banco(teste.boleto, { vencimento: "2027-02-20" });
    await sync(teste.boleto, sb, id(1), true);
    for (const [tipo, extra, n] of [
      ["vencimento", { vencimento: "2027-03-20" }, 91],
      ["abatimento", { abatimento: 5 }, 92],
      [
        "desconto",
        { tipoDesconto: 1, descontos: [{ ordem: 1, valor: 2, data: "2027-03-10" }] },
        93,
      ],
      ["baixar", { situacao: "BAIXADO" }, 94],
    ]) {
      const proximo = { ...sb, ...extra };
      op = await alterar(teste.boleto, tipo, sb, proximo, id(n), true);
      await send(op);
      await sync(teste.boleto, proximo, id(1), true);
      sb = proximo;
    }
    assert.deepEqual(await q("select to_jsonb(b) dados from boletos b order by id"), realAntes);
    assert.deepEqual(
      await scalar("select to_jsonb(t) from contas_receber t"),
      tituloAntes,
      "Todos os testes sandbox preservam financeiro e boletos reais",
    );
    await assert.rejects(() => sync(teste.boleto, sb), /sem acesso/);
    assert.equal(
      await scalar(
        "select has_function_privilege('authenticated','sicoob_privado_316(uuid,uuid,text)','execute')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        "select has_table_privilege('authenticated','vault.decrypted_secrets','select')",
      ),
      false,
    );
    await db.exec(
      `set test.actor='${id(3)}';set test.jwtrole='authenticated';set role authenticated`,
    );
    assert.equal(Number(await scalar("select count(*) from sicoob_sandbox_316")), 0);
    await assert.rejects(
      () => q("select sicoob_privado_316($1,$2,$3)", [id(3), id(10), "homologacao"]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec("set test.jwtrole='service_role'");
    const mockAntes = await q("select to_jsonb(b) dados from boletos b order by id"),
      titAntes = await q("select to_jsonb(t) dados from contas_receber t order by id");
    const m = await scalar("select sicoob_sandbox_reservar_316($1,$2,$3,$4)", [
      id(1),
      id(10),
      id(95),
      payload,
    ]);
    await send(m.operacao);
    const mock = {
      nossoNumero: -2147483648,
      codigoModalidade: 1,
      numeroCliente: 12345,
      valor: 156.23,
    };
    await q("select sicoob_mock_recebido_320($1,$2,$3)", [id(1), m.boleto.id, mock]);
    await q("select sicoob_mock_recebido_320($1,$2,$3)", [id(1), m.boleto.id, mock]);
    assert.equal(
      await scalar("select status from sicoob_sandbox_316 where id=$1", [m.boleto.id]),
      "simulado",
    );
    assert.equal(
      await scalar("select nosso_numero from sicoob_sandbox_316 where id=$1", [m.boleto.id]),
      null,
    );
    assert.equal(
      await scalar("select estado from sicoob_operacoes_316 where id=$1", [m.operacao.id]),
      "encerrado",
    );
    await assert.rejects(() =>
      q("select sicoob_mock_recebido_320($1,$2,$3)", [id(1), original.id, mock]),
    );
    assert.deepEqual(await q("select to_jsonb(b) dados from boletos b order by id"), mockAntes);
    assert.deepEqual(
      await q("select to_jsonb(t) dados from contas_receber t order by id"),
      titAntes,
    );
    assert.equal(
      await scalar(
        "select has_function_privilege('authenticated','sicoob_mock_recebido_320(uuid,uuid,jsonb)','execute')",
      ),
      false,
    );
    const before351 = await q("select to_jsonb(b) dados from boletos b order by id");
    const financial351 = await q("select to_jsonb(t) dados from contas_receber t order by id");
    const cfg351 = await scalar(
      "select to_jsonb(c) from sicoob_config_316 c where centro_id=$1 and ambiente='producao'",
      [id(10)],
    );
    const migration351 = fs.readFileSync("db/fase351_sicoob_condicoes_emissao.sql", "utf8");
    await db.exec(migration351);
    await db.exec(migration351);
    assert.deepEqual(await q("select to_jsonb(b) dados from boletos b order by id"), before351);
    assert.deepEqual(
      await q("select to_jsonb(t) dados from contas_receber t order by id"),
      financial351,
    );
    assert.equal(
      await scalar(
        "select has_function_privilege('authenticated','sicoob_config_salvar_351(uuid,uuid,jsonb,uuid,boolean,int,jsonb,text)','execute')",
      ),
      false,
    );
    const config351 = {
      client_id: cfg351.client_id,
      numero_cliente: cfg351.numero_cliente,
      numero_conta: cfg351.numero_conta,
      numero_contrato: cfg351.numero_contrato,
      condicoes_emissao: { multaTipo: 2, multaValor: 2 },
    };
    await assert.rejects(
      () =>
        q("select sicoob_config_salvar_351($1,$2,$3,$4,true,$5)", [
          id(1),
          id(10),
          config351,
          id(70),
          cfg351.versao,
        ]),
      /Salve/,
    );
    await assert.rejects(
      () =>
        q("select sicoob_config_salvar_351($1,$2,$3,$4,false,$5)", [
          id(2),
          id(10),
          config351,
          id(70),
          cfg351.versao,
        ]),
      /administrador/,
    );
    await q("select sicoob_config_salvar_351($1,$2,$3,$4,false,$5)", [
      id(1),
      id(10),
      config351,
      id(70),
      cfg351.versao,
    ]);
    const after351 = await scalar(
      "select to_jsonb(c) from sicoob_config_316 c where centro_id=$1 and ambiente='producao'",
      [id(10)],
    );
    assert.deepEqual(after351.condicoes_emissao, config351.condicoes_emissao);
    assert.equal(after351.autenticado_em, null);
    assert.equal(after351.ativo, false);
    assert.equal(after351.versao, cfg351.versao + 1);
    await assert.rejects(
      () =>
        q("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [
          id(1),
          id(40),
          payload,
          cfg351.versao,
        ]),
      /condições/,
    );
    assert.deepEqual(await q("select to_jsonb(b) dados from boletos b order by id"), before351);
    assert.deepEqual(
      await q("select to_jsonb(t) dados from contas_receber t order by id"),
      financial351,
    );
    await db.exec("begin");
    await q("select sicoob_autenticado_316($1,$2,$3,'producao')", [id(1), id(10), after351.versao]);
    await q("select sicoob_config_salvar_351($1,$2,$3,$4,true,$5)", [
      id(1),
      id(10),
      config351,
      id(70),
      after351.versao,
    ]);
    await q(
      "insert into contas_receber(id,centro_id,cliente_id,status,documento,parcela,valor,vencimento) values($1,$2,$3,'aberto','TESTE351',1,100,'2027-01-20')",
      [id(140), id(10), id(20)],
    );
    const payload351 = { ...payload, dataVencimento: "2027-01-20" };
    const first351 = await scalar("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [
      id(1),
      id(140),
      payload351,
      after351.versao,
    ]);
    assert.equal(first351.recuperar, false);
    assert.deepEqual(
      await scalar("select sicoob_snapshot_316->'condicoes_emissao' from boletos where id=$1", [
        first351.boleto.id,
      ]),
      config351.condicoes_emissao,
    );
    const replay351 = await scalar("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [
      id(1),
      id(140),
      payload351,
      after351.versao,
    ]);
    assert.equal(replay351.recuperar, true);
    assert.equal(replay351.boleto.id, first351.boleto.id);
    assert.equal(replay351.operacao.id, first351.operacao.id);
    await db.exec("rollback");
    const snapshot352 = await scalar(
      "select jsonb_build_object('boletos',(select jsonb_agg(to_jsonb(b) order by id) from boletos b),'titulos',(select jsonb_agg(to_jsonb(t) order by id) from contas_receber t),'cobranca',(select jsonb_agg(to_jsonb(c) order by centro_id,ambiente) from sicoob_config_316 c))",
    );
    const migration352 = fs.readFileSync("db/fase352_sicoob_extrato_leitura.sql", "utf8");
    await db.exec(migration352);
    await db.exec(migration352);
    assert.equal(
      await scalar(
        "select has_function_privilege('authenticated','sicoob_extrato_reservar_352(uuid,uuid)','execute')",
      ),
      false,
    );
    await assert.rejects(
      () =>
        q("select sicoob_extrato_salvar_352($1,$2,'extrato-client','123',0,null)", [id(2), id(10)]),
      /administrador/,
    );
    await q("select sicoob_extrato_salvar_352($1,$2,'extrato-client','123',0,$3)", [
      id(1),
      id(10),
      { pfx: "pfx-falso-fixture", senha: "segredo-falso" },
    ]);
    const safe352 = await scalar("select sicoob_extrato_config_352($1,$2)", [id(1), id(10)]);
    assert.deepEqual(safe352, {
      clientId: "extrato-client",
      numeroConta: "123",
      certificado: true,
      versao: 1,
    });
    assert.doesNotMatch(JSON.stringify(safe352), /pfx|senha|segredo/);
    await assert.rejects(
      () => q("select sicoob_extrato_salvar_352($1,$2,'outro','999',0,null)", [id(1), id(10)]),
      /outra sessão/,
    );
    await q("select sicoob_extrato_salvar_352($1,$2,'extrato-client','123',1,null)", [
      id(1),
      id(10),
    ]);
    const priv352 = await scalar("select sicoob_extrato_reservar_352($1,$2)", [id(1), id(10)]);
    assert.equal(priv352.certificado.senha, "segredo-falso");
    await assert.rejects(
      () => q("select sicoob_extrato_reservar_352($1,$2)", [id(1), id(10)]),
      /quinze segundos/,
    );
    assert.equal(
      await scalar(
        "select jsonb_build_object('boletos',(select jsonb_agg(to_jsonb(b) order by id) from boletos b),'titulos',(select jsonb_agg(to_jsonb(t) order by id) from contas_receber t),'cobranca',(select jsonb_agg(to_jsonb(c) order by centro_id,ambiente) from sicoob_config_316 c))",
      ).then(JSON.stringify),
      JSON.stringify(snapshot352),
    );
    console.log(
      "OK: configuração por loja/ambiente, cofre privado, permissões, idempotência, aprovação/liberação, confirmações bancárias, vencimentos, cancelamento, descontos e sandbox isolado do financeiro.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
