const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    const fixture = fs.readFileSync(
        path.join(__dirname, "check-agenda-unificada-database.cjs"),
        "utf8",
      ),
      a = fixture.indexOf("`create role anon"),
      b = fixture.indexOf("`.replaceAll", a);
    await d.exec(
      fixture
        .slice(a + 1, b)
        .replace(/\$\{id\((\d+)\)\}/g, (_, n) => id(Number(n)))
        .replaceAll("select1", "select 1")
        .replace("'financeiro','comercial'", "'financeiro','comercial','expedicao','estoque'"),
    );
    await d.exec("set timezone='America/Sao_Paulo'");
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert(a >= 0, name);
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    for (const nome of [
      "escopo_representante",
      "cliente_na_minha_carteira",
      "documento_na_minha_carteira",
    ])
      await fn("fase206_carteira_representante.sql", nome);
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await fn("fase4_logistica_relatorios.sql", "can_ship");
    await fn("fase19_sincronizacao_status.sql", "sync_status_ativo");
    await d.exec(`
 alter table pedidos add primary key(id);alter table pedidos add column numero int,add column representante_id uuid,add column rota_id uuid;
 create table produtos(id uuid primary key,codigo text,descricao text);
 create table pedido_itens(id uuid primary key default gen_random_uuid(),pedido_id uuid,produto_id uuid,quantidade numeric);
 create table expedicoes(id uuid primary key,pedido_id uuid,numero int,centro_id uuid,status text,data_saida date,data_entrega date,previsao_entrega date,motorista text);
 create table entrega_registros(id uuid primary key default gen_random_uuid(),expedicao_id uuid,pedido_id uuid,centro_id uuid,tipo text,recebedor text,comprovante text,observacao text,created_by uuid default auth.uid(),created_at timestamptz default now(),chave_operacao uuid unique);
 create unique index entrega_unica_209 on entrega_registros(expedicao_id) where tipo='entrega';
 create table entrega_itens(registro_id uuid,pedido_item_id uuid,entregue numeric,recusado numeric,devolucao_id uuid);
 create table devolucoes(id uuid,status text);
 insert into permissoes values('compras_planejar','Planejar','Compras',134,'/compras'),('entrega_registrar','Entrega','Expedição',105,'/expedicao');
 insert into papeis values('expedicao'),('estoque');insert into role_menus values('expedicao','/expedicao');insert into role_permissoes values('expedicao','entrega_registrar');
 insert into profiles(id,nome) values('${id(6)}','Entregador');insert into user_roles values('${id(6)}','expedicao'),('${id(1)}','expedicao');
 insert into produtos values('${id(70)}','0007','Produto teste');
 delete from pedidos;
 insert into pedidos(id,numero,cliente_id,representante_id,centro_id,rota_id,status,data_pedido,total_liquido) values
 ('${id(100)}',3,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','em_rota',current_date-5,100),
 ('${id(101)}',4,'${id(41)}','${id(21)}','${id(10)}','${id(31)}','em_rota',current_date-5,100),
 ('${id(102)}',5,'${id(40)}','${id(20)}','${id(11)}','${id(30)}','em_rota',current_date-5,100),
 ('${id(103)}',6,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','separacao',current_date-5,100),
 ('${id(104)}',7,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','em_rota',current_date-5,100),
 ('${id(105)}',8,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','entregue',current_date-5,100);
 insert into expedicoes(id,pedido_id,numero,centro_id,status,data_saida,previsao_entrega,data_entrega) select id,id,numero,centro_id,case when status='separacao' then 'separacao' else status end,current_date-2,current_date,case when status='entregue' then current_date-1 end from pedidos;
 insert into pedido_itens(pedido_id,produto_id,quantidade) select id,'${id(70)}',10 from pedidos;
 `);
    await fn("fase59_hardening_logistica.sql", "avancar_expedicao");
    for (const nome of ["sync_pedido_da_expedicao", "sync_expedicao_do_pedido"])
      await fn("fase42_fluxo_operacional.sql", nome);
    for (const nome of ["exigir_comprovante_entrega_209", "registrar_entrega"])
      await fn("fase209_rotinas_distribuidora.sql", nome);
    for (const nome of ["sincronizar_entrega_214", "proteger_saldo_entrega_214"])
      await fn("fase214_entregas_parciais.sql", nome);
    await d.exec(`
 create trigger comprovante_entrega_209 before update of status on expedicoes for each row execute function exigir_comprovante_entrega_209();
 create trigger saldo_entrega_214 before update of status on expedicoes for each row execute function proteger_saldo_entrega_214();
 create trigger sincronizar_entrega_214 after update of status on expedicoes for each row execute function sincronizar_entrega_214();
 create trigger trg_sync_pedido_da_expedicao after update on expedicoes for each row execute function sync_pedido_da_expedicao();
 create trigger trg_sync_expedicao_do_pedido after update on pedidos for each row execute function sync_expedicao_do_pedido();
 `);
    const sql = fs.readFileSync(path.join(root, "db/fase232_rotina_entregas.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
    const hoje = (await q("select (now() at time zone 'America/Sao_Paulo')::date::text dia"))[0]
      .dia;
    const dia = async (n) => (await q("select ($1::date+$2::int)::text dia", [hoje, n]))[0].dia;
    const ontem = await dia(-1),
      amanha = await dia(1),
      antigo = await dia(-10);
    const denied = async (f, re) => {
      let e;
      try {
        await f();
      } catch (err) {
        e = err;
      }
      assert(e, "Expected denial");
      if (re) assert.match(e.message, re);
    };
    const lista = async (o = {}) =>
      (
        await q("select entregas_listar_232($1,$2,$3,$4,$5) data", [
          o.centro ?? null,
          o.status ?? "em_rota",
          o.rota ?? null,
          o.busca ?? "",
          o.pagina ?? 0,
        ])
      )[0].data;
    const confirmar = async (e = 100, o = {}) =>
      (
        await q("select confirmar_entrega_232($1,$2,$3,$4,$5,$6) reg", [
          id(e),
          o.data ?? ontem,
          o.recebedor ?? "Recebedor",
          o.prova ?? "Canhoto assinado 003",
          o.obs ?? null,
          o.chave ?? id(900),
        ])
      )[0].reg;
    // The only legacy date source is preserved, without inventing the migration date.
    assert.equal(
      (await q("select data_entrega::text data from pedidos where id=$1", [id(105)]))[0].data,
      ontem,
    );
    await actor(6);
    let r = await lista();
    assert.equal(r.count, 3);
    assert.equal(r.pendentes, 3);
    assert.equal(r.entregues, 1);
    assert.equal((await lista({ busca: "Cliente B" })).count, 1);
    assert.equal((await lista({ rota: id(30) })).count, 2);
    await denied(() => lista({ centro: id(11) }), /Centro/);
    await denied(() => q("select entregas_itens_232($1)", [id(102)]), /sem acesso/);
    assert.equal(
      (await q("select entregas_itens_232($1) data", [id(100)]))[0].data.rows[0].codigo,
      "0007",
    );
    await denied(() => confirmar(100, { data: amanha }), /data válida/);
    await denied(() => confirmar(100, { data: antigo }), /anterior/);
    await denied(() => confirmar(100, { recebedor: "" }), /recebedor/);
    await denied(() => confirmar(100, { prova: "" }), /comprovante/);
    await denied(() => confirmar(103), /em rota/);
    // Only Entregas menu is enough; no need to expose full Expedição or financial screens.
    await actor(3);
    await q("select admin_salvar_acesso('expedicao',array['/entregas'],array['entregas_operar'])");
    await actor(6);
    const reg = await confirmar();
    assert.equal(await confirmar(), reg);
    await denied(() => confirmar(100, { recebedor: "Outro" }), /dados diferentes/);
    await denied(() => confirmar(100, { chave: id(901) }), /já formalizada/);
    await denied(() => confirmar(101, { chave: id(900) }), /dados diferentes/);
    await d.exec("reset role");
    let p = (
      await q("select status,data_entrega::text data from pedidos where id=$1", [id(100)])
    )[0];
    assert.equal(p.status, "entregue");
    assert.equal(p.data, ontem);
    assert.equal(
      (await q("select count(*) n from entrega_registros where expedicao_id=$1", [id(100)]))[0].n,
      1,
    );
    assert.equal(
      (await q("select count(*) n from auditoria where acao='formalizar_entrega_232'"))[0].n,
      1,
    );
    assert.equal(
      (
        await q("select created_by,data_entrega::text data from entrega_registros where id=$1", [
          reg,
        ])
      )[0].created_by,
      id(6),
    );
    // Partial delivery stays in its own workflow and cannot be silently completed here.
    await d.exec(
      `insert into entrega_registros(id,expedicao_id,pedido_id,centro_id,tipo,created_by) values('${id(500)}','${id(104)}','${id(104)}','${id(10)}','ocorrencia','${id(6)}');insert into entrega_itens select '${id(500)}',id,2,0,null from pedido_itens where pedido_id='${id(104)}'`,
    );
    await actor(6);
    await denied(() => confirmar(104, { chave: id(902) }), /parcial/);
    await actor(1);
    assert.equal(
      (await lista()).rows.every((r) => r.pedido_id !== id(101)),
      true,
    );
    await denied(() => confirmar(101, { chave: id(903) }), /sem acesso/);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(2)}','gestor')`);
    await actor(2);
    assert.equal((await lista()).count, 1);
    await actor(3);
    assert((await lista()).rows.some((r) => r.pedido_id === id(102)));
    await d.exec("reset role");
    await d.exec(`update clientes set representante_id='${id(21)}' where id='${id(40)}'`);
    await actor(1);
    assert.equal((await lista()).count, 0);
    await denied(() => q("select entregas_itens_232($1)", [id(100)]), /sem acesso/);
    await actor(4);
    await denied(() => lista(), /não liberada/);
    await d.exec("reset role");
    await d.exec(`update profiles set ativo=false where id='${id(6)}'`);
    await actor(6);
    await denied(() => confirmar(101), /sem acesso/);
    await d.exec("reset role");
    await d.exec(
      `update profiles set ativo=true where id='${id(6)}';delete from role_permissoes where role='expedicao' and permissao='entregas_operar'`,
    );
    await d.exec(sql);
    await actor(6);
    await denied(() => lista(), /não liberada/);
    await denied(() => q("select entrega_acessivel_232($1)", [id(100)]), /permission denied/);
    await d.exec("reset role");
    await d.exec(
      `insert into pedidos(id,numero,cliente_id,representante_id,centro_id,rota_id,status,data_pedido,total_liquido) select gen_random_uuid(),1000+g,'${id(41)}','${id(21)}','${id(10)}','${id(31)}','em_rota',current_date-5,1 from generate_series(1,55) g;insert into expedicoes(id,pedido_id,numero,centro_id,status,data_saida) select id,id,numero,centro_id,'em_rota',current_date-2 from pedidos where numero>=1000`,
    );
    await actor(3);
    r = await lista();
    assert.equal(r.count, 58);
    assert.equal(r.rows.length, 50);
    assert.equal((await lista({ pagina: 1 })).rows.length, 8);
    await d.exec("reset role;set role anon");
    await denied(() => lista(), /permission denied/);
    console.log(
      "OK entregas232: status/data em pedido e expedição pelos motores59/42/214, histórico/autor, backfill, prova/recebedor, idempotência, colisão, datas, parcial bloqueada, centros/carteiras/perfis mistos, menu dedicado, revogação/reaplicação/inatividade/anon e paginação.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
