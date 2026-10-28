-- Cadastro pelo representante, crédito administrativo e vendas da própria carteira.
begin;
alter table public.pessoas add column if not exists credito_pendente boolean not null default false;
create index if not exists pessoas_credito_pendente_284 on public.pessoas(created_at,id) where credito_pendente;

-- Concessão inicial apenas ao criar a ação: reaplicar não desfaz revogações.
do $$ declare novo text; begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('clientes_cadastrar','Cadastrar clientes com crédito pendente','Clientes',150,'/pessoas')
 on conflict(codigo) do nothing returning codigo into novo;
 if novo is not null then
  insert into public.role_permissoes(role,permissao) values('representante',novo) on conflict do nothing;
 end if;
end $$;

-- O novo painel deve ser uma página de entrada do representante. Concede uma
-- única vez nesta instalação; uma revogação posterior não é desfeita ao reaplicar.
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase284' and acao='instalada') then
  insert into public.role_menus(role,path) values('representante','/dashboard') on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase284','instalada','{"painel_representante":true,"credito_administrativo":true}');
 end if;
end $$;

create or replace function public.rota_cliente_representante_284(_rota uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.escopo_representante() and public.pode_rotina('clientes_cadastrar')
 and exists(select 1 from public.representantes where id=public.meu_representante_id() and ativo)
 and exists(select 1 from public.rotas r where r.id=_rota and r.ativo and (
  exists(select 1 from public.representante_rotas rr where rr.representante_id=public.meu_representante_id() and rr.rota_id=r.id) or
  exists(select 1 from public.clientes c where c.rota_id=r.id and c.representante_id=public.meu_representante_id() and public.agenda_cliente_acessivel_228(c.id))
 ));
$$;
revoke all on function public.rota_cliente_representante_284(uuid) from public,anon,service_role;
grant execute on function public.rota_cliente_representante_284(uuid) to authenticated;

create or replace function public.rotas_cadastro_representante_284() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.usuario_ativo() or not public.escopo_representante() or not public.pode_rotina('clientes_cadastrar') then raise exception 'Cadastro de clientes não liberado';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'nome',r.nome) order by r.nome,r.id) from public.rotas r where public.rota_cliente_representante_284(r.id)),'[]'::jsonb);
end $$;
revoke all on function public.rotas_cadastro_representante_284() from public,anon,service_role;
grant execute on function public.rotas_cadastro_representante_284() to authenticated;

create or replace function public.proteger_credito_cliente_284() returns trigger
language plpgsql security definer set search_path=public as $$
declare admin boolean:=public.has_role(auth.uid(),'admin'); rep boolean:=public.escopo_representante(); pendente boolean;
begin
 if tg_op='DELETE' then
  if rep then raise exception 'Representante não pode excluir clientes';end if;
  return old;
 end if;
 if new.limite_credito<0 or new.limite_credito::text='NaN' then raise exception 'Limite de crédito inválido';end if;
 if auth.uid() is not null and not admin then
  if (tg_op='INSERT' and new.limite_credito<>0) or
   (tg_op='UPDATE' and new.limite_credito is distinct from old.limite_credito) then
   raise exception 'Somente administrador pode definir o limite de crédito' using errcode='42501';
  end if;
 end if;
 if tg_table_name='pessoas' then
  if rep and tg_op='INSERT' then
   if not public.usuario_ativo() or not public.pode_rotina('clientes_cadastrar') or not exists(select 1 from public.representantes where id=public.meu_representante_id() and ativo) then raise exception 'Cadastro de clientes não liberado';end if;
   if not new.is_cliente or new.is_fornecedor or new.is_representante or new.is_usuario or new.is_transportadora or new.profile_id is not null then raise exception 'Representante cadastra somente clientes';end if;
   if new.representante_id is not null and new.representante_id<>public.meu_representante_id() then raise exception 'Cliente fora da sua carteira';end if;
   if new.centro_id is null or not public.usuario_pode_acessar_centro(new.centro_id) or not exists(select 1 from public.centros where id=new.centro_id and ativo) then raise exception 'Selecione uma loja permitida e ativa';end if;
   if not public.rota_cliente_representante_284(new.rota_id) then raise exception 'Selecione uma rota vinculada ao representante ou já atendida pela sua carteira';end if;
   new.representante_id:=public.meu_representante_id();new.credito_pendente:=true;new.status:='bloqueado';
  end if;
  if tg_op='UPDATE' and auth.uid() is not null and not admin then
   if new.credito_pendente is distinct from old.credito_pendente then raise exception 'Somente administrador pode liberar o crédito';end if;
   if rep and (new.representante_id is distinct from old.representante_id or
    new.is_cliente is distinct from old.is_cliente or new.is_fornecedor is distinct from old.is_fornecedor or
    new.is_representante is distinct from old.is_representante or new.is_usuario is distinct from old.is_usuario or
    new.is_transportadora is distinct from old.is_transportadora or new.profile_id is distinct from old.profile_id) then raise exception 'Não é permitido alterar a carteira ou as funções do cadastro';end if;
   if old.status='bloqueado' and new.status<>'bloqueado' then raise exception 'Somente administrador pode desbloquear o cliente';end if;
   if rep and new.rota_id is distinct from old.rota_id and not public.rota_cliente_representante_284(new.rota_id) then raise exception 'Rota fora da sua carteira';end if;
  end if;
  if new.credito_pendente and (new.status<>'bloqueado' or new.limite_credito<>0) then raise exception 'Cliente com crédito pendente deve permanecer bloqueado e com limite zero';end if;
 else
  if rep and tg_op='UPDATE' and (new.pessoa_id is distinct from old.pessoa_id or new.representante_id is distinct from old.representante_id) then raise exception 'Não é permitido alterar o vínculo do cliente';end if;
  if tg_op='UPDATE' and auth.uid() is not null and not admin and new.pessoa_id is distinct from old.pessoa_id and exists(select 1 from public.pessoas where id=old.pessoa_id and credito_pendente) then raise exception 'Não é permitido remover o vínculo de um cliente com crédito pendente';end if;
  if rep and (new.representante_id is distinct from public.meu_representante_id() or (tg_op='UPDATE' and new.rota_id is distinct from old.rota_id and not public.rota_cliente_representante_284(new.rota_id))) then raise exception 'Cliente ou rota fora da sua carteira';end if;
  select p.credito_pendente into pendente from public.pessoas p where p.id=new.pessoa_id and (not rep or p.representante_id=public.meu_representante_id());
  if rep and tg_op='INSERT' and not coalesce(pendente,false) then raise exception 'Use o cadastro unificado de clientes';end if;
  if coalesce(pendente,false) and (new.status not in ('bloqueado','inativo') or new.limite_credito<>0) then raise exception 'Aguarde a liberação do limite pelo administrador';end if;
  if tg_op='UPDATE' and auth.uid() is not null and not admin and old.status='bloqueado' and new.status<>'bloqueado' then raise exception 'Somente administrador pode desbloquear o cliente';end if;
 end if;
 return new;
end $$;
revoke all on function public.proteger_credito_cliente_284() from public,anon,authenticated;
drop trigger if exists zz_credito_cliente_284 on public.pessoas;
create trigger zz_credito_cliente_284 before insert or update or delete on public.pessoas for each row execute function public.proteger_credito_cliente_284();
drop trigger if exists zz_credito_cliente_284 on public.clientes;
create trigger zz_credito_cliente_284 before insert or update or delete on public.clientes for each row execute function public.proteger_credito_cliente_284();

create or replace function public.cadastrar_cliente_representante_284(_dados jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare p uuid; k text; v jsonb; doc text; loja uuid; rota uuid;
begin
 if not public.usuario_ativo() or not public.escopo_representante() or not public.pode_rotina('clientes_cadastrar') or not exists(select 1 from public.representantes where id=public.meu_representante_id() and ativo) then raise exception 'Cadastro de clientes não liberado';end if;
 if _dados is null or jsonb_typeof(_dados)<>'object' or length(_dados::text)>18000 then raise exception 'Dados de cadastro inválidos';end if;
 for k,v in select * from jsonb_each(_dados) loop
  if k<>all(array['razao_social','nome_fantasia','cnpj_cpf','inscricao_estadual','email','telefone','logradouro','numero','complemento','bairro','cidade','uf','cep','codigo_ibge','observacoes','centro_id','rota_id']) or
   jsonb_typeof(v) not in ('string','null') or length(coalesce(v#>>'{}',''))>(case when k='observacoes' then 2000 else 250 end) then raise exception 'Campo de cadastro inválido: %',k;end if;
 end loop;
 if nullif(trim(_dados->>'razao_social'),'') is null then raise exception 'Informe a razão social ou nome';end if;
 doc:=regexp_replace(coalesce(_dados->>'cnpj_cpf',''),'[^0-9]','','g');
 if length(doc) not in (11,14) then raise exception 'Informe CPF ou CNPJ com 11 ou 14 dígitos';end if;
 loja:=(_dados->>'centro_id')::uuid;rota:=(_dados->>'rota_id')::uuid;
 insert into public.pessoas(razao_social,nome_fantasia,tipo_pessoa,cnpj_cpf,inscricao_estadual,email,telefone,
  logradouro,numero,complemento,bairro,cidade,uf,cep,codigo_ibge,observacoes,centro_id,rota_id,
  is_cliente,representante_id,limite_credito,status,credito_pendente)
 values(upper(trim(_dados->>'razao_social')),nullif(upper(trim(_dados->>'nome_fantasia')),''),case when length(doc)=11 then 'PF' else 'PJ' end,doc,
  nullif(trim(_dados->>'inscricao_estadual'),''),nullif(lower(trim(_dados->>'email')),''),nullif(trim(_dados->>'telefone'),''),
  nullif(upper(trim(_dados->>'logradouro')),''),nullif(trim(_dados->>'numero'),''),nullif(upper(trim(_dados->>'complemento')),''),
  nullif(upper(trim(_dados->>'bairro')),''),nullif(upper(trim(_dados->>'cidade')),''),nullif(upper(trim(_dados->>'uf')),''),
  nullif(regexp_replace(_dados->>'cep','[^0-9]','','g'),''),nullif(trim(_dados->>'codigo_ibge'),''),nullif(trim(_dados->>'observacoes'),''),loja,rota,
  true,public.meu_representante_id(),0,'bloqueado',true) returning id into p;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pessoas',p,'cliente_credito_solicitado',auth.uid(),jsonb_build_object('representante',public.meu_representante_id(),'centro',loja,'rota',rota));
 return p;
exception when unique_violation then raise exception 'Já existe cadastro com esse documento. Peça ao administrador para verificar o vínculo.';
end $$;
revoke all on function public.cadastrar_cliente_representante_284(jsonb) from public,anon,service_role;
grant execute on function public.cadastrar_cliente_representante_284(jsonb) to authenticated;

create or replace function public.liberar_credito_cliente_284(_pessoa uuid,_limite numeric) returns void
language plpgsql security definer set search_path=public as $$
declare p public.pessoas;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode liberar o limite';end if;
 if _limite is null or _limite::text in ('NaN','Infinity','-Infinity') or _limite<=0 or _limite>999999999999.99 or round(_limite,2)<>_limite then raise exception 'Informe um limite positivo com até duas casas decimais';end if;
 select * into p from public.pessoas where id=_pessoa for update;
 if p.id is null or not p.is_cliente or not p.credito_pendente or not p.ativo or not public.usuario_pode_acessar_centro(p.centro_id) then raise exception 'Cliente pendente indisponível para liberação';end if;
 update public.pessoas set limite_credito=_limite,credito_pendente=false,status='ativo' where id=_pessoa;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pessoas',_pessoa,'cliente_credito_liberado',auth.uid(),jsonb_build_object('limite',_limite));
end $$;
revoke all on function public.liberar_credito_cliente_284(uuid,numeric) from public,anon,service_role;
grant execute on function public.liberar_credito_cliente_284(uuid,numeric) to authenticated;

-- Zero não pode virar crédito ilimitado por uma aprovação de pedido ou PATCH.
create or replace function public.exigir_credito_liberado_284() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status not in ('rascunho','digitacao','cancelado') and exists(
  select 1 from public.clientes c join public.pessoas p on p.id=c.pessoa_id where c.id=new.cliente_id and p.credito_pendente
 ) then raise exception 'Aguarde o administrador liberar o limite do cliente antes de aprovar ou confirmar o pedido';end if;
 return new;
end $$;
revoke all on function public.exigir_credito_liberado_284() from public,anon,authenticated;
drop trigger if exists zz_exigir_credito_284 on public.pedidos;
create trigger zz_exigir_credito_284 before insert or update on public.pedidos for each row execute function public.exigir_credito_liberado_284();

create or replace function public.painel_vendas_representante_284(_ano integer default null,_centro uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rid uuid:=public.meu_representante_id(); ano integer:=coalesce(_ano,extract(year from now() at time zone 'America/Sao_Paulo')::integer); resultado jsonb;
begin
 if not public.usuario_ativo() or not public.escopo_representante() or rid is null or not exists(select 1 from public.representantes where id=rid and ativo) or
 not exists(select 1 from public.role_menus m join public.user_roles ur on ur.role::text=m.role::text where ur.user_id=auth.uid() and m.path='/dashboard') then raise exception 'Painel do representante não liberado';end if;
 if ano<2000 or ano>2100 then raise exception 'Ano inválido';end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Loja sem acesso';end if;
 with vendas as materialized (
  select extract(month from p.data_pedido)::integer mes,sum(p.total_liquido) valor,count(*) pedidos
  from public.pedidos p join public.clientes c on c.id=p.cliente_id
  where p.representante_id=rid and c.representante_id=rid and public.agenda_cliente_acessivel_228(c.id)
   and public.usuario_pode_acessar_centro(p.centro_id) and p.data_pedido>=make_date(ano,1,1) and p.data_pedido<make_date(ano+1,1,1)
   and coalesce(p.tipo_documento,'pedido')='pedido'
   and (_centro is null or p.centro_id=_centro)
   and p.status in ('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
  group by 1
 ) select jsonb_build_object('ano',ano,'total',coalesce((select sum(valor) from vendas),0),
  'meses',(select jsonb_agg(jsonb_build_object('mes',m,'valor',coalesce(v.valor,0),'pedidos',coalesce(v.pedidos,0)) order by m) from generate_series(1,12) m left join vendas v on v.mes=m),
  'carteira',(select count(*) from public.clientes c where c.representante_id=rid and public.agenda_cliente_acessivel_228(c.id) and (_centro is null or c.centro_id is null or c.centro_id=_centro)),
  'credito_pendente',(select count(*) from public.pessoas p where p.representante_id=rid and p.credito_pendente and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro))) into resultado;
 return resultado;
end $$;
revoke all on function public.painel_vendas_representante_284(integer,uuid) from public,anon,service_role;
grant execute on function public.painel_vendas_representante_284(integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
