const fs = require("node:fs"),
  assert = require("node:assert/strict");
const criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  try {
    for (const f of ["comissoes-retomada-motores-302.json", "calculo-comissao-303.json"])
      for (const sql of JSON.parse(fs.readFileSync("scripts/fixtures/" + f, "utf8")))
        await db.exec(sql);
    for (const f of [
      "fase302_comissoes_aprovadas_data_retomada.sql",
      "fase304_representante_sem_comissao.sql",
    ])
      await db.exec(fs.readFileSync("db/" + f, "utf8"));
    await db.exec(`alter table auditoria alter column id set default gen_random_uuid();alter table comissoes alter column id set default gen_random_uuid();
   insert into profiles(id,ativo) values('00000000-0000-4000-8000-000000000001',true);
   insert into centros(id,nome) values('00000000-0000-4000-8000-000000000010','Loja');
   insert into representantes(id,nome,comissao_percentual,recebe_comissao) values('00000000-0000-4000-8000-000000000020','Vendedor',5,true);`);
    const scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];
    const seed = async (n, oldBase, newBase, newValue, status = "cancelada") => {
      const id = await scalar(
        `insert into pedidos(id,numero,tipo_documento,status,centro_id,representante_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor,ciclo_reabertura_289,comissao_habilitada) values(gen_random_uuid(),$1,'pedido','confirmado','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020',$2,$2,0,5,$3,1,true) returning id`,
        [n, newBase, newValue],
      );
      await db.query(
        `insert into comissoes(id,pedido_id,representante_id,base_calculo,base_original,valor,valor_original,percentual,status,centro_id) values(gen_random_uuid(),$1,'00000000-0000-4000-8000-000000000020',$2,$2,round($2*.05,2),round($2*.05,2),5,$3,'00000000-0000-4000-8000-000000000010')`,
        [id, oldBase, status],
      );
      return id;
    };
    const sample = await seed(1, 989, 1978, 98.9);
    await db.query("select apurar_comissao_pedido($1)", [sample]);
    assert.equal(
      Number(await scalar("select valor from comissoes where pedido_id=$1", [sample])),
      49.45,
      "reproduz defeito anterior",
    );
    await db.query("update comissoes set status='cancelada' where pedido_id=$1", [sample]);
    const sql = fs.readFileSync("db/fase373_comissao_novo_ciclo.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    for (const [id, base, value] of [
      [sample, 1978, 98.9],
      [await seed(2, 3016.6, 2986.62, 149.33), 2986.62, 149.33],
      [await seed(3, 5482.4, 5317.93, 265.9), 5317.93, 265.9],
    ]) {
      await db.query("select apurar_comissao_pedido($1)", [id]);
      const cm = (await db.query("select * from comissoes where pedido_id=$1", [id])).rows[0];
      assert.equal(Number(cm.base_original), base);
      assert.equal(Number(cm.valor), value);
      assert.equal(Number(cm.valor_original), value);
      await db.query("update pedidos set comissao_valor=999 where id=$1", [id]);
      await db.query("select apurar_comissao_pedido($1)", [id]);
      assert.equal(
        Number(await scalar("select valor from comissoes where pedido_id=$1", [id])),
        value,
        "preserva novo snapshot",
      );
    }
    const paid = await seed(4, 100, 200, 10, "paga");
    await db.query("select apurar_comissao_pedido($1)", [paid]);
    assert.equal(Number(await scalar("select valor from comissoes where pedido_id=$1", [paid])), 5);
    const scheduled = await seed(5, 100, 200, 10);
    await db.exec(
      `insert into comissao_pagamentos(id,status) values('00000000-0000-4000-8000-000000000050','gerado'); insert into comissao_pagamento_itens(id,pagamento_id,comissao_id) select gen_random_uuid(),'00000000-0000-4000-8000-000000000050',id from comissoes where pedido_id='${scheduled}'`,
    );
    await assert.rejects(
      () => db.query("select apurar_comissao_pedido($1)", [scheduled]),
      /paga ou agendada/,
    );
    assert.equal(
      Number(await scalar("select valor from comissoes where pedido_id=$1", [scheduled])),
      5,
    );
    const draft = await seed(6, 100, 200, 10);
    await db.query("update pedidos set status='rascunho' where id=$1", [draft]);
    await db.query("select apurar_comissao_pedido($1)", [draft]);
    assert.equal(
      Number(await scalar("select valor from comissoes where pedido_id=$1", [draft])),
      5,
    );
    const parcelada = await seed(7, 100, 200, 10);
    await db.exec(`insert into contas_pagar(id,status,valor_pago) values('00000000-0000-4000-8000-000000000070','cancelado',1);
   insert into comissao_parcelas(id,comissao_id,conta_pagar_id) select gen_random_uuid(),id,'00000000-0000-4000-8000-000000000070' from comissoes where pedido_id='${parcelada}'`);
    await assert.rejects(
      () => db.query("select apurar_comissao_pedido($1)", [parcelada]),
      /paga ou agendada/,
    );
    await db.query(
      "update contas_pagar set valor_pago=0 where id='00000000-0000-4000-8000-000000000070'",
    );
    await db.query("select apurar_comissao_pedido($1)", [parcelada]);
    assert.equal(
      Number(await scalar("select valor from comissoes where pedido_id=$1", [parcelada])),
      10,
      "agendamento cancelado sem pagamento permite novo ciclo",
    );
    assert.equal(
      Number(await scalar("select count(*) from auditoria where acao='novo_ciclo_373'")),
      4,
    );
    assert.equal(Number(await scalar("select count(*) from movimentos_financeiros")), 0);
    if (process.env.REPARO_373) {
      // Arquivo privado opcional: valida o SQL exato entregue, sem dados reais no repositório.
      await db.exec(
        `create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select true$$;`,
      );
      const repair = fs.readFileSync(process.env.REPARO_373, "utf8");
      const tuples = [
        ...repair.matchAll(
          /\('([0-9a-f-]{36})'::uuid,'([0-9a-f-]{36})'::uuid,(\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/g,
        ),
      ].map((m) => m.slice(1).map((v, i) => (i < 2 ? v : Number(v))));
      assert.equal(tuples.length, 3);
      for (const [pid, cid, n, old, ov, total, disc, val] of tuples) {
        await db.query(
          `insert into pedidos(id,numero,tipo_documento,status,centro_id,representante_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor,ciclo_reabertura_289,comissao_habilitada) values($1,$2,'pedido','entregue','${repair.match(/p.centro_id is distinct from '([0-9a-f-]{36})'/)[1]}','00000000-0000-4000-8000-000000000020',$3,$3::numeric-$4::numeric,$4,5,$5,1,true)`,
          [pid, n, total, disc, val],
        );
        await db.query(
          `insert into comissoes(id,pedido_id,representante_id,centro_id,base_original,base_calculo,valor_original,valor,percentual,status) values($1,$2,'00000000-0000-4000-8000-000000000020','${repair.match(/p.centro_id is distinct from '([0-9a-f-]{36})'/)[1]}',$3,$3,$4,$4,5,'prevista')`,
          [cid, pid, old, ov],
        );
      }
      await db.query("update comissoes set status='paga' where pedido_id=$1", [tuples[2][0]]);
      await assert.rejects(() => db.exec(repair), /paga\/agendada|mudou/);
      await db.exec("rollback");
      assert.equal(
        Number(await scalar("select valor from comissoes where id=$1", [tuples[0][1]])),
        150.83,
        "reparo atômico: primeiro pedido não muda se terceiro bloqueado",
      );
      await db.query("update comissoes set status='prevista' where pedido_id=$1", [tuples[2][0]]);
      await db.exec(repair);
      await db.exec(repair);
      for (const [, cid, , , , total, disc, val] of tuples) {
        assert.equal(Number(await scalar("select valor from comissoes where id=$1", [cid])), val);
        assert.equal(
          Number(await scalar("select base_original from comissoes where id=$1", [cid])),
          Number((total - disc).toFixed(2)),
        );
      }
      assert.equal(
        Number(await scalar("select count(*) from auditoria where acao='regularizar_ciclo_373'")),
        3,
      );
      console.log(
        "OK: SQL privado validado; rollback integral quando há comissão paga; três correções e repetição idempotente.",
      );
    }
    console.log(
      "OK: defeito reproduzido; novos ciclos aumentam/reduzem base e respeitam abatimento; snapshot preservado; paga/agendada bloqueadas; digitação excluída; migração idempotente; sem movimentos financeiros.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery || "");
  process.exit(1);
});
