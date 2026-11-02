// PGlite: prioridade do produto, desativação por representante e preservação histórica.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
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
    const m = fs.readFileSync("db/fase304_representante_sem_comissao.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    const uid = "00000000-0000-4000-8000-000000000001",
      rep = "00000000-0000-4000-8000-000000000020",
      pes = "00000000-0000-4000-8000-000000000021",
      prod = "00000000-0000-4000-8000-000000000022",
      centro = "00000000-0000-4000-8000-000000000010",
      cli = "00000000-0000-4000-8000-000000000023";
    await db.exec(
      `alter table auditoria alter column id set default gen_random_uuid();alter table comissoes alter column id set default gen_random_uuid();insert into profiles(id,ativo) values('${uid}',true);insert into centros(id,nome) values('${centro}','Loja');insert into pessoas(id,razao_social) values('${pes}','Sócio');insert into representantes(id,pessoa_id,nome,comissao_percentual) values('${rep}','${pes}','Sócio',5);insert into clientes(id,razao_social) values('${cli}','Cliente');insert into produtos(id,descricao,comissao_percentual) values('${prod}','Produto',8);create trigger trg_apurar after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function trg_apurar_comissao_pedido();`,
    );
    const scalar = async (q, a = []) => {
      const v = Object.values((await db.query(q, a)).rows[0])[0];
      return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    };
    const novo = async (n) => {
      const id = await scalar(
        `insert into pedidos(id,numero,tipo_documento,status,centro_id,cliente_id,representante_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor,data_pedido) values(gen_random_uuid(),$1,'pedido','rascunho',$2,$3,$4,100,100,0,5,5,current_date) returning id`,
        [n, centro, cli, rep],
      );
      await db.query(
        `insert into pedido_itens(id,pedido_id,produto_id,quantidade,total) values(gen_random_uuid(),$1,$2,10,100)`,
        [id, prod],
      );
      return id;
    };
    const antigo = await novo(1);
    assert.equal(await scalar("select calcular_comissao_itens_215($1)", [antigo]), 8);
    await db.query(
      `update pedidos set comissao_valor=8,comissao_percentual=8,status='aprovado' where id=$1`,
      [antigo],
    );
    assert.equal(await scalar("select valor from comissoes where pedido_id=$1", [antigo]), 8);
    await db.query("update pessoas set recebe_comissao=false where id=$1", [pes]);
    assert.equal(
      await scalar("select recebe_comissao from representantes where id=$1", [rep]),
      false,
    );
    assert.equal(
      await scalar("select calcular_comissao_itens_215($1)", [antigo]),
      8,
      "Histórico aprovado permanece",
    );
    const dono = await novo(2);
    assert.equal(await scalar("select calcular_comissao_itens_215($1)", [dono]), 0);
    await db.query(
      `update pedidos set comissao_valor=99,comissao_percentual=99,status='aprovado' where id=$1`,
      [dono],
    );
    assert.equal(await scalar("select comissao_valor from pedidos where id=$1", [dono]), 0);
    assert.equal(await scalar("select count(*) from comissoes where pedido_id=$1", [dono]), 0);
    await assert.rejects(
      () =>
        db.query(
          `insert into comissoes(id,pedido_id,representante_id,status,valor) values(gen_random_uuid(),$1,$2,'prevista',8)`,
          [dono, rep],
        ),
      /habilitada/,
    );
    await db.query("update representantes set recebe_comissao=true where id=$1", [rep]);
    assert.equal(await scalar("select recebe_comissao from pessoas where id=$1", [pes]), true);
    assert.equal(
      await scalar("select calcular_comissao_itens_215($1)", [dono]),
      0,
      "Ativar cadastro não reescreve venda aprovada sem comissão",
    );
    const novoAtivo = await novo(3);
    assert.equal(await scalar("select calcular_comissao_itens_215($1)", [novoAtivo]), 8);
    await db.exec(
      `create or replace function has_role(uuid,app_role) returns boolean language sql as $$select false$$`,
    );
    await assert.rejects(
      () => db.query("update pessoas set recebe_comissao=false where id=$1", [pes]),
      /Somente administrador/,
    );
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    assert.equal(await scalar("select count(*) from contas_pagar"), 0);
    console.log(
      "OK: padrão habilitado, produto 8% prevalece sobre 5%, sócio desabilitado gera zero, histórico preservado, sincronização e permissão de administrador.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery ?? "");
  process.exit(1);
});
