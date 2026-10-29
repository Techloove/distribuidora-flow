const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
 create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
 create function has_role(uuid,text) returns boolean language sql as $$select $1='${id(1)}'::uuid and coalesce(current_setting('test.admin',true),'true')='true'$$;
 create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid and $2='${id(10)}'::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select true$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
 create function cnab_validar_ator(uuid,uuid) returns void language sql as $$select null::void$$;
 create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${id(1)}',true);
 grant select on profiles to authenticated;
 create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
 create table contas_receber(id uuid primary key,centro_id uuid,status text,valor numeric,juros numeric,multa numeric,acrescimo numeric,desconto numeric,valor_pago numeric,vencimento date);
 insert into contas_receber values('${id(20)}','${id(10)}','aberto',100,0,0,0,0,0,'2026-11-20');
 create table boletos(id uuid primary key,conta_receber_id uuid,centro_id uuid,banco text,canal text,status text,nosso_numero text,valor numeric,vencimento date,vencimento_solicitacao_id uuid,retorno jsonb,baixa_motivo_285 text,vencimento_solicitado date);
 insert into boletos values('${id(30)}','${id(20)}','${id(10)}','sicredi','api','registrado','600000001',100,'2026-11-20',null,'{}',null,null);
 create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
 create table sicredi_cnab_config(centro_id uuid,updated_at timestamptz,proxima_remessa int);
 create table sicredi_cnab_arquivos(id uuid default gen_random_uuid(),centro_id uuid,tipo text,sequencia int,nome text,conteudo text,sha256 text,quantidade int,created_by uuid);
 create table sicredi_boleto_alteracoes(id uuid default gen_random_uuid(),boleto_id uuid,centro_id uuid,vencimento_anterior date,vencimento_novo date,canal text,arquivo_id uuid,created_by uuid);
 `);
    for (const [file, name] of [
      ["fase205_sicredi_alteracao_vencimento.sql", "sicredi_solicitar_vencimento"],
      ["fase285_cancelamento_devolucao_pedidos.sql", "autorizar_baixa_boleto_285"],
    ]) {
      const src = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = src.indexOf("create or replace function public." + name + "(");
      await d.exec(src.slice(a, src.indexOf("$$;", a) + 3));
    }
    const sql = fs.readFileSync(
      path.join(root, "db/fase292_sicredi_desconto_abatimento.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    const anterior = {
        nominal: 100,
        abatimento: 0,
        tipoDesconto: "SEM_DESCONTO",
        descontos: [],
        vencimento: "2026-11-20",
        situacao: "EM CARTEIRA",
      },
      esperado = { ...anterior, abatimento: 10 };
    const reservar = (key = 40, actor = 1) =>
      d.query("select sicredi_reservar_condicoes_292($1,$2,$3,$4,$5,$6,$7) r", [
        id(actor),
        id(30),
        id(key),
        "abatimento",
        "Desconto negociado",
        JSON.stringify(anterior),
        JSON.stringify(esperado),
      ]);
    const finalizar = (s, estado, banco = null) =>
      d.query("select sicredi_finalizar_condicoes_292($1,$2,$3,$4,$5)", [
        id(1),
        id(30),
        s,
        estado,
        banco && JSON.stringify(banco),
      ]);
    await d.exec("set test.role='authenticated'");
    await assert.rejects(() => reservar(), /administrador/);
    await d.exec("set test.role='service_role';set test.admin='false'");
    await assert.rejects(() => reservar(), /administrador/);
    await d.exec("set test.admin='true'");
    await assert.rejects(() => reservar(40, 2), /administrador/);
    await d.exec("update profiles set ativo=false");
    await assert.rejects(() => reservar(), /administrador/);
    await d.exec("update profiles set ativo=true");
    await d.exec(`update boletos set centro_id='${id(11)}'`);
    await assert.rejects(() => reservar(), /acesso/);
    await d.exec(`update boletos set centro_id='${id(10)}'`);
    for (const status of ["liquidado", "baixado", "cancelado"]) {
      await d.query("update boletos set status=$1", [status]);
      await assert.rejects(() => reservar(), /registrado/);
    }
    await d.exec("update boletos set status='registrado'");
    await d.exec("update contas_receber set valor_pago=1");
    await assert.rejects(() => reservar(), /Título mudou/);
    await d.exec("update contas_receber set valor_pago=0");
    const s = (await reservar()).rows[0].r;
    assert.equal(s.enviar, true);
    assert.equal((await reservar()).rows[0].r.enviar, false);
    await assert.rejects(() => reservar(41), /pendente/);
    await assert.rejects(
      () => d.query("select autorizar_baixa_boleto_285($1,$2)", [id(30), "Cancelar com motivo"]),
      /pendente/,
    );
    await assert.rejects(
      () =>
        d.query("select sicredi_solicitar_vencimento($1,$2,$3,$4,null)", [
          id(1),
          id(30),
          "2026-12-20",
          "2026-11-20",
        ]),
      /pendente/,
    );
    await finalizar(s.id, "incerto");
    assert.equal((await d.query("select valor from contas_receber")).rows[0].valor, "100");
    await assert.rejects(() => finalizar(s.id, "confirmado", anterior), /não confirmou/);
    await finalizar(s.id, "enviado");
    await finalizar(s.id, "confirmado", esperado);
    await finalizar(s.id, "confirmado", esperado);
    assert.equal(
      (await d.query("select condicoes_sicredi_292 from boletos")).rows[0].condicoes_sicredi_292
        .abatimento,
      10,
    );
    assert.equal(
      (await d.query("select valor,valor_pago,desconto from contas_receber")).rows[0].valor,
      "100",
    );
    assert.equal(
      (await d.query("select count(*)::int n from sicredi_condicoes_historico_292")).rows[0].n,
      1,
    );
    const s2 = (await reservar(42)).rows[0].r;
    await finalizar(s2.id, "rejeitado");
    assert.equal(
      (await d.query("select condicoes_pendente_292 from boletos")).rows[0].condicoes_pendente_292,
      null,
    );
    const s3 = (await reservar(43)).rows[0].r;
    await assert.rejects(() => finalizar(s3.id, "encerrado", esperado), /Encerramento/);
    await finalizar(s3.id, "encerrado", { ...esperado, situacao: "LIQUIDADO" });
    await d.exec("set role authenticated");
    await assert.rejects(() => reservar(44), /permission denied/);
    await assert.rejects(
      () => d.query("delete from sicredi_condicoes_historico_292"),
      /permission denied/,
    );
    assert.equal(
      (await d.query("select count(*)::int n from sicredi_condicoes_historico_292")).rows[0].n,
      3,
    );
    await d.exec("reset role;set test.admin='false';set role authenticated");
    assert.equal(
      (await d.query("select count(*)::int n from sicredi_condicoes_historico_292")).rows[0].n,
      0,
    );
    console.log(
      "OK: fase292 repetível, reserva/idempotência, administrador/loja/RLS, pendências de baixa/vencimento, confirmação bancária e financeiro nominal preservado.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
