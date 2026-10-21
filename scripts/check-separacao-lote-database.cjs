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
    const anterior = fs.readFileSync(path.join(root, "db/fase232_rotina_entregas.sql"), "utf8");
    await d.exec(anterior);
    await d.exec(`
      alter table pedidos add column faturado_em timestamptz;
      alter table produtos add column peso_kg numeric default 1;
      alter table pedido_itens add column quantidade_separada numeric,add column divergencia_acao text,add column divergencia_obs text,add column conferido boolean default false;
      alter table expedicoes add column carga_id uuid,add column rota_id uuid;
      create table pedido_separacoes(pedido_id uuid primary key,status text,separador_id uuid,conferente_id uuid,separada_em timestamptz,conferida_em timestamptz,observacoes text);
      create table estoque_movimentos(produto_id uuid,documento_id uuid,origem text,tipo text,quantidade numeric,centro_id uuid);
      create table parametros(chave text primary key,valor text);
      insert into parametros values('exigir_nf_carga','false');
      create table notas_saida(id uuid default gen_random_uuid(),pedido_id uuid,nf_numero text,status text,created_at timestamptz default now());
      create table cargas(id uuid primary key default gen_random_uuid(),numero int generated always as identity,rota_id uuid,data date,centro_id uuid,responsavel text,motorista text,placa text,transportadora_id uuid,observacoes text,created_by uuid,status text default 'aberta',valor_total numeric default 0,peso_kg numeric default 0,capacidade_kg numeric);
      create table carga_pedidos(carga_id uuid references cargas(id),pedido_id uuid references pedidos(id),created_by uuid,primary key(carga_id,pedido_id));
      -- Existing confirmation/financial motors are deliberately not rerun by the logistics flow.
      create function recalcular_pedido(uuid) returns void language sql as $$select null::void$$;
      create function notificar(text,text,text,text) returns void language sql as $$select null::void$$;
      create function peso_pedido(uuid) returns numeric language sql security definer set search_path=public as $$select coalesce(sum(i.quantidade*p.peso_kg),0) from pedido_itens i join produtos p on p.id=i.produto_id where i.pedido_id=$1$$;
      insert into role_menus values('expedicao','/pedidos'),('expedicao','/separacao'),('expedicao','/cargas'),('representante','/pedidos');
      grant select on pedidos,pedido_itens,clientes,rotas,notas_saida,carga_pedidos,cargas,pedido_separacoes to authenticated;
      insert into pedidos(id,numero,cliente_id,representante_id,centro_id,rota_id,status,data_pedido,total_liquido) values
       ('${id(200)}',20,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','confirmado',current_date-2,100),
       ('${id(201)}',21,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','confirmado',current_date-2,100),
       ('${id(202)}',22,'${id(40)}','${id(20)}','${id(10)}','${id(31)}','confirmado',current_date-2,100),
       ('${id(203)}',23,'${id(41)}','${id(21)}','${id(10)}','${id(30)}','confirmado',current_date-2,100),
       ('${id(204)}',24,'${id(40)}','${id(20)}','${id(10)}','${id(30)}','confirmado',current_date-2,100),
       ('${id(205)}',25,'${id(40)}','${id(20)}','${id(11)}','${id(30)}','confirmado',current_date-2,100);
      insert into pedido_itens(pedido_id,produto_id,quantidade) select id,'${id(70)}',10 from pedidos where numero>=20;
      insert into estoque_movimentos select '${id(70)}',id,'pedido','saida',10,centro_id from pedidos where numero between 20 and 25 and numero<>24;
      insert into expedicoes(id,pedido_id,numero,centro_id,status) select id,id,numero,centro_id,'pendente' from pedidos where numero>=20;
    `);
    await fn("fase99_usuario_ativo_execucao_rpc.sql", "can_stock");
    await fn("fase99_usuario_ativo_execucao_rpc.sql", "can_operate");
    for (const nome of [
      "avancar_pedido",
      "iniciar_separacao",
      "registrar_separacao_item",
      "concluir_separacao",
      "conferir_separacao",
      "bloqueio_faturamento",
      "criar_carga",
      "recalcular_carga",
      "remover_pedido_carga",
    ])
      await fn("fase42_fluxo_operacional.sql", nome);
    await fn("fase209_rotinas_distribuidora.sql", "validar_capacidade_carga_209");
    await fn("fase215_comissoes_e_rentabilidade.sql", "marcar_faturamento_215");
    await d.exec(
      `create trigger capacidade_carga_209 before insert or update on cargas for each row execute function validar_capacidade_carga_209();create trigger faturamento_comercial_215 before update of status on pedidos for each row execute function marcar_faturamento_215();`,
    );
    await d.exec(
      "grant execute on function criar_carga(uuid,date,uuid,text,text,text,uuid,text),remover_pedido_carga(uuid,uuid),iniciar_separacao(uuid),concluir_separacao(uuid),conferir_separacao(uuid,text) to authenticated",
    );
    const sql = fs.readFileSync(path.join(root, "db/fase233_fluxo_logistico_pratico.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);

    await d.exec(`alter table pedidos add column if not exists previsao_entrega date;alter table produtos add column unidade text default 'KG';
      create view vw_separacao with(security_invoker=true) as select p.id pedido_id,i.produto_id,i.id item_id,p.status from pedidos p join pedido_itens i on i.pedido_id=p.id;
      grant select on produtos,vw_separacao to authenticated;`);
    const fase248 = fs.readFileSync(
      path.join(root, "db/fase248_separacao_lote_relatorios.sql"),
      "utf8",
    );
    await d.exec(fase248);
    await d.exec(fase248);
    await fn("fase86_integridade_cancelamento_logistica.sql", "validar_expedicao_pedido");
    const fase254 = fs.readFileSync(
      path.join(root, "db/fase254_transicoes_expedicao_separacao.sql"),
      "utf8",
    );
    await d.exec(fase254);
    await d.exec(fase254);

    await d.exec(`select set_config('test.actor','${id(1)}',false);set role authenticated;`);
    const lote = (ids) => d.query("select concluir_separacao_lote_248($1,true) n", [ids.map(id)]);
    await d.query("select enviar_pedidos_separacao_233($1)", [[id(200), id(201), id(202)]]);
    assert.equal((await lote([200, 201])).rows[0].n, 2);
    assert.equal(
      (
        await d.query(
          `select count(*)::int n from pedidos where id in('${id(200)}','${id(201)}') and status='conferido'`,
        )
      ).rows[0].n,
      2,
    );
    assert.equal((await lote([200, 201])).rows[0].n, 2);
    await assert.rejects(lote([202, 203]), /acesso/);
    assert.equal(
      (await d.query("select status from pedidos where id=$1", [id(202)])).rows[0].status,
      "separacao",
    );
    assert.equal(
      (await d.query("select quantidade_separada from pedido_itens where pedido_id=$1", [id(202)]))
        .rows[0].quantidade_separada,
      null,
    );
    await d.exec(
      `reset role;update pedido_itens set quantidade_separada=1 where pedido_id='${id(202)}';set role authenticated;`,
    );
    await assert.rejects(lote([202]), /divergentes/);
    assert.equal(
      (await d.query("select quantidade_separada from pedido_itens where pedido_id=$1", [id(202)]))
        .rows[0].quantidade_separada,
      "1",
    );
    await assert.rejects(
      d.query("select concluir_separacao_lote_248($1,false)", [[id(202)]]),
      /Confirme/,
    );
    await assert.rejects(lote([]), /Selecione/);
    const meta = (await d.query("select * from vw_separacao where pedido_id=$1", [id(200)]))
      .rows[0];
    assert.equal(meta.cliente_id, id(40));
    assert.equal(meta.unidade, "KG");
    assert(meta.data_pedido);
    await d.exec(`select set_config('test.actor','${id(2)}',false)`);
    await assert.rejects(lote([202]), /acesso/);
    console.log(
      "Separação248 OK: motores233/42 reais, conclusão múltipla e idempotente, rollback integral por carteira, divergências preservadas, confirmação obrigatória e metadados da view.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
