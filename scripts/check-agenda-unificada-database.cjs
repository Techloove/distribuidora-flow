const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(
      `create role anon;create role authenticated;create schema auth;
 create type app_role as enum('admin','gestor','representante','financeiro','comercial');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,nome text,ativo boolean default true,representante_id uuid);
 create table user_roles(user_id uuid,role app_role);
 create table papeis(codigo text primary key);
 create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);
 create table role_menus(role app_role,path text,primary key(role,path));
 create table role_permissoes(role text,permissao text,primary key(role,permissao));
 create table centros(id uuid primary key,nome text);
 create table representantes(id uuid primary key,nome text);
 create table rotas(id uuid primary key,nome text);
 create table clientes(id uuid primary key,codigo text,razao_social text,representante_id uuid,centro_id uuid,rota_id uuid,cidade text,uf text,telefone text,status text default 'ativo');
 create table pedidos(id uuid default gen_random_uuid(),cliente_id uuid,centro_id uuid,status text,data_pedido date,total_liquido numeric);
 create table contas_receber(id uuid primary key default gen_random_uuid(),cliente_id uuid,centro_id uuid,documento text,parcela int,vencimento date,status text,valor numeric,valor_pago numeric default 0,juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0);
 create table acompanhamentos(id uuid primary key default gen_random_uuid(),cliente_id uuid references clientes(id),centro_id uuid,tipo text,responsavel uuid default auth.uid(),responsavel_nome text,status text default 'aberto',proxima_acao date,promessa_data date,promessa_valor numeric,resultado text,observacao text,created_at timestamptz default now(),concluido_em timestamptz);
 create unique index cobranca_unica on acompanhamentos(cliente_id) where tipo='cobranca' and status='aberto';
 alter table acompanhamentos enable row level security;
 revoke all on acompanhamentos from public,anon,authenticated;grant select on acompanhamentos to authenticated;
 alter table contas_receber enable row level security;grant select on contas_receber to authenticated;
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create function has_role(uuid,text) returns boolean language sql stable security definer set search_path=public as $$select exists(select1 from user_roles where user_id=$1 and role::text=$2)$$;
 create function usuario_ativo() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select ativo from profiles where id=auth.uid()),false)$$;
 create function can_manage(uuid) returns boolean language sql stable security definer set search_path=public as $$select has_role($1,'admin') or has_role($1,'gestor')$$;
 create function can_finance(uuid) returns boolean language sql stable security definer set search_path=public as $$select can_manage($1) or has_role($1,'financeiro')$$;
 create function meu_representante_id() returns uuid language sql stable security definer set search_path=public as $$select representante_id from profiles where id=auth.uid()$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable security definer set search_path=public as $$select usuario_ativo() and ($1='${id(10)}'::uuid or has_role(auth.uid(),'admin'))$$;
 create function vencimento_util(date) returns date language sql stable as $$select $1$$;
 grant usage on schema public,auth to authenticated;
 insert into papeis values('admin'),('gestor'),('representante'),('financeiro'),('comercial');
 insert into profiles(id,nome,representante_id) values('${id(1)}','Rep A','${id(20)}'),('${id(2)}','Rep B','${id(21)}'),('${id(3)}','Master',null),('${id(4)}','Financeiro',null),('${id(5)}','Sem vínculo',null);
 insert into user_roles values('${id(1)}','representante'),('${id(2)}','representante'),('${id(3)}','admin'),('${id(4)}','financeiro'),('${id(5)}','representante');
 insert into role_menus values('representante','/agenda-comercial'),('financeiro','/cobranca'),('comercial','/clientes-inativos');
 insert into permissoes values('comercial_acompanhar','Comercial','Agenda',103,'/agenda-comercial'),('cobranca_acompanhar','Cobrança','Financeiro',104,'/cobranca');
 insert into role_permissoes values('representante','comercial_acompanhar'),('financeiro','cobranca_acompanhar');
 insert into centros values('${id(10)}','Loja A'),('${id(11)}','Loja B');
 insert into representantes values('${id(20)}','Rep A'),('${id(21)}','Rep B');
 insert into rotas values('${id(30)}','Rota A'),('${id(31)}','Rota B');
 insert into clientes(id,codigo,razao_social,representante_id,centro_id,rota_id,cidade) values
 ('${id(40)}','C001','Cliente A','${id(20)}','${id(10)}','${id(30)}','Cidade A'),
 ('${id(41)}','C002','Cliente B','${id(21)}','${id(10)}','${id(31)}','Cidade B'),
 ('${id(42)}','C003','Outra loja','${id(20)}','${id(11)}','${id(30)}','Cidade C');
 insert into pedidos(cliente_id,centro_id,status,data_pedido,total_liquido) values('${id(40)}','${id(10)}','confirmado',current_date-90,100),('${id(41)}','${id(10)}','confirmado',current_date-10,200);
 insert into contas_receber(cliente_id,centro_id,documento,parcela,vencimento,status,valor,juros,multa,acrescimo,desconto,valor_pago) values
 ('${id(40)}','${id(10)}','PED1',1,current_date-5,'parcial',100,5,2,3,1,10),
 ('${id(41)}','${id(10)}','PED2',1,current_date+5,'aberto',500,0,0,0,0,0),
 ('${id(40)}','${id(11)}','PED3',1,current_date-5,'aberto',800,0,0,0,0,0);
 `.replaceAll("select1", "select 1"),
    );
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    await fn("fase206_carteira_representante.sql", "escopo_representante");
    await fn("fase206_carteira_representante.sql", "cliente_na_minha_carteira");
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    const sql = fs.readFileSync(
      path.join(root, "db/fase228_agenda_comercial_unificada.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };
    const lista = async (aba = "comercial", rep = null, centro = null, pagina = 0) =>
      (
        await q("select agenda_clientes_228($1,$2,$3,null,'',60,$4) r", [aba, centro, rep, pagina])
      )[0].r;
    const registrar = async (cliente = id(40), tipo = "cobranca") =>
      (
        await q(
          "select registrar_acompanhamento($1,$2,$3,current_date,'Contato','Observação',null,null) id",
          [cliente, id(10), tipo],
        )
      )[0].id;
    await actor(1);
    assert.equal((await lista()).count, 1);
    assert.equal((await lista("reativacao")).count, 1);
    assert.equal((await lista("cobranca")).resumo.aberto, 99); //100+5+2+3-1-10
    assert.equal((await lista("cobranca")).resumo.vencido, 99);
    const options = (await q("select agenda_filtros_228() r"))[0].r;
    assert.deepEqual(
      options.representantes.map((r) => r.id),
      [id(20)],
    );
    assert.deepEqual(options.cidades, ["Cidade A"]);
    await assert.rejects(lista("cobranca", id(21)), /fora da sua carteira/);
    await assert.rejects(lista("comercial", null, id(11)), /Centro sem acesso/);
    await assert.rejects(q("select agenda_titulos_228($1)", [id(41)]), /sem acesso/);
    assert.equal((await q("select agenda_titulos_228($1) r", [id(40)]))[0].r.rows[0].saldo, 99);
    assert.equal((await q("select count(*) n from contas_receber"))[0].n, 0); //RLS financeira segue fechada.
    assert.equal((await q("select can_finance(auth.uid()) v"))[0].v, false);
    const acao = await registrar();
    await assert.rejects(registrar(), /já tem cobrança aberta/);
    await assert.rejects(registrar(id(41)), /fora da sua carteira/);
    await assert.rejects(q("update acompanhamentos set resultado='Forjado'"), /permission denied/);
    await actor(2);
    assert.equal((await lista("cobranca")).resumo.aberto, 500);
    assert.equal((await q("select count(*) n from acompanhamentos"))[0].n, 0);
    await assert.rejects(
      q("select concluir_acompanhamento($1)", [acao]),
      /sem acesso|outro responsável/,
    );
    // Papel gestor combinado não amplia a carteira; administrador é a exceção explícita.
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','gestor')`);
    await actor(1);
    assert.equal((await lista()).count, 1);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','admin')`);
    await actor(1);
    assert.equal((await lista()).count, 3);
    await d.exec("reset role");
    await d.exec(`delete from user_roles where user_id='${id(1)}' and role in ('admin','gestor')`);
    await actor(3);
    assert.equal((await lista()).count, 3);
    assert.equal((await lista("cobranca", id(21))).resumo.aberto, 500);
    assert.equal((await lista("cobranca", id(20), id(11))).resumo.aberto, 800);
    assert.equal((await q("select count(*) n from acompanhamentos"))[0].n, 1);
    // Transferir a carteira revoga imediatamente leitura e mutações do representante anterior.
    await d.exec("reset role");
    await d.exec(`update clientes set representante_id='${id(21)}' where id='${id(40)}'`);
    await actor(1);
    assert.equal((await lista()).count, 0);
    assert.equal((await q("select count(*) n from acompanhamentos"))[0].n, 0);
    await assert.rejects(
      q("select concluir_acompanhamento($1)", [acao]),
      /sem acesso|outro responsável/,
    );
    await actor(5);
    assert.equal((await lista()).count, 0);
    assert.deepEqual((await q("select agenda_filtros_228() r"))[0].r.representantes, []);
    // Remover ação e reaplicar não restaura os grants padrão.
    await d.exec("reset role");
    await d.exec(
      "delete from role_permissoes where role='representante' and permissao='cobranca_acompanhar'",
    );
    await d.exec(sql);
    await actor(2);
    await assert.rejects(lista("cobranca"), /não liberada/);
    await assert.rejects(registrar(id(41)), /não liberada/);
    await actor(3);
    await q("select concluir_acompanhamento($1)", [acao]);
    await q("select concluir_acompanhamento($1)", [acao]);
    await d.exec("reset role");
    assert.equal(
      Number((await q("select count(*) n from auditoria where acao='concluir'"))[0].n),
      1,
    );
    await actor(3);
    await q(
      "select admin_salvar_acesso('financeiro',array['/cobranca','/clientes-inativos'],array['cobranca_acompanhar'])",
    );
    await d.exec("reset role");
    assert.deepEqual(
      (await q("select path from role_menus where role='financeiro'")).map((r) => r.path),
      ["/agenda-comercial"],
    );
    await actor(4);
    assert.equal((await lista("cobranca")).count, 2);
    await assert.rejects(lista("comercial"), /não liberada/);
    await d.exec("reset role;set role anon");
    await assert.rejects(q("select agenda_clientes_228('cobranca')"), /permission denied/);
    await d.exec("reset role");
    // Totais são do conjunto filtrado, e não apenas dos primeiros50 clientes.
    await d.exec(
      `insert into clientes(id,codigo,razao_social,representante_id,centro_id,cidade) select gen_random_uuid(),'X'||n,'Cliente extra'||n,'${id(20)}','${id(10)}','Cidade A' from generate_series(1,55)n;`,
    );
    await actor(1);
    const first = await lista(),
      next = await lista("comercial", null, null, 1);
    assert.equal(first.count, 55);
    assert.equal(first.rows.length, 50);
    assert.equal(next.rows.length, 5);
    await d.exec("reset role");
    await d.exec("delete from role_menus where role='representante' and path='/agenda-comercial'");
    await d.exec(sql);
    await actor(1);
    await assert.rejects(lista(), /não liberada/);
    await d.exec("reset role");
    await d.exec("insert into role_menus values('representante','/agenda-comercial')");
    await d.exec(`update profiles set ativo=false where id='${id(1)}'`);
    await actor(1);
    await assert.rejects(lista(), /não liberada/);
    assert.equal((await q("select count(*) n from acompanhamentos"))[0].n, 0);
    console.log(
      "OK agenda228: carteiras A/B, master, perfis combinados, sem vínculo, centros, encargos, promessa, conclusão, RLS, revogações, troca de carteira, paginação e reaplicação.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
