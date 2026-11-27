const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;
create function usuario_ativo() returns boolean language sql as $$select current_setting('t.ativo',true)='true'$$;
create function complemento_pendente_238() returns boolean language sql as $$select false$$;
create function escopo_representante() returns boolean language sql as $$select current_setting('t.rep',true)='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select $2='${id(188)}'::uuid$$;
create table pedidos(id uuid,centro_id uuid);create table pedido_itens(pedido_id uuid,produto_id uuid);
create table produtos(id uuid,codigo text,descricao text,unidade text,peso_kg numeric,custo_medio numeric,ativo boolean);
alter table produtos enable row level security;
grant select on produtos to authenticated;
create policy leitura_incompleta on produtos for select to authenticated using(not escopo_representante() or codigo not in('21','26','12','32'));
insert into pedidos values('${id(188)}','${id(1)}'),('${id(189)}','${id(1)}'),('${id(190)}','${id(2)}');
set t.ativo='true';set t.rep='true';`);
    for (const code of [21, 26, 12, 32, 2]) {
      await d.query("insert into produtos values($1,$2,$3,$4,1,99,false)", [
        id(code + 1000),
        String(code),
        "Produto " + code,
        "KG",
      ]);
      await d.query("insert into pedido_itens values($1,$2)", [id(188), id(code + 1000)]);
    }
    await d.query("insert into pedido_itens values($1,$2)", [id(188), id(1021)]);
    const sql = fs.readFileSync("db/fase380_produtos_impressao_pedidos.sql", "utf8");
    await d.exec(sql);
    await d.exec(sql);
    await d.exec("set role authenticated");
    assert.equal((await d.query("select * from produtos")).rows.length, 1);
    const rows = await d.query("select * from produtos_impressao_pedidos_380($1)", [[id(188)]]);
    assert.equal(rows.rows.length, 5);
    assert.deepEqual(
      Object.keys(rows.rows[0]).sort(),
      ["id", "codigo", "descricao", "unidade", "peso_kg"].sort(),
    );
    for (const p of [id(189), id(190), id(999)])
      await assert.rejects(
        d.query("select * from produtos_impressao_pedidos_380($1)", [[id(188), p]]),
        /Pedido sem acesso/,
      );
    for (const p of [[], [null], Array(101).fill(id(188))])
      await assert.rejects(
        d.query("select * from produtos_impressao_pedidos_380($1)", [p]),
        /Seleção/,
      );
    await d.exec("set t.rep='false'");
    assert.equal(
      (await d.query("select * from produtos_impressao_pedidos_380($1)", [[id(188)]])).rows.length,
      5,
    );
    await d.exec("set t.ativo='false'");
    await assert.rejects(
      d.query("select * from produtos_impressao_pedidos_380($1)", [[id(188)]]),
      /Usuário sem acesso/,
    );
    await d.exec("reset role;set role anon");
    await assert.rejects(
      d.query("select * from produtos_impressao_pedidos_380($1)", [[id(188)]]),
      /permission denied/,
    );
    console.log(
      "OK: impressão380 recupera códigos21/26/12/32 vinculados ao pedido autorizado, sem custos, sem catálogo global, sem outra loja/carteira; anonimato/inatividade/lote inválido recusados.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
