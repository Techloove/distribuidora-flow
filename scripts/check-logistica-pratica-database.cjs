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
    await fn("fase86_integridade_cancelamento_logistica.sql", "validar_expedicao_pedido");
    await d.exec(
      `grant select on expedicoes to authenticated;create trigger trg_validar_expedicao_pedido before insert or update on expedicoes for each row execute function validar_expedicao_pedido();`,
    );
    const unificadas = process.argv.includes("--unificadas");
    let sql234;
    if (unificadas) {
      await d.exec(`
        alter table expedicoes add column transportadora_id uuid,add column placa text,add column volumes numeric default 1,add column peso_kg numeric default 0,add column romaneio text,add column observacoes text;
        grant select on expedicoes to authenticated;
        create table transportadoras(id uuid,razao_social text);
        alter table rotas add column ativo boolean default true;
        alter table entrega_registros add column arquivo_path text;
        alter table pedido_itens add column preco_unitario numeric default 10;
        create schema storage;create table storage.objects(bucket_id text,name text);
        alter table devolucoes add column pedido_id uuid,add column cliente_id uuid,add column centro_id uuid,add column motivo text,add column created_by uuid;
        alter table devolucoes alter column id set default gen_random_uuid(),alter column status set default 'rascunho';
        create table devolucao_itens(devolucao_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,condicao text);
        insert into permissoes values('entrega_parcial_operar','Entrega parcial','Entregas',123,'/expedicao');
        insert into role_permissoes values('expedicao','entrega_parcial_operar');
      `);
      await fn("fase87_expedicao_escrita_controlada.sql", "atualizar_dados_expedicao");
      await fn("fase214_entregas_parciais.sql", "registrar_parcial_214");
      await d.exec(
        "grant execute on function registrar_entrega(uuid,text,text,text,text),registrar_parcial_214(uuid,jsonb,text,text,text,uuid),atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text) to authenticated",
      );
      sql234 = fs.readFileSync(path.join(root, "db/fase234_entregas_unificadas.sql"), "utf8");
      await d.exec(sql234);
      await d.exec(sql234);
    }
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
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
    const state = async (n) =>
      (await q("select status from pedidos where id=$1", [id(n)]))[0].status;
    const enviar = (ids) => q("select enviar_pedidos_separacao_233($1)", [ids.map(id)]);
    const concluir = (n, flag = true) =>
      q("select concluir_separacao_pratica_233($1,$2)", [id(n), flag]);
    const incluir = (c, ids) => q("select incluir_pedidos_carga_233($1,$2)", [c, ids.map(id)]);
    const criar = async () =>
      (
        await q("select * from criar_carga($1,current_date,$2,null,$3,$4)", [
          id(30),
          id(10),
          "Motorista teste",
          "ABC1D23",
        ])
      )[0];
    const hoje = (await q("select (now() at time zone 'America/Sao_Paulo')::date::text dia"))[0]
      .dia;
    const lista = async () =>
      (await q("select entregas_listar_232(null,'em_rota',null,'',0) data"))[0].data;
    if (unificadas) {
      await actor(6);
      await q("select registrar_entrega($1,'ocorrencia',null,null,'Cliente avisado da entrega')", [
        id(200),
      ]);
      await denied(
        () => q("select registrar_entrega($1,'entrega','Nome','Canhoto',null)", [id(200)]),
        /Formalize/,
      );
      await q("select atualizar_dados_expedicao($1,null,'Motorista atualizado')", [id(200)]);
      assert.equal(
        (await q("select motorista from expedicoes where id=$1", [id(200)]))[0].motorista,
        "Motorista atualizado",
      );
      await actor(1);
      await denied(
        () => q("select registrar_entrega($1,'ocorrencia',null,null,'Outra carteira')", [id(203)]),
        /sem acesso/,
      );
      await denied(() => q("select atualizar_dados_expedicao($1)", [id(205)]), /sem acesso/);
      await denied(
        () =>
          q("select registrar_parcial_214($1,'[]','Nome','Motivo','arquivo',$2)", [
            id(203),
            id(999),
          ]),
        /sem acesso/,
      );
      await d.exec("reset role");
      assert.equal((await q("select count(*) n from role_menus where path='/expedicao'"))[0].n, 0);
      assert.equal(
        (await q("select modulo from permissoes where codigo='entrega_registrar'"))[0].modulo,
        "/entregas",
      );
      // Revocation remains effective after reapplication and blocks every moved write RPC.
      await d.exec("delete from role_menus where role='expedicao' and path='/entregas'");
      await d.exec(sql234);
      await actor(6);
      await denied(
        () => q("select registrar_entrega($1,'ocorrencia',null,null,'Sem menu')", [id(200)]),
        /sem acesso/,
      );
      await denied(() => q("select atualizar_dados_expedicao($1)", [id(200)]), /sem acesso/);
      await denied(
        () =>
          q("select registrar_parcial_214($1,'[]','Nome','Motivo','arquivo',$2)", [
            id(200),
            id(999),
          ]),
        /sem acesso/,
      );
      await d.exec("reset role;insert into role_menus values('expedicao','/entregas')");
      // Actual partial motor: register a visit, then deliver the outstanding quantity.
      await d.exec(
        `insert into storage.objects values('entrega-comprovantes','${id(100)}/visita.pdf');`,
      );
      await actor(6);
      const item = (await q("select id from pedido_itens where pedido_id=$1", [id(100)]))[0].id;
      await q("select registrar_parcial_214($1,$2,'Recebedor','Primeira visita',$3,$4)", [
        id(100),
        JSON.stringify([{ item_id: item, entregue: 4, recusado: 0 }]),
        id(100) + "/visita.pdf",
        id(2000),
      ]);
      assert.equal(await state(100), "parcial");
      await q("select registrar_parcial_214($1,$2,'Recebedor','Saldo entregue',$3,$4)", [
        id(100),
        JSON.stringify([{ item_id: item, entregue: 6, recusado: 0 }]),
        id(100) + "/visita.pdf",
        id(2001),
      ]);
      assert.equal(await state(100), "entregue");
      await d.exec("reset role");
      await d.exec(
        `insert into storage.objects values('${"entrega-comprovantes"}','${id(104)}/recusa.pdf');`,
      );
      await actor(6);
      const recusado = (await q("select id from pedido_itens where pedido_id=$1", [id(104)]))[0].id;
      await q(
        "select registrar_parcial_214($1,$2,'Recebedor','Recusa de parte da mercadoria',$3,$4)",
        [
          id(104),
          JSON.stringify([{ item_id: recusado, entregue: 7, recusado: 3 }]),
          id(104) + "/recusa.pdf",
          id(2002),
        ],
      );
      assert.equal(await state(104), "parcial");
      await d.exec("reset role");
      assert.equal(
        (await q("select status from devolucoes where pedido_id=$1", [id(104)]))[0].status,
        "rascunho",
      );
      assert.equal(Number((await q("select quantidade from devolucao_itens"))[0].quantidade), 3);

      await d.exec("reset role");
      console.log(
        "OK unificação234: menus/catálogo, migração repetível, ocorrências/transporte, bloqueio do atalho antigo, centros/carteira, revogação e entrega parcial real214 com saldo concluído.",
      );
    }
    const stockAntes = (await q("select count(*) n from estoque_movimentos"))[0].n,
      titulosAntes = (await q("select count(*) n from contas_receber"))[0].n;
    await actor(6);
    await denied(() => enviar([200, 204]), /confirmação/);
    assert.equal(await state(200), "confirmado");
    assert.equal((await q("select count(*) n from pedido_separacoes"))[0].n, 0);
    await denied(() => enviar([200, 200]), /distintos/);
    await denied(() => enviar([205]), /sem acesso/);
    await enviar([200, 201]);
    assert.equal(await state(200), "separacao");
    await enviar([200, 201]);
    assert.equal((await q("select count(*) n from pedido_separacoes"))[0].n, 2);
    await denied(() => concluir(200, false), /explicitamente/);
    // Guarda real da fase86 reproduz o bloqueio observado na produção.
    await denied(() => concluir(200), /Transicao de expedicao invalida: separacao -> separado/);
    assert.equal(await state(200), "separacao");
    assert.equal(
      (await q("select status from expedicoes where pedido_id=$1", [id(200)]))[0].status,
      "separacao",
    );
    assert.equal(
      (await q("select quantidade_separada from pedido_itens where pedido_id=$1", [id(200)]))[0]
        .quantidade_separada,
      null,
    );
    await d.exec("reset role");
    const sql254 = fs.readFileSync(
      path.join(root, "db/fase254_transicoes_expedicao_separacao.sql"),
      "utf8",
    );
    await d.exec(sql254);
    await d.exec(sql254);
    await actor(6);
    await concluir(200);
    await concluir(200);
    assert.equal(
      (await q("select status from expedicoes where pedido_id=$1", [id(200)]))[0].status,
      "separado",
    );
    await d.exec("reset role");
    await denied(
      () => q("update expedicoes set status='separacao' where pedido_id=$1", [id(200)]),
      /Transicao/,
    );
    await denied(
      () => q("update expedicoes set centro_id=$1 where pedido_id=$2", [id(11), id(200)]),
      /Centro/,
    );
    await actor(6);
    assert.equal(await state(200), "conferido");
    assert.equal(
      (await q("select status from pedido_separacoes where pedido_id=$1", [id(200)]))[0].status,
      "conferida",
    );
    await q(
      "select registrar_separacao_item(id,9,null,null) from pedido_itens where pedido_id=$1",
      [id(201)],
    );
    await denied(() => concluir(201), /divergentes/);
    assert.equal(await state(201), "separacao");
    await q(
      "select registrar_separacao_item(id,10,null,null) from pedido_itens where pedido_id=$1",
      [id(201)],
    );
    await concluir(201);
    assert.equal(await state(201), "conferido");
    const c = await criar(),
      c2 = await criar();
    assert.equal(
      (
        await q("select count(*) n from vw_pedidos_para_carga where pedido_id=any($1)", [
          [id(200), id(201)],
        ])
      )[0].n,
      2,
    );
    await d.exec("reset role");
    await d.exec("update parametros set valor='true' where chave='exigir_nf_carga'");
    await actor(6);
    await denied(() => incluir(c.id, [200]), /nota fiscal/);
    assert.equal(await state(200), "conferido");
    await d.exec("reset role");
    await d.exec("update parametros set valor='false' where chave='exigir_nf_carga'");
    await actor(6);
    await incluir(c.id, [200, 201]);
    await incluir(c.id, [200, 201]);
    assert.equal(
      (await q("select status from expedicoes where pedido_id=$1", [id(200)]))[0].status,
      "aguardando_entrega",
    );
    assert.equal(await state(200), "em_carga");
    assert.equal(
      (await q("select count(*) n from carga_pedidos where carga_id=$1", [c.id]))[0].n,
      2,
    );
    await denied(() => incluir(c2.id, [200]), /outra carga/);
    let listaEntrega = await lista();
    assert.equal(listaEntrega.rows.find((r) => r.pedido_id === id(200)).status, "aguardando_saida");
    assert.equal(listaEntrega.rows.find((r) => r.pedido_id === id(200)).carga_numero, c.numero);
    await denied(
      () =>
        q("select confirmar_entrega_232($1,$2,$3,$4,null,$5)", [
          id(200),
          hoje,
          "Recebedor",
          "Canhoto",
          id(1000),
        ]),
      /em rota/,
    );
    await d.exec("reset role");
    await d.exec(`update cargas set capacidade_kg=10 where id='${c.id}'`);
    await actor(6);
    await denied(() => q("select despachar_carga_233($1,$2)", [c.id, hoje]), /capacidade/);
    assert.equal((await q("select status from cargas where id=$1", [c.id]))[0].status, "aberta");
    assert.equal(await state(200), "em_carga");
    await d.exec("reset role");
    await d.exec(`update cargas set capacidade_kg=30 where id='${c.id}'`);
    await actor(6);
    await q("select despachar_carga_233($1,$2)", [c.id, hoje]);
    await q("select despachar_carga_233($1,$2)", [c.id, hoje]);
    assert.equal(await state(200), "em_rota");
    assert.equal((await lista()).rows.find((r) => r.pedido_id === id(200)).status, "em_rota");
    await denied(() => q("select avancar_carga($1,'concluida')", [c.id]), /Confirme as entregas/);
    await q("select confirmar_entrega_232($1,$2,$3,$4,null,$5)", [
      id(200),
      hoje,
      "Recebedor A",
      "Canhoto 20",
      id(1000),
    ]);
    assert.equal((await q("select status from cargas where id=$1", [c.id]))[0].status, "em_rota");
    await q("select confirmar_entrega_232($1,$2,$3,$4,null,$5)", [
      id(201),
      hoje,
      "Recebedor B",
      "Canhoto 21",
      id(1001),
    ]);
    assert.equal((await q("select status from cargas where id=$1", [c.id]))[0].status, "concluida");
    assert.equal(await state(201), "entregue");
    await d.exec("reset role");
    await denied(
      () => q("update expedicoes set status='separacao' where pedido_id=$1", [id(201)]),
      /Transicao/,
    );
    await denied(
      () => q("update expedicoes set pedido_id=$1 where pedido_id=$2", [id(202), id(201)]),
      /nao pode ser alterado/,
    );
    await denied(
      () =>
        q("insert into expedicoes(id,pedido_id,centro_id,status) values($1,$2,$3,'separacao')", [
          id(900),
          id(202),
          id(10),
        ]),
      /iniciar em pendente/,
    );
    await actor(6);

    await d.exec("reset role");
    assert.equal((await q("select count(*) n from estoque_movimentos"))[0].n, stockAntes);
    assert.equal((await q("select count(*) n from contas_receber"))[0].n, titulosAntes);
    assert.equal((await q("select count(*) n from notas_saida"))[0].n, 0);
    assert((await q("select faturado_em from pedidos where id=$1", [id(200)]))[0].faturado_em);
    await actor(1);
    await denied(() => enviar([203]), /sem acesso/);
    await denied(() => enviar([205]), /sem acesso/);
    await actor(6);
    await enviar([202]);
    await concluir(202);
    await denied(() => incluir(c2.id, [202]), /outra rota/);
    const c3 = (await q("select * from criar_carga($1,current_date,$2)", [id(31), id(10)]))[0];
    await incluir(c3.id, [202]);
    await q("select avancar_carga($1,'cancelada')", [c3.id]);
    assert.equal(await state(202), "faturado");
    const c4 = (await q("select * from criar_carga($1,current_date,$2)", [id(31), id(10)]))[0];
    await incluir(c4.id, [202]);
    await denied(
      () => q("select remover_pedido_carga($1,$2)", [c3.id, id(202)]),
      /acesso|cancelada|estado/i,
    );
    assert.equal(await state(202), "em_carga");
    await q("select remover_pedido_carga($1,$2)", [c4.id, id(202)]);
    assert.equal(await state(202), "faturado");
    await denied(() => q("select despachar_carga_233($1,$2)", [c4.id, hoje]), /Inclua pedidos/);
    await d.exec("reset role");
    await d.exec(
      "delete from role_permissoes where role='expedicao' and permissao='cargas_operar'",
    );
    await d.exec(sql);
    await actor(6);
    await denied(criar, /não liberada/);
    await denied(() => incluir(c2.id, [202]), /Sem acesso/);
    await d.exec("reset role;set role anon");
    await denied(() => enviar([200]), /permission denied/);
    console.log(
      "OK logística233: lote atômico/idempotente, confirmação prévia obrigatória, separação+conferência reais42, divergências, montagem em lote/rota/carteira/centro, sem NF/novo estoque/títulos, capacidade/rollback, despacho integrado, pendências pré-saída, confirmação232 e conclusão automática por última entrega, revogação/reaplicação/anon.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
