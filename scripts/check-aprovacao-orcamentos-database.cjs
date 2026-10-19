const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    const source = fs.readFileSync(
        path.join(__dirname, "check-agenda-unificada-database.cjs"),
        "utf8",
      ),
      a = source.indexOf("`create role anon"),
      b = source.indexOf("`.replaceAll", a);
    await d.exec(
      source
        .slice(a + 1, b)
        .replace(/\$\{id\((\d+)\)\}/g, (_, n) => id(Number(n)))
        .replaceAll("select1", "select 1")
        .replace("'financeiro','comercial'", "'financeiro','comercial','estoque','expedicao'"),
    );
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      assert(a >= 0, name);
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    for (const n of [
      "escopo_representante",
      "cliente_na_minha_carteira",
      "documento_na_minha_carteira",
    ])
      await fn("fase206_carteira_representante.sql", n);
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    await fn("fase99_usuario_ativo_execucao_rpc.sql", "can_operate");
    await d.exec(`
 delete from pedidos;alter table pedidos add primary key(id);create sequence pedidos_numero_seq start 100;
 alter table pedidos add column numero bigint default nextval('pedidos_numero_seq'),add column representante_id uuid,add column rota_id uuid,add column forma_pagamento_id uuid,add column previsao_entrega date,add column observacoes text,add column parcelas int default 1,add column total_itens numeric default 0,add column comissao_valor numeric default 0,add column comissao_percentual numeric default 0,add column frete_valor numeric default 0,add column desconto_valor numeric default 0,add column data_entrega date;
 alter table pedidos alter column status set default 'rascunho',alter column total_liquido set default 0;
 alter table representantes add column ativo bool default true;alter table rotas add column ativo bool default true;
 create table formas_pagamento(id uuid primary key,nome text,tipo text,ativo bool,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int);
 insert into formas_pagamento values('${id(70)}','Boleto20/40','boleto',true,2,20,20);
 create table produtos(id uuid primary key,codigo text,descricao text);insert into produtos values('${id(80)}','0001','Produto teste');
 create table pedido_itens(id uuid primary key default gen_random_uuid(),pedido_id uuid references pedidos(id),produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric default 0,total numeric generated always as(quantidade*preco_unitario*(1-desconto_percentual/100)) stored);
 alter table contas_receber add column pedido_id uuid,add column data_emissao date;
 create table estoque_movimentos(pedido_id uuid,origem text,documento_id uuid,quantidade numeric);
 create table estoque_reservas(pedido_id uuid,produto_id uuid,centro_id uuid,quantidade numeric,primary key(pedido_id,produto_id));
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);insert into estoque_saldos values('${id(80)}','${id(10)}',1);
 create table comissoes(id uuid default gen_random_uuid(),pedido_id uuid,representante_id uuid,base_calculo numeric,percentual numeric,valor numeric,centro_id uuid,status text default 'prevista',base_original numeric,valor_original numeric);
 create table devolucoes(id uuid,pedido_id uuid,valor_total numeric,status text);
 create table parametros(chave text,valor text);insert into parametros values('comissao_fato_gerador','recebimento');
 create table creditos_clientes(id uuid,status text,cliente_id uuid,centro_id uuid,saldo numeric);
 create table creditos_clientes_aplicacoes(id uuid,pedido_id uuid,credito_id uuid,status text,valor numeric,aplicado_em timestamptz);
 create table expedicoes(id uuid,pedido_id uuid,centro_id uuid,status text,created_at timestamptz default now(),data_saida date,data_entrega date,previsao_entrega date);
 create table entrega_registros(id uuid,pedido_id uuid,expedicao_id uuid,centro_id uuid,tipo text,recebedor text,data_entrega date,created_at timestamptz);
 create table entrega_itens(registro_id uuid);create table cargas(id uuid,numero int,centro_id uuid,status text);create table carga_pedidos(carga_id uuid,pedido_id uuid);
 create function can_stock(uuid) returns bool language sql as $$select can_manage($1)$$;
 create function can_ship(uuid) returns bool language sql as $$select can_manage($1)$$;
 create function notificar(text,text,text,text) returns void language sql as $$select null::void$$;
 -- Recálculo comercial usa5% na fixture; o lançamento de comissão usa o apurador real209.
 create function recalcular_pedido(_pedido_id uuid) returns void language plpgsql as $$begin update pedidos set total_itens=(select coalesce(sum(total),0) from pedido_itens where pedido_id=_pedido_id),total_liquido=(select coalesce(sum(total),0) from pedido_itens where pedido_id=_pedido_id),comissao_percentual=5,comissao_valor=(select round(coalesce(sum(total),0)*0.05,2) from pedido_itens where pedido_id=_pedido_id) where id=_pedido_id;perform apurar_comissao_pedido(_pedido_id);end$$;
 create function validar_pedido(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language plpgsql as $$begin insert into estoque_movimentos(origem,documento_id,quantidade) values($6,$7,$4);end$$;
 create function despachar_carga_233(uuid,date) returns void language sql as $$select null::void$$;
 insert into permissoes values('entrega_registrar','Entrega','Entregas',105,'/entregas');
 insert into role_menus values('representante','/pedidos');
 grant select on pedidos,pedido_itens,estoque_reservas,comissoes,estoque_movimentos to authenticated;
 `);
    for (const name of [
      "criar_pedido_rascunho",
      "adicionar_item_pedido",
      "atualizar_item_pedido",
      "remover_item_pedido",
      "atualizar_pedido_comercial",
    ])
      await fn("fase81_hardening_crud_pedidos.sql", name);
    await fn("fase209_rotinas_distribuidora.sql", "apurar_comissao_pedido");
    await fn("fase12_custo_markup_parcelas.sql", "aplicar_parcelas_forma");
    await d.exec(
      "create trigger parcelas_forma before insert or update of forma_pagamento_id on pedidos for each row execute function aplicar_parcelas_forma()",
    );
    await fn("fase42_fluxo_operacional.sql", "avancar_pedido");
    await fn("fase80_credito_cliente_devolucao.sql", "confirmar_pedido");
    await fn("fase80_credito_cliente_devolucao.sql", "cancelar_pedido");
    const s209 = fs.readFileSync(path.join(root, "db/fase209_rotinas_distribuidora.sql"), "utf8"),
      start = s209.indexOf(
        "do $$",
        s209.indexOf("-- A confirmação conserva estoque/crédito/idempotência"),
      );
    await d.exec(s209.slice(start, s209.indexOf("end $$;", start) + 7));
    await d.exec(
      fs.readFileSync(path.join(root, "db/fase227_prazos_forma_pagamento_pedido.sql"), "utf8"),
    );
    await fn("fase212_reservas_estoque.sql", "reservar_pedido_212");
    await d.exec(
      "create trigger reserva_pedido_212 after update of status on pedidos for each row execute function reservar_pedido_212()",
    );
    await d.exec(fs.readFileSync(path.join(root, "db/fase235_acompanhamento_pedidos.sql"), "utf8"));
    const sql = fs.readFileSync(path.join(root, "db/fase236_orcamentos.sql"), "utf8");
    await d.exec(sql);
    await d.exec(sql);
    // O teste anterior não instalava o gatilho de INSERT real21. Sem ele, a
    // criação parecia funcionar, pois a comissão só era apurada ao editar itens.
    await fn("fase21_comissao_representante_logado.sql", "trg_apurar_comissao_pedido");
    await d.exec(
      `create trigger trg_comissao_pedido after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function trg_apurar_comissao_pedido();`,
    );
    await d.exec(
      fs.readFileSync(path.join(root, "db/fase240_orcamento_sem_comissao_na_criacao.sql"), "utf8"),
    );
    await d.exec(`create role service_role;delete from contas_receber;
     alter table clientes add column limite_credito numeric default 10000;
     alter table produtos add column estoque_atual numeric default 1000,add column custo_medio numeric default 5,add column margem_minima numeric default 0;
     insert into parametros values('aprovacao_limite_credito','true'),('aprovacao_titulos_vencidos','true');`);
    const val = fs.readFileSync(path.join(root, "db/fase201_regras_aprovacao_credito.sql"), "utf8");
    const pos = val.indexOf("create or replace function public.validar_pedido(");
    await d.exec(val.slice(pos, val.indexOf("end $function$;", pos) + "end $function$;".length));
    await fn("fase226_estoque_compartilhado.sql", "reservar_pedido_212");
    const apply = () =>
      d.exec(
        fs.readFileSync(path.join(root, "db/fase241_aprovacao_automatica_orcamentos.sql"), "utf8"),
      );
    const manualAntes = (
      await d.query("select pg_get_functiondef('public.avancar_pedido(uuid,text)'::regprocedure) s")
    ).rows[0].s;
    await apply();
    await apply();
    assert.equal(
      (
        await d.query(
          "select pg_get_functiondef('public.avancar_pedido(uuid,text)'::regprocedure) s",
        )
      ).rows[0].s,
      manualAntes,
    );
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) =>
      d.exec(`reset role;select set_config('test.actor','${id(n)}',false);set role authenticated;`);
    const admin = async (s) => {
      await d.exec("reset role");
      await d.exec(s);
      await actor(1);
    };
    const create = async () => {
      const p = (
        await q("select * from criar_orcamento_236($1,$2,$3,$4,current_date+30)", [
          id(40),
          id(10),
          id(30),
          id(70),
        ])
      )[0];
      await q("select adicionar_item_pedido($1,$2,10,10,0)", [p.id, id(80)]);
      return p;
    };
    const accept = async (p) =>
      (await q("select * from decidir_orcamento_236($1,'aceitar',null)", [p.id]))[0];
    await actor(1);
    const p = await create();
    const aprovado = await accept(p);
    assert.equal(aprovado.id, p.id);
    assert.equal(aprovado.numero, p.numero);
    assert.equal(aprovado.status, "aprovado");
    assert.ok(aprovado.aprovacao_automatica_em);
    assert.deepEqual(aprovado.aprovacao_automatica_motivos, []);
    assert.equal(
      Number(
        (await q("select quantidade from estoque_reservas where pedido_id=$1", [p.id]))[0]
          .quantidade,
      ),
      10,
    );
    assert.equal((await q("select count(*) n from contas_receber"))[0].n, 0);
    assert.equal((await q("select count(*) n from estoque_movimentos"))[0].n, 0);
    assert.equal(
      (await q("select status from comissoes where pedido_id=$1", [p.id]))[0].status,
      "prevista",
    );
    assert.equal((await accept(p)).status, "aprovado");
    assert.equal(
      (await q("select count(*) n from estoque_reservas where pedido_id=$1", [p.id]))[0].n,
      1,
    );
    await d.exec("reset role");
    assert.equal((await q("select count(*) n from orcamento_contexto_aprovacao_241"))[0].n, 0);
    await actor(1);
    await assert.rejects(
      q("insert into orcamento_contexto_aprovacao_241 values($1,$2,txid_current())", [p.id, id(1)]),
      /permission denied/,
    );
    await assert.rejects(
      q("select contexto_aprovacao_orcamento_241($1)", [p.id]),
      /permission denied/,
    );
    await assert.rejects(
      q("select decidir_orcamento_base_241($1,'aceitar',null)", [p.id]),
      /permission denied/,
    );
    await admin("update clientes set limite_credito=50");
    const limite = await create();
    const bloqueado = await accept(limite);
    assert.equal(bloqueado.status, "aguardando_aprovacao");
    assert.equal(bloqueado.aprovacao_automatica_em, null);
    assert.ok(
      bloqueado.aprovacao_automatica_motivos.some((v) =>
        /Limite de crédito excedido/.test(v.mensagem),
      ),
    );
    await assert.rejects(q("select avancar_pedido($1,'aprovado')", [limite.id]), /Somente admin/);
    // Uma variável de sessão escolhida pelo representante não cria prova privada.
    await q("select set_config('app.aprovacao_automatica','true',false)");
    await assert.rejects(q("select avancar_pedido($1,'aprovado')", [limite.id]), /Somente admin/);
    await admin("update clientes set limite_credito=10000");
    assert.equal(
      (await accept(limite)).status,
      "aguardando_aprovacao",
      "Aceite repetido não muda a decisão anterior",
    );
    await admin(
      `insert into contas_receber(cliente_id,centro_id,documento,parcela,vencimento,status,valor) values('${id(40)}','${id(10)}','ATRASADO',1,current_date-2,'aberto',10)`,
    );
    const atraso = await accept(await create());
    assert.equal(atraso.status, "aguardando_aprovacao");
    assert.ok(atraso.aprovacao_automatica_motivos.some((v) => /títulos vencidos/.test(v.mensagem)));
    await admin("delete from contas_receber;update clientes set limite_credito=100");
    const exato = await accept(await create());
    assert.equal(exato.status, "aprovado", "Valor exatamente no limite é permitido");
    await admin("update clientes set limite_credito=10000;update produtos set estoque_atual=0");
    const estoque = await accept(await create());
    assert.equal(estoque.status, "aguardando_aprovacao");
    assert.ok(
      estoque.aprovacao_automatica_motivos.some((v) =>
        /Estoque disponível insuficiente/.test(v.mensagem),
      ),
    );
    await d.exec("reset role");
    assert.equal(
      (await q("select count(*) n from estoque_reservas where pedido_id=$1", [estoque.id]))[0].n,
      0,
    );
    assert.equal((await q("select count(*) n from orcamento_contexto_aprovacao_241"))[0].n, 0);
    await actor(1);
    await admin("update produtos set estoque_atual=1000;update clientes set status='bloqueado'");
    const cadastro = await accept(await create());
    assert.equal(cadastro.status, "aguardando_aprovacao");
    assert.ok(
      cadastro.aprovacao_automatica_motivos.some((v) => /Cliente bloqueado/.test(v.mensagem)),
    );
    await admin("update clientes set status='ativo';update produtos set margem_minima=150");
    const margem = await accept(await create());
    assert.equal(margem.status, "aguardando_aprovacao");
    assert.ok(margem.aprovacao_automatica_motivos.some((v) => /Margem/.test(v.mensagem)));
    await admin("update produtos set margem_minima=0");
    await admin(
      `insert into produtos(id,codigo,descricao,estoque_atual) values('${id(81)}','0002','Produto indisponível',0)`,
    );
    const parcialReserva = await create();
    await q("select adicionar_item_pedido($1,$2,10,10,0)", [parcialReserva.id, id(81)]);
    assert.equal((await accept(parcialReserva)).status, "aguardando_aprovacao");
    await d.exec("reset role");
    assert.equal(
      (
        await q("select count(*) n from estoque_reservas where pedido_id=$1", [parcialReserva.id])
      )[0].n,
      0,
      "Estorno do primeiro item quando a segunda reserva falha",
    );
    await actor(1);
    const desconto = await create();
    const itemDesconto = (
      await q("select id from pedido_itens where pedido_id=$1", [desconto.id])
    )[0];
    await q("select atualizar_item_pedido($1,10,10,20)", [itemDesconto.id]);
    const descontoPendente = await accept(desconto);
    assert.equal(descontoPendente.status, "aguardando_aprovacao");
    assert.ok(
      descontoPendente.aprovacao_automatica_motivos.some((v) => /Desconto/.test(v.mensagem)),
    );
    await actor(2);
    await assert.rejects(accept(p), /sem acesso/);
    await actor(1);
    const vazio = (
      await q("select * from criar_orcamento_236($1,$2,$3,$4,current_date+30)", [
        id(40),
        id(10),
        id(30),
        id(70),
      ])
    )[0];
    await assert.rejects(accept(vazio), /Inclua os itens/);
    await actor(3);
    await q("select avancar_pedido($1,'aprovado')", [limite.id]);
    await d.exec("reset role");
    await apply();
    await actor(1);
    assert.equal((await accept(p)).status, "aprovado");
    await d.exec("reset role;set role anon");
    await assert.rejects(accept(p), /permission denied/);
    console.log(
      "Autoaprovação241 OK: representante aprova apenas no aceite validado; validar201 e reserva compartilhada226 reais; limite, atraso, cliente bloqueado, margem e estoque pendentes com motivos; mesmo documento, reserva sem baixa/títulos, comissão prevista, idempotência, contexto privado, aprovação manual restrita, carteira e reexecução.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
