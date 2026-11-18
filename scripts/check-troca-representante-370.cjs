const assert = require("node:assert/strict");
const fs = require("node:fs");
const criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  try {
    await db.exec(
      `alter table auditoria alter column id set default gen_random_uuid();create or replace function has_role(uuid,app_role) returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')='true'$$;`,
    );
    const sql = fs.readFileSync("db/fase370_alterar_representante_pedido.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const [p, a, b, c, t, cp, pg] = [20, 21, 22, 23, 24, 25, 26].map(id),
      centro = id(10);
    await db.query(
      `insert into representantes(id,nome,ativo,centro_id) values($1,'A',true,$3),($2,'B',true,$3)`,
      [a, b, centro],
    );
    await db.query(
      `insert into pedidos(id,tipo_documento,status,representante_id,centro_id,comissao_valor) values($1,'pedido','faturado',$2,$3,5);`,
      [p, a, centro],
    );
    await db.query(
      `insert into comissoes(id,pedido_id,representante_id,status,valor) values($1,$2,$3,'liberada',5)`,
      [c, p, a],
    );
    const trocar = () => db.query(`select alterar_representante_pedido_370($1,$2,$3)`, [p, b, a]);
    await db.exec(`set test.admin='false'`);
    await assert.rejects(trocar, /Somente administrador/);
    await assert.rejects(
      db.query("update pedidos set representante_id=$1 where id=$2", [b, p]),
      /Somente administrador/,
    );
    await db.exec(`set test.admin='true'`);
    await db.query(`update comissoes set status='paga' where id=$1`, [c]);
    await assert.rejects(trocar, /já paga/);
    await db.query(`update comissoes set status='liberada' where id=$1`, [c]);
    await db.query(`insert into contas_pagar(id,status,valor_pago) values($1,'parcial',1)`, [t]);
    await db.query(
      `insert into comissao_parcelas(id,comissao_id,conta_pagar_id) values($1,$2,$3)`,
      [cp, c, t],
    );
    await assert.rejects(trocar, /já paga/);
    await db.query(`update contas_pagar set status='aberto',valor_pago=0 where id=$1`, [t]);
    await assert.rejects(trocar, /Estorne o agendamento/);
    await db.query(`update contas_pagar set status='cancelado' where id=$1`, [t]);
    await db.query(
      `insert into comissao_pagamentos(id,conta_pagar_id,status) values($1,$2,'cancelado')`,
      [pg, t],
    );
    await db.query(
      `insert into comissao_pagamento_itens(id,pagamento_id,comissao_id) values(gen_random_uuid(),$1,$2)`,
      [pg, c],
    );
    await db.query(`update contas_pagar set valor_pago=1 where id=$1`, [t]);
    await assert.rejects(trocar, /já paga/);
    await db.query(`update contas_pagar set valor_pago=0 where id=$1`, [t]);
    await db.query(`update representantes set ativo=false where id=$1`, [b]);
    await assert.rejects(trocar, /ativo/);
    await db.query(`update representantes set ativo=true,centro_id=$2 where id=$1`, [b, id(99)]);
    await assert.rejects(trocar, /da loja/);
    await db.query(`update representantes set centro_id=null where id=$1`, [b]);
    await trocar();
    const r = (await db.query("select representante_id,valor from comissoes where id=$1", [c]))
      .rows[0];
    assert.equal(r.representante_id, b);
    assert.equal(Number(r.valor), 5);
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from auditoria where acao='alterar_representante_370'`,
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(trocar, /outro usuário/);
    console.log(
      "Troca370: admin, escrita direta, pagamento integral/parcial, agendamento, loja, inativo, auditoria e concorrência otimista OK.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
