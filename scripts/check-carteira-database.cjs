const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async () => {
 const db = new PGlite();
 await db.exec(`create role authenticated; create role anon; create role service_role;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table user_roles(user_id uuid,role text);
 create function has_role(u uuid,r text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_roles where user_id=u and role=r)$$;
 create function usuario_ativo() returns boolean language sql as $$select auth.uid() is not null$$;
 create table representantes(id uuid primary key,profile_id uuid);
 create function meu_representante_id() returns uuid language sql security definer set search_path=public as $$select id from representantes where profile_id=auth.uid() limit 1$$;
 create table clientes(id uuid primary key,representante_id uuid,nome text);
 create table pessoas(id uuid primary key,representante_id uuid);
 create table pedidos(id uuid primary key,cliente_id uuid,representante_id uuid,onda_id uuid);
 create table cargas(id uuid primary key); create table carga_pedidos(id uuid primary key,carga_id uuid,pedido_id uuid);
 create table ondas_separacao(id uuid primary key); create table sicredi_cnab_arquivos(id uuid primary key,conteudo text); create table auditoria(id uuid primary key);
 create table pedido_itens(id uuid primary key,pedido_id uuid);
 create table contas_receber(id uuid primary key,cliente_id uuid,pedido_id uuid);
 create table boletos(id uuid primary key,cliente_id uuid,pedido_id uuid,conta_receber_id uuid);
 create table devolucoes(id uuid primary key,cliente_id uuid,pedido_id uuid);
 create table devolucao_itens(id uuid primary key,devolucao_id uuid);
 create table creditos_clientes(id uuid primary key,cliente_id uuid);
 create table sicredi_boleto_alteracoes(id uuid primary key,boleto_id uuid);
 create table tabelas_preco(id uuid primary key,cliente_id uuid);
 create table tabela_preco_itens(id uuid primary key,tabela_id uuid);
 create view vw_clientes_inativos as select c.id cliente_id,c.representante_id,c.nome,count(p.id) pedidos from clientes c left join pedidos p on p.cliente_id=c.id group by c.id;
 create function carteira_teste_rpc(_pedido_id uuid) returns pedidos language plpgsql security definer set search_path=public as $$declare p pedidos; begin select * into p from pedidos where id=_pedido_id; return p; end$$;
 grant execute on function carteira_teste_rpc(uuid) to authenticated;
 create function cliente_por_documento(text) returns setof clientes language sql security definer set search_path=public as $$select * from clientes where nome=$1$$;
 grant usage on schema public,auth to authenticated;
 grant select,insert,update,delete on all tables in schema public to authenticated;
 grant select on vw_clientes_inativos to authenticated;`);
 for(const name of ['representantes','clientes','pessoas','pedidos','pedido_itens','contas_receber','boletos','devolucoes','devolucao_itens','creditos_clientes','sicredi_boleto_alteracoes','tabelas_preco','tabela_preco_itens','cargas','carga_pedidos','ondas_separacao','sicredi_cnab_arquivos','auditoria']) {
  await db.exec(`alter table ${name} enable row level security; create policy leitura_ampla on ${name} for all to authenticated using(true) with check(true);`);
 }
 for(let i=1;i<=2;i++) {
  await db.exec(`insert into representantes values('${uuid(i+10)}','${uuid(i)}'); insert into user_roles values('${uuid(i)}','representante');
  insert into clientes values('${uuid(i+20)}','${uuid(i+10)}','Cliente ${i}'); insert into pessoas values('${uuid(i+20)}','${uuid(i+10)}');
  insert into pedidos values('${uuid(i+30)}','${uuid(i+20)}','${uuid(i+10)}',null); insert into pedido_itens values('${uuid(i+40)}','${uuid(i+30)}');
  insert into contas_receber values('${uuid(i+50)}','${uuid(i+20)}',null); insert into boletos values('${uuid(i+60)}','${uuid(i+20)}',null,'${uuid(i+50)}');
  insert into devolucoes values('${uuid(i+70)}','${uuid(i+20)}',null); insert into devolucao_itens values('${uuid(i+80)}','${uuid(i+70)}');
  insert into creditos_clientes values('${uuid(i+90)}','${uuid(i+20)}'); insert into sicredi_boleto_alteracoes values('${uuid(i+100)}','${uuid(i+60)}');
  insert into tabelas_preco values('${uuid(i+110)}','${uuid(i+20)}'); insert into tabela_preco_itens values('${uuid(i+120)}','${uuid(i+110)}');`);
 }
 await db.exec(`insert into clientes values('${uuid(23)}',null,'Sem carteira'); insert into user_roles values('${uuid(3)}','representante'),('${uuid(4)}','admin'),('${uuid(1)}','gestor'),('${uuid(4)}','representante');
 insert into tabelas_preco values('${uuid(113)}',null); insert into tabela_preco_itens values('${uuid(123)}','${uuid(113)}');`);
 await db.exec(`insert into cargas values('${uuid(300)}'),('${uuid(301)}'); insert into carga_pedidos values('${uuid(310)}','${uuid(300)}','${uuid(31)}'),('${uuid(311)}','${uuid(301)}','${uuid(31)}'),('${uuid(312)}','${uuid(301)}','${uuid(32)}'); insert into sicredi_cnab_arquivos values('${uuid(320)}','Dados de todas as carteiras'); insert into auditoria values('${uuid(330)}');`);
 // Corpos reais do ERP: valida também a injeção no CRUD com argumentos opcionais.
 const crud = fs.readFileSync(path.resolve(__dirname,'../db/fase81_hardening_crud_pedidos.sql'),'utf8');
 for(const name of ['criar_pedido_rascunho','atualizar_pedido_comercial','atualizar_item_pedido','remover_item_pedido']) {
  const start = crud.indexOf('create or replace function public.'+name+'(');
  await db.exec(crud.slice(start,crud.indexOf('$$;',start)+3));
 }
 const migration = fs.readFileSync(path.resolve(__dirname,'../db/fase206_carteira_representante.sql'),'utf8');
 await db.exec(migration); await db.exec(migration);
 async function login(n) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uuid(n)}',false); set role authenticated;`); }
 async function count(t) { return Number((await db.query(`select count(*) n from ${t}`)).rows[0].n); }
 const scoped = ['representantes','clientes','pessoas','pedidos','pedido_itens','contas_receber','boletos','devolucoes','devolucao_itens','creditos_clientes','sicredi_boleto_alteracoes','vw_clientes_inativos'];
 for(let user=1;user<=2;user++) {
  await login(user);
  for(const t of scoped) assert.equal(await count(t),1,`${t}, representante ${user}`);
  assert.equal((await db.query('select cliente_id from vw_clientes_inativos')).rows[0].cliente_id,uuid(user+20));
  assert.equal(await count('cargas'),user===1?1:0); assert.equal(await count('sicredi_cnab_arquivos'),0); assert.equal(await count('auditoria'),0);
  assert.equal(await count('tabelas_preco'),2); assert.equal(await count('tabela_preco_itens'),2);
  assert.equal(await count(`cliente_por_documento('Cliente ${user===1?2:1}')`),0);
  assert.equal((await db.query(`select (carteira_teste_rpc('${uuid(user+30)}')).id id`)).rows[0].id,uuid(user+30));
  await assert.rejects(db.query(`select carteira_teste_rpc('${uuid((user===1?2:1)+30)}')`),/fora da sua carteira/);
  await assert.rejects(db.query(`select criar_pedido_rascunho('${uuid(user===1?22:21)}',null,null,null)`),/fora da sua carteira/);
  await assert.rejects(db.query(`select atualizar_pedido_comercial('${uuid(user===1?32:31)}',null)`),/fora da sua carteira/);
  await assert.rejects(db.query(`select remover_item_pedido('${uuid(user===1?42:41)}')`),/fora da sua carteira/);
  await assert.rejects(db.exec(`insert into clientes values('${uuid(200+user)}','${uuid(user===1?12:11)}','Invasão')`),/row-level security/);
  assert.equal((await db.query(`update clientes set nome='Invadido' where id='${uuid(user===1?22:21)}' returning id`)).rows.length,0);
 }
 await login(3);
 for(const t of scoped) assert.equal(await count(t),0,`sem vínculo: ${t}`);
 await login(4);
 assert.equal(await count('clientes'),3); assert.equal(await count('boletos'),2); assert.equal(await count('cargas'),2); assert.equal(await count('sicredi_cnab_arquivos'),1);
 assert.equal((await db.query(`select (carteira_teste_rpc('${uuid(32)}')).id id`)).rows[0].id,uuid(32));
 await db.close();
 console.log('Carteira/RLS OK: dois representantes isolados, gestor+representante restrito, sem vínculo vazio, admin amplo, RPC/view/boletos/detalhes e reaplicação.');
})().catch(e=>{console.error(e);process.exit(1)});
