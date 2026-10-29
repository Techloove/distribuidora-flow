-- Manual API Sicredi 4.0 §§7.6,7.7,7.10,7.11. Instala estrutura, sem enviar instruções.
begin;
create table if not exists public.sicredi_condicoes_historico_292 (
 id uuid primary key default gen_random_uuid(), boleto_id uuid not null references public.boletos(id),
 centro_id uuid not null references public.centros(id), usuario_id uuid not null references public.profiles(id),
 chave uuid not null unique, tipo text not null check(tipo in('abatimento','cancelar_abatimento','desconto','data_desconto')),
 motivo text not null check(length(trim(motivo)) between 10 and 2000),
 anterior jsonb not null, esperado jsonb not null, retorno jsonb,
 estado text not null default 'solicitado' check(estado in('solicitado','enviado','incerto','confirmado','rejeitado','encerrado')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists sicredi_condicoes_pendente_292 on public.sicredi_condicoes_historico_292(boleto_id)
 where estado in('solicitado','enviado','incerto');
alter table public.boletos add column if not exists condicoes_sicredi_292 jsonb;
alter table public.boletos add column if not exists condicoes_pendente_292 uuid references public.sicredi_condicoes_historico_292(id);
create or replace function public.proteger_condicoes_sicredi_292() returns trigger
language plpgsql set search_path=public as $$begin
 if (new.condicoes_sicredi_292 is distinct from old.condicoes_sicredi_292 or new.condicoes_pendente_292 is distinct from old.condicoes_pendente_292)
 and coalesce(auth.role(),'')<>'service_role' then raise exception 'Condições bancárias só podem ser gravadas pelo servidor';end if;
 return new;end $$;
revoke all on function public.proteger_condicoes_sicredi_292() from public,anon,authenticated;
drop trigger if exists proteger_condicoes_sicredi_292 on public.boletos;
create trigger proteger_condicoes_sicredi_292 before update on public.boletos for each row execute function public.proteger_condicoes_sicredi_292();
alter table public.sicredi_condicoes_historico_292 enable row level security;
revoke all on public.sicredi_condicoes_historico_292 from public,anon,authenticated;
grant select on public.sicredi_condicoes_historico_292 to authenticated;
grant all on public.sicredi_condicoes_historico_292 to service_role;
drop policy if exists consultar_condicoes_292 on public.sicredi_condicoes_historico_292;
create policy consultar_condicoes_292 on public.sicredi_condicoes_historico_292 for select to authenticated using (
 exists(select 1 from public.profiles where id=auth.uid() and ativo) and public.has_role(auth.uid(),'admin')
 and public.ator_financeiro_pode_acessar_centro(auth.uid(),centro_id));

create or replace function public.sicredi_reservar_condicoes_292(
 _actor uuid,_boleto uuid,_chave uuid,_tipo text,_motivo text,_anterior jsonb,_esperado jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.boletos; t public.contas_receber; s public.sicredi_condicoes_historico_292; saldo numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from profiles where id=_actor and ativo)
 or not public.has_role(_actor,'admin') then raise exception 'Somente administrador ativo pelo servidor';end if;
 if _chave is null or length(trim(coalesce(_motivo,''))) not between 10 and 2000 then raise exception 'Informe chave e motivo com 10 a 2000 caracteres';end if;
 select * into b from boletos where id=_boleto for update;
 if b.id is null or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id),false) then raise exception 'Sem acesso ao boleto';end if;
 select * into s from sicredi_condicoes_historico_292 where chave=_chave;
 if s.id is not null then
  if s.boleto_id<>b.id or s.usuario_id<>_actor then raise exception 'Chave de outra operação';end if;
  return jsonb_build_object('id',s.id,'enviar',false);
 end if;
 if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' or b.status is distinct from 'registrado'
 or coalesce(b.nosso_numero,'') !~ '^\d{9}$' then raise exception 'Exige boleto API Sicredi registrado';end if;
 if b.condicoes_pendente_292 is not null or b.vencimento_solicitacao_id is not null
 or coalesce((b.retorno->>'cancelamento_sicredi_pendente')::boolean,false) then raise exception 'Existe instrução pendente. Confira no Sicredi';end if;
 select * into t from contas_receber where id=b.conta_receber_id for update;
 saldo:=round(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 if t.id is null or t.centro_id is distinct from b.centro_id or t.status is distinct from 'aberto'
 or coalesce(t.valor_pago,0)<>0 or saldo is distinct from b.valor then raise exception 'Título mudou ou tem recebimento. Concilie antes de alterar';end if;
 if jsonb_typeof(_anterior) is distinct from 'object' or jsonb_typeof(_esperado) is distinct from 'object'
 or (_anterior->>'nominal')::numeric is distinct from b.valor or (_esperado->>'nominal')::numeric is distinct from b.valor
 or (_anterior->>'vencimento')::date is distinct from b.vencimento
 or coalesce(_anterior->>'situacao','') not in('EM CARTEIRA','VENCIDO')
 or _tipo not in('abatimento','cancelar_abatimento','desconto','data_desconto')
 then raise exception 'Condições bancárias divergentes';end if;
 insert into sicredi_condicoes_historico_292(boleto_id,centro_id,usuario_id,chave,tipo,motivo,anterior,esperado)
 values(b.id,b.centro_id,_actor,_chave,_tipo,trim(_motivo),_anterior,_esperado) returning id into s.id;
 update boletos set condicoes_pendente_292=s.id where id=b.id;
 insert into auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'solicitar_condicoes_sicredi_292',jsonb_build_object('solicitacao',s.id,'tipo',_tipo,'motivo',trim(_motivo),'anterior',_anterior,'esperado',_esperado),_actor);
 return jsonb_build_object('id',s.id,'enviar',true);
end $$;

create or replace function public.sicredi_finalizar_condicoes_292(
 _actor uuid,_boleto uuid,_solicitacao uuid,_estado text,_banco jsonb default null
) returns void language plpgsql security definer set search_path=public as $$
declare b public.boletos;s public.sicredi_condicoes_historico_292;
begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from profiles where id=_actor and ativo) then raise exception 'Operação exclusiva do servidor ativo';end if;
 select * into b from boletos where id=_boleto for update;
 if b.id is null or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id),false) then raise exception 'Sem acesso ao boleto';end if;
 select * into s from sicredi_condicoes_historico_292 where id=_solicitacao and boleto_id=b.id for update;
 if s.id is null then raise exception 'Solicitação não encontrada';end if;
 if s.estado in('confirmado','rejeitado','encerrado') then return;end if;
 if b.condicoes_pendente_292 is distinct from s.id or _estado is null or _estado not in('enviado','incerto','confirmado','rejeitado','encerrado') then raise exception 'Estado ou solicitação divergente';end if;
 if _estado='confirmado' then
  if _banco is null or (_banco-'situacao') is distinct from (s.esperado-'situacao')
   or coalesce(_banco->>'situacao','') not in('EM CARTEIRA','VENCIDO') or b.status is distinct from 'registrado'
   or (_banco->>'nominal')::numeric is distinct from b.valor then raise exception 'Banco não confirmou as condições solicitadas';end if;
  update boletos set condicoes_sicredi_292=_banco where id=b.id;
 end if;
 if _estado='encerrado' and coalesce(_banco->>'situacao','') not like 'LIQUIDAD%' and coalesce(_banco->>'situacao','') not like 'BAIXAD%'
 then raise exception 'Encerramento exige confirmação de liquidação ou baixa bancária';end if;
 update sicredi_condicoes_historico_292 set estado=_estado,retorno=coalesce(_banco,retorno),updated_at=clock_timestamp() where id=s.id;
 if _estado in('confirmado','rejeitado','encerrado') then update boletos set condicoes_pendente_292=null where id=b.id;end if;
 insert into auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'retorno_condicoes_sicredi_292',jsonb_build_object('solicitacao',s.id,'estado',_estado,'banco',_banco),_actor);
end $$;
revoke all on function public.sicredi_reservar_condicoes_292(uuid,uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.sicredi_finalizar_condicoes_292(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_reservar_condicoes_292(uuid,uuid,uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.sicredi_finalizar_condicoes_292(uuid,uuid,uuid,text,jsonb) to service_role;
-- Instruções concorrentes de vencimento e baixa também verificam a reserva no banco.
do $$declare d text;alvo text;assinatura text;begin
 foreach assinatura in array array['public.sicredi_solicitar_vencimento(uuid,uuid,date,date,jsonb)','public.autorizar_baixa_boleto_285(uuid,text)'] loop
  select pg_get_functiondef(assinatura::regprocedure) into d;
  if position('instrucao_pendente_292' in d)=0 then
   alvo:=case when assinatura like '%autorizar_baixa%' then 'update public.boletos set baixa_motivo_285=' else 'select * into b from public.boletos where id=_boleto for update;' end;
   if position(alvo in d)=0 then raise exception 'Revise a instrução concorrente: %',assinatura;end if;
   -- Só substitui a primeira ocorrência, preservando outras condições existentes.
   d:=overlay(d placing E'\n -- instrucao_pendente_292\n if b.condicoes_pendente_292 is not null then raise exception ''Existe alteração de desconto/abatimento pendente. Confira no Sicredi'';end if;\n ' from position(alvo in d)+case when assinatura like '%autorizar_baixa%' then 0 else length(alvo) end for 0);
   execute d;
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
