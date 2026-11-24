// PGlite: competência por aprovação, virada do mês, fuso, reabertura e escopo.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];
  try {
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/comissoes-retomada-motores-302.json", "utf8"),
    ))
      await db.exec(d);
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/calculo-comissao-303.json", "utf8"),
    ))
      await db.exec(d);
    await db.exec(fs.readFileSync("db/fase302_comissoes_aprovadas_data_retomada.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase304_representante_sem_comissao.sql", "utf8"));
    await db.exec(
      `alter table comissoes alter column id set default gen_random_uuid();insert into profiles(id,ativo) values('${id(1)}',true);insert into representantes(id,nome,comissao_percentual) values('${id(20)}','Vendedor',5);insert into centros(id,nome) values('${id(10)}','Loja'),('${id(11)}','Outra');insert into clientes(id,razao_social) values('${id(21)}','Cliente');`,
    );
    for (const n of [30, 31, 32, 33]) {
      await db.query(
        `insert into pedidos(id,numero,tipo_documento,status,representante_id,cliente_id,centro_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor,data_pedido,ciclo_reabertura_289,modalidade_venda) values($1,$2,'pedido','confirmado',$3,$4,$5,100,100,0,5,5,'2026-10-31',$6,'estoque')`,
        [id(n), n, id(20), id(21), n === 33 ? id(11) : id(10), n === 32 ? 1 : 0],
      );
      await db.query(
        `insert into comissoes(id,pedido_id,representante_id,centro_id,base_calculo,percentual,valor,status) select gen_random_uuid(),id,representante_id,centro_id,100,5,5,case when numero=31 then 'paga' else 'prevista' end from pedidos where id=$1`,
        [id(n)],
      );
    }
    const hist = async (n, anterior, novo, em) =>
      db.query(
        `insert into pedido_status_historico(id,pedido_id,status_anterior,status_novo,created_at) values(gen_random_uuid(),$1,$2,$3,$4)`,
        [id(n), anterior, novo, em],
      );
    await hist(30, "rascunho", "confirmado", "2026-11-02T15:00:00Z");
    await hist(31, "rascunho", "confirmado", "2026-11-01T02:30:00Z");
    await hist(32, "rascunho", "confirmado", "2026-10-15T15:00:00Z");
    await hist(32, "cancelado", "rascunho", "2026-11-01T15:00:00Z");
    await hist(32, "aguardando_aprovacao", "aprovado", "2026-11-02T15:00:00Z");
    await hist(33, "rascunho", "confirmado", "2026-11-02T15:00:00Z");
    const before = await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c");
    const m = fs.readFileSync("db/fase305_competencia_comissao_aprovacao.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    const views = [
      "vw_comissoes_detalhe",
      "vw_comissoes_detalhe_mod_300",
      "vw_comissoes_resumo",
      "vw_comissoes_resumo_mod_300",
    ];
    const snapshot = async () => {
      const out = {};
      for (const nome of views)
        out[nome] = await scalar(
          `select coalesce(jsonb_agg(x order by x::text),'[]') from (select to_jsonb(t) x from ${nome} t) s`,
        );
      return out;
    };
    const anterior = await snapshot();
    const migracao = fs.readFileSync("db/fase372_comissoes_consulta_rapida.sql", "utf8");
    await db.exec(migracao);
    await db.exec(migracao);
    assert.deepEqual(await snapshot(), anterior, "Resultados das visões preservados");
    await db.exec(
      `create or replace function data_comissao_305(_pedido uuid) returns date language plpgsql stable as $$begin raise exception 'Chamada escalar por linha';end$$;`,
    );

    await snapshot();
    await db.query("select resumo_comissoes_loja_295($1)", [id(10)]);
    await db.query("select resumo_comissoes_loja_295_mod_300($1)", [id(10)]);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c"),
      before,
    );
    // As mesmas visões obedecem ao RLS do chamador, inclusive após a reescrita.
    await db.exec(`grant usage on schema public,auth to authenticated;grant select on all tables in schema public to authenticated;
      alter table pedidos enable row level security;alter table comissoes enable row level security;
      create policy teste_pedidos_372 on pedidos for select to authenticated using(usuario_pode_acessar_centro(centro_id));
      create policy teste_comissoes_372 on comissoes for select to authenticated using(usuario_pode_acessar_centro(centro_id));
      set role authenticated;`);
    assert.equal(
      await scalar("select count(*)::int from vw_comissoes_detalhe where centro_id=$1", [id(11)]),
      0,
      "Loja sem acesso continua oculta",
    );
    assert.equal(
      await scalar("select count(*)::int from vw_comissoes_detalhe where centro_id=$1", [id(10)]),
      3,
    );
    await db.exec(`set request.headers='{"x-modalidade-venda":"intermediacao"}'`);
    assert.equal(
      await scalar("select count(*)::int from vw_comissoes_detalhe_mod_300"),
      0,
      "Outra modalidade continua fora",
    );
    await db.exec(`set request.headers='{"x-modalidade-venda":"estoque"}'`);
    assert.equal(await scalar("select count(*)::int from vw_comissoes_detalhe_mod_300"), 3);
    await db.exec(`reset role;set request.headers='{}'`);
    await db.query(
      `insert into representantes(id,nome,recebe_comissao) values($1,'Sem comissão',false)`,
      [id(99)],
    );
    await db.query(
      `insert into pedidos(id,numero,tipo_documento,status,centro_id,representante_id,data_pedido) values($1,99,'pedido','confirmado',$2,$3,current_date)`,
      [id(99), id(10), id(99)],
    );
    assert.equal(
      await scalar("select count(*)::int from vw_comissoes_detalhe where representante_id=$1", [
        id(99),
      ]),
      0,
      "Sem comissão retorna vazio sem erro",
    );
    console.log(
      "Fase372: competência por aprovação/ciclo, fuso, valores e visões preservados; sem chamadas escalares por linha.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
