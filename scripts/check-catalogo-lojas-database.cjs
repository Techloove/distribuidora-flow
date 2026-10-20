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

    await d.exec(`alter table centros add column logo_url text;
      alter table parametros add primary key(chave),add column descricao text,add column updated_at timestamptz default now();
      insert into parametros(chave,valor) values('desconto_maximo','15'),('margem_minima','0');`);
    await d.exec(fs.readFileSync(path.join(root, "db/fase243_parametros_por_loja.sql"), "utf8"));

    await d.exec(`alter table centros add column ativo boolean default true;
      alter table produtos add column preco_venda numeric default 100,add column peso_kg numeric default 1;
      create table tabelas_preco(id uuid primary key,nome text,ativo bool,vigencia_inicio date,vigencia_fim date,cliente_id uuid,uf text,prioridade int);
      create table tabela_preco_itens(id uuid primary key,tabela_id uuid,produto_id uuid,preco numeric,desconto_maximo numeric);
      alter table papeis add column pode_alterar_preco bool default false;update papeis set pode_alterar_preco=true where codigo='admin';`);
    await fn("fase20_promocao_vigencia.sql", "preco_produto_info");
    await fn("fase48_papel_preco.sql", "pode_alterar_preco");
    await fn("fase229_lead_rota_agenda_integrada.sql", "lead_criar_pedido");
    await fn("fase48_papel_preco.sql", "trg_item_preco_permitido");
    await d.exec(`create trigger trg_pedido_itens_preco_permitido before insert or update of preco_unitario on pedido_itens for each row execute function trg_item_preco_permitido();
      grant select on pedidos,pedido_itens,produtos to authenticated;`);
    const migracao244 = fs.readFileSync(
      path.join(root, "db/fase244_catalogo_precos_lojas.sql"),
      "utf8",
    );
    const oid = (
      await d.query(
        "select oid,proacl::text from pg_proc where oid='validar_pedido(uuid)'::regprocedure",
      )
    ).rows;
    await d.exec(migracao244);
    assert.deepEqual(
      (
        await d.query(
          "select oid,proacl::text from pg_proc where oid='validar_pedido(uuid)'::regprocedure",
        )
      ).rows,
      oid,
    );
    await d.exec(`select set_config('test.actor','${id(3)}',false);
      select salvar_produto_loja_244('${id(10)}','${id(80)}',true,25,3);
      select salvar_produto_loja_244('${id(11)}','${id(80)}',true,40,null);
      insert into pedidos(id,cliente_id,centro_id,forma_pagamento_id,representante_id,status,total_itens,total_liquido)
      values('${id(900)}','${id(40)}','${id(10)}','${id(70)}','${id(20)}','rascunho',100,100),('${id(901)}','${id(40)}','${id(11)}','${id(70)}','${id(20)}','rascunho',100,100);
      insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual) values('${id(900)}','${id(80)}',1,25,4);`);
    const price = async (n) =>
      (await d.query("select * from preco_item_pedido_244($1,$2)", [id(n), id(80)])).rows[0];
    assert.equal((await price(900)).preco, "25.0000");
    assert.equal((await price(901)).preco, "40.0000");
    assert(
      (await d.query(`select validar_pedido('${id(900)}') r`)).rows[0].r.some((x) =>
        x.mensagem.includes("Desconto de produto"),
      ),
    );
    assert(
      !(await d.query(`select validar_pedido('${id(901)}') r`)).rows[0].r.some((x) =>
        x.mensagem.includes("Desconto de produto"),
      ),
    );
    assert(
      (
        await d.query(
          "select pg_get_functiondef('public.lead_criar_pedido(uuid,text,uuid,uuid)'::regprocedure) d",
        )
      ).rows[0].d.includes("preco_item_pedido_244"),
    );
    // Referência global e estoque não mudam ao configurar a loja.
    assert.equal(
      (await d.query("select preco_venda,estoque_atual from produtos")).rows[0].preco_venda,
      "100",
    );
    assert.equal(
      (await d.query("select estoque_atual from produtos")).rows[0].estoque_atual,
      "1000",
    );
    // Representante sem autorização de preço recebe o preço da sua loja no INSERT.
    await d.exec(
      `select set_config('test.actor','${id(1)}',false);insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario) values('${id(910)}','${id(900)}','${id(80)}',1,999);`,
    );
    assert.equal(
      (await d.query(`select preco_unitario n from pedido_itens where id='${id(910)}'`)).rows[0].n,
      "25.0000",
    );
    await assert.rejects(
      d.exec(`update pedido_itens set preco_unitario=99 where id='${id(910)}'`),
      /permite alterar/,
    );
    await assert.rejects(price(901), /acesso/);
    await assert.rejects(
      d.query("select salvar_produto_loja_244($1,$2,true,1,null)", [id(10), id(80)]),
      /permissão/,
    );
    await d.exec(`set role authenticated;`);
    assert.equal(
      (await d.query(`select count(*)::int n from loja_produtos where centro_id='${id(11)}'`))
        .rows[0].n,
      0,
    );
    await assert.rejects(d.exec(`update loja_produtos set preco_venda=1`), /permission denied/);
    await d.exec(
      `reset role;select set_config('test.actor','${id(3)}',false);select salvar_produto_loja_244('${id(10)}','${id(80)}',false,25,3);`,
    );
    await assert.rejects(
      d.exec(
        `insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario) values('${id(900)}','${id(80)}',1,25)`,
      ),
      /indisponível/,
    );
    await assert.rejects(
      d.exec(`update pedidos set status='aprovado' where id='${id(900)}'`),
      /indisponível/,
    );
    await assert.rejects(price(900), /indisponível/);
    assert.equal(
      (await d.query("select count(*)::int n from listar_catalogo_loja_244($1)", [id(10)])).rows[0]
        .n,
      0,
    );
    assert.equal(
      (
        await d.query("select count(*)::int n from listar_catalogo_loja_244($1,$2,false)", [
          id(10),
          "Produto",
        ])
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await d.query("select count(*)::int n from listar_catalogo_loja_244($1)", [id(11)])).rows[0]
        .n,
      1,
    );
    // Atualização de quantidade conserva preço com quatro casas e histórico da linha.
    await d.exec(
      `select salvar_produto_loja_244('${id(10)}','${id(80)}',true,25.1234,3);select set_config('test.actor','${id(1)}',false);`,
    );
    const itemNovo = (
      await d.query("select * from adicionar_item_pedido($1,$2,1,25.1234,0)", [id(900), id(80)])
    ).rows[0];
    await d.query("select atualizar_item_pedido($1,2,25.1234,0)", [itemNovo.id]);
    assert.equal(
      (await d.query("select preco_unitario n from pedido_itens where id=$1", [itemNovo.id]))
        .rows[0].n,
      "25.1234",
    );
    await d.exec(
      `select set_config('test.actor','${id(3)}',false);select salvar_produto_loja_244('${id(10)}','${id(80)}',false,25,3);`,
    );
    // Promoções vigentes são preservadas enquanto permanecem compartilhadas.
    await d.exec(
      `insert into tabelas_preco values('${id(920)}','Campanha',true,current_date-1,null,null,null,1);insert into tabela_preco_itens values('${id(921)}','${id(920)}','${id(80)}',30,0);`,
    );
    assert.equal((await price(901)).preco, "30");
    assert.equal((await price(901)).preco_normal, "40.0000");
    for (const n of [-1, "NaN", "Infinity", 1.00001])
      await assert.rejects(
        d.query("select salvar_produto_loja_244($1,$2,true,$3,null)", [id(11), id(80), n]),
      );
    await assert.rejects(
      d.query("select salvar_produto_loja_244($1,$2,true,10,101)", [id(11), id(80)]),
    );
    await d.exec(`select set_config('test.actor','',false);`);
    await d.exec(migracao244);
    assert.equal(
      (
        await d.query(
          `select preco_venda,disponivel from loja_produtos where centro_id='${id(10)}'`,
        )
      ).rows[0].disponivel,
      false,
    );
    await d.exec(
      `insert into produtos(id,codigo,descricao,preco_venda) values('${id(81)}','0002','Produto novo',12);insert into centros(id,nome) values('${id(12)}','Nova');`,
    );
    assert.equal(
      (await d.query(`select count(*)::int n from loja_produtos where produto_id='${id(81)}'`))
        .rows[0].n,
      3,
    );
    assert.equal(
      (
        await d.query(
          `select preco_venda from loja_produtos where centro_id='${id(12)}' and produto_id='${id(81)}'`,
        )
      ).rows[0].preco_venda,
      "12.0000",
    );
    console.log(
      "Lojas244 OK: catálogo e preços independentes, teto por produto, validador201 real, trava48 real, estoque preservado, RLS/carteira, promoções, novas lojas/produtos e reexecução.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
