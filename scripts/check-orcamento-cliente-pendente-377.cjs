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

    await d.exec(`reset role;create table pessoas(id uuid primary key,credito_pendente boolean not null default true);
      alter table clientes add column pessoa_id uuid;
      insert into pessoas values('${id(90)}',true);update clientes set pessoa_id='${id(90)}',rota_id=null,status='bloqueado',limite_credito=0 where id='${id(40)}';`);
    await d.exec(fs.readFileSync("db/fase334_pedido_cliente_cadastro_pendente.sql", "utf8"));
    await d.exec(
      "create trigger credito_cliente before insert or update on pedidos for each row execute function exigir_credito_liberado_284()",
    );
    await fn("fase336_cadastro_representante_sem_rota.sql", "exigir_rota_aprovacao_336");
    await d.exec(
      "create trigger rota_cliente before insert or update on pedidos for each row execute function exigir_rota_aprovacao_336()",
    );
    await fn("fase302_comissoes_aprovadas_data_retomada.sql", "status_comissao_valido_302");
    const s302 = fs.readFileSync("db/fase302_comissoes_aprovadas_data_retomada.sql", "utf8");
    const a302 = s302.indexOf("do $$declare d text;begin");
    await d.exec(s302.slice(a302, s302.indexOf("end $$;", a302) + 7));
    const novo = (cliente = id(40), rota = null, loja = id(10)) =>
      q("select * from criar_orcamento_236($1,$2,$3,$4,current_date+30)", [
        cliente,
        loja,
        rota,
        id(70),
      ]);
    await actor(1);
    await assert.rejects(() => novo(), /Rota de entrega obrigatoria/);
    await d.exec("reset role");
    const migration = fs.readFileSync("db/fase377_orcamento_cliente_pendente.sql", "utf8");
    await d.exec(migration);
    await d.exec(migration);
    await actor(1);
    const p = (await novo())[0];
    assert.equal(p.tipo_documento, "orcamento");
    assert.equal(p.rota_id, null);
    await q("select adicionar_item_pedido($1,$2,10,10,0)", [p.id, id(80)]);
    const aceito = (await q("select * from decidir_orcamento_236($1,'aceitar',null)", [p.id]))[0];
    assert.equal(aceito.status, "aguardando_aprovacao");
    assert.equal(aceito.tipo_documento, "pedido");
    assert.equal(aceito.aprovacao_automatica_em, null);
    assert.equal(
      (await q("select * from decidir_orcamento_236($1,'aceitar',null)", [p.id]))[0].status,
      "aguardando_aprovacao",
    );
    for (const table of ["estoque_reservas", "contas_receber", "comissoes"])
      assert.equal(
        Number((await q(`select count(*) n from ${table} where pedido_id=$1`, [p.id]))[0].n),
        0,
        table + " sem efeitos antes da aprovação",
      );
    assert.equal(
      Number(
        (await q("select count(*) n from estoque_movimentos where documento_id=$1", [p.id]))[0].n,
      ),
      0,
    );
    await actor(2);
    await assert.rejects(() => novo(), /carteira/);
    await assert.rejects(
      () => q("select decidir_orcamento_236($1,'aceitar',null)", [p.id]),
      /sem acesso/,
    );
    await actor(1);
    await assert.rejects(() => novo(id(40), null, id(11)), /Centro|centro/);
    await actor(3);
    await assert.rejects(
      () => q("select avancar_pedido($1,'aprovado')", [p.id]),
      /aprovação de cadastro/,
    );
    await assert.rejects(() => q("select confirmar_pedido($1)", [p.id]), /aprovação de cadastro/);
    await d.exec(
      `reset role;update pessoas set credito_pendente=false where id='${id(90)}';update clientes set status='ativo',limite_credito=10000,rota_id='${id(30)}' where id='${id(40)}';`,
    );
    await actor(1);
    await assert.rejects(() => novo(), /Rota de entrega obrigatoria/);
    const regular = (await novo(id(40), id(30)))[0];
    await q("select adicionar_item_pedido($1,$2,10,10,0)", [regular.id, id(80)]);
    assert.equal(
      (await q("select * from decidir_orcamento_236($1,'aceitar',null)", [regular.id]))[0].status,
      "aprovado",
      "cliente regular conserva aprovação automática vigente",
    );
    await actor(3);
    await assert.rejects(() => q("select avancar_pedido($1,'aprovado')", [p.id]), /rota ativa/);
    await d.exec(`reset role;update pedidos set rota_id='${id(30)}' where id='${p.id}'`);
    await actor(3);
    await q("select avancar_pedido($1,'aprovado')", [p.id]);
    await actor(1);
    await assert.rejects(
      () =>
        q("select criar_orcamento_base_240($1,$2,null,$3,current_date,null,null,null)", [
          id(40),
          id(10),
          id(70),
        ]),
      /permission denied/,
    );
    console.log(
      "OK: falha reproduzida; orçamento sem rota para cliente pendente; aceite aguardando aprovação sem estoque/parcelas/comissão; crédito e rota bloqueiam confirmação; carteira/loja e base privada preservadas; cliente liberado mantém fluxo regular; idempotência.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery || "");
  process.exit(1);
});
