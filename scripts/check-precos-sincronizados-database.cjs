const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')='true'$$;
 create function can_manage(uuid) returns boolean language sql as $$select $1 is not null and coalesce(current_setting('test.manage',true),'true')='true'$$;
 create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.routine',true),'true')='true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select coalesce(current_setting('test.denied_shop',true),'')<>$1::text$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table cad_categorias(id uuid primary key,nome_norm text);
 create table centros(id uuid primary key,nome text,ativo boolean default true,categoria_produtos_id uuid);
 create table produtos(id uuid primary key,codigo text,descricao text,categoria text,preco_venda numeric(14,4) not null default 0,custo_medio numeric default 0,estoque_atual numeric default 5,peso_kg numeric);
 create table loja_produtos(centro_id uuid,produto_id uuid,preco_venda numeric(14,4),disponivel boolean default true,desconto_maximo numeric,updated_at timestamptz default now(),updated_by uuid,primary key(centro_id,produto_id));
 create table auditoria(id uuid default gen_random_uuid(),tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create table pedido_itens(id uuid,preco_unitario numeric,quantidade numeric);
 insert into pedido_itens values('${id(90)}',7,2);
 create table tabela_preco_itens(id uuid,preco numeric);insert into tabela_preco_itens values('${id(91)}',9);
 insert into cad_categorias values('${id(1)}','ferragens'),('${id(2)}','cimento');
 insert into centros values('${id(10)}','Ferragens',true,'${id(1)}'),('${id(11)}','Cimento',true,'${id(2)}');
 insert into produtos(id,codigo,descricao,categoria,preco_venda,custo_medio) values('${id(20)}','F1','Prego','Ferragens',15,10),('${id(21)}','C1','Cimento','Cimento',20,10);
 insert into loja_produtos(centro_id,produto_id,preco_venda,desconto_maximo) select c.id,p.id,8,5 from centros c cross join produtos p;
 `);
    const extract = async (file, name) => {
      const sql = fs.readFileSync(path.join(root, "db", file), "utf8");
      const start = sql.indexOf(`create or replace function public.${name}(`);
      assert(start >= 0, name);
      await db.exec(sql.slice(start, sql.indexOf("$$;", start) + 3));
    };
    await extract("fase246_catalogo_categoria_loja.sql", "produto_categoria_loja_246");
    await extract("fase271_estoque_proprio_por_loja.sql", "loja_produto_estoque_271");
    await db.exec(fs.readFileSync(path.join(root, "db/fase23_markup_fixo.sql"), "utf8"));
    await extract("fase209_rotinas_distribuidora.sql", "auditar_campos_209");
    await db.exec(
      `create trigger auditar_campos_209 after update on produtos for each row execute function auditar_campos_209('preco_venda','markup_percentual');`,
    );
    await extract("fase244_catalogo_precos_lojas.sql", "listar_catalogo_loja_244");
    const sql = fs.readFileSync(
      path.join(root, "db/fase275_preco_produto_sincronizado.sql"),
      "utf8",
    );
    const history = await db.query("select * from pedido_itens");
    const promo = await db.query("select * from tabela_preco_itens");
    await db.exec(sql);
    assert.equal((await db.query("select count(*)::int n from preco_retrato_275")).rows[0].n, 4);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from loja_produtos l join produtos p on p.id=l.produto_id where l.preco_venda<>p.preco_venda",
        )
      ).rows[0].n,
      0,
    );
    await db.exec(`set test.actor='${id(99)}'`);
    // Edição na listagem/modal geral e cálculo automático por markup/custo.
    await db.query("update produtos set preco_venda=18 where id=$1", [id(20)]);
    assert.equal(
      (
        await db.query("select distinct preco_venda from loja_produtos where produto_id=$1", [
          id(20),
        ])
      ).rows[0].preco_venda,
      "18.0000",
    );
    await db.query("update produtos set markup_percentual=100 where id=$1", [id(20)]);
    assert.equal(
      (
        await db.query("select distinct preco_venda from loja_produtos where produto_id=$1", [
          id(20),
        ])
      ).rows[0].preco_venda,
      "20.0000",
    );
    await db.query("update produtos set custo_medio=12 where id=$1", [id(20)]);
    assert.equal(
      (
        await db.query("select distinct preco_venda from loja_produtos where produto_id=$1", [
          id(20),
        ])
      ).rows[0].preco_venda,
      "24.0000",
    );
    const save = (shop, price, discount = 3) =>
      db.query("select salvar_produto_loja_244($1,$2,true,$3,$4)", [shop, id(20), price, discount]);
    // Edição do catálogo altera também o cadastro; opções comerciais continuam por loja.
    await save(id(10), 30);
    assert.equal(
      (
        await db.query("select preco_venda from listar_catalogo_loja_244($1) where id=$2", [
          id(10),
          id(20),
        ])
      ).rows[0].preco_venda,
      "30.0000",
    );
    assert.equal(
      (await db.query("select preco_venda from produtos where id=$1", [id(20)])).rows[0]
        .preco_venda,
      "30.0000",
    );
    assert.equal(
      (
        await db.query(
          "select desconto_maximo from loja_produtos where centro_id=$1 and produto_id=$2",
          [id(11), id(20)],
        )
      ).rows[0].desconto_maximo,
      "5",
    );
    assert.equal(
      (await db.query("select preco_venda from produtos where id=$1", [id(21)])).rows[0]
        .preco_venda,
      "20.0000",
    );
    await assert.rejects(() => save(id(11), 31), /categoria/);
    for (const flag of ["active", "manage", "routine"]) {
      await db.exec(`set test.${flag}='false'`);
      await assert.rejects(() => save(id(10), 31), /permissão/);
      await db.exec(`set test.${flag}='true'`);
    }
    await db.exec(`set test.denied_shop='${id(10)}'`);
    await assert.rejects(() => save(id(10), 31), /permissão/);
    await assert.rejects(
      () => db.query("update produtos set preco_venda=31 where id=$1", [id(20)]),
      /Sem acesso/,
    );
    await db.exec("set test.denied_shop=''");
    for (const bad of [-1, "NaN", "Infinity", 30.12345])
      await assert.rejects(() => save(id(10), bad), /inválido/);
    // Falha de auditoria reverte toda a operação, inclusive o preço global e os espelhos.
    await db.exec(`create function falhar_auditoria() returns trigger language plpgsql as $$begin if new.acao='configurar_produto_loja_244' then raise exception 'Falha simulada';end if;return new;end$$;
 create trigger falhar_auditoria before insert on auditoria for each row execute function falhar_auditoria();`);
    await assert.rejects(() => save(id(10), 40), /Falha simulada/);
    assert.equal(
      (await db.query("select preco_venda from produtos where id=$1", [id(20)])).rows[0]
        .preco_venda,
      "30.0000",
    );
    await db.exec("drop trigger falhar_auditoria on auditoria");
    await db.exec(sql);
    assert.equal(
      (await db.query("select preco_loja_anterior from preco_retrato_275 limit 1")).rows[0]
        .preco_loja_anterior,
      "8.0000",
    );
    assert.deepEqual((await db.query("select * from pedido_itens")).rows, history.rows);
    assert.deepEqual((await db.query("select * from tabela_preco_itens")).rows, promo.rows);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from preco_retrato_275"), /permission denied/);
    await db.exec("reset role");
    console.log(
      "Preços275 OK: alinhamento, retrato privado, Produto↔Loja, markup/custo, permissões, rollback, idempotência e histórico/promoções preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
