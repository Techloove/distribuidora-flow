-- Fase219: Pix por chave, sem boleto híbrido ou confirmação bancária automática.
begin;
alter table public.contas_financeiras add column if not exists chave_pix text;
alter table public.contas_financeiras add column if not exists pix_beneficiario text;
alter table public.contas_financeiras add column if not exists pix_cidade text;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('pix_gerar','Gerar Pix por chave para título sem boleto ativo','Pix',128,'/receber') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase219' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'pix_gerar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase219','instalada','{}');
 end if;
end $$;
create or replace function public.dados_pix_219(_titulo uuid,_conta uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; c public.contas_financeiras; saldo numeric;
begin
 if not public.pode_rotina('pix_gerar') or not public.can_finance(auth.uid()) then raise exception 'Sem acesso ao Pix'; end if;
 select * into t from public.contas_receber where id=_titulo;
 select * into c from public.contas_financeiras where id=_conta;
 if t.id is null or not public.usuario_pode_acessar_centro(t.centro_id) or (public.escopo_representante() and not public.cliente_na_minha_carteira(t.cliente_id)) or c.id is null or not public.usuario_pode_acessar_conta_financeira(c.id) or (c.centro_id is not null and c.centro_id<>t.centro_id) then raise exception 'Título ou conta sem acesso'; end if;
 if not c.ativo or (coalesce(c.banco_codigo,'')<>'748' and coalesce(c.banco,'') not ilike '%sicredi%') then raise exception 'Selecione conta Sicredi ativa'; end if;
 if nullif(trim(c.chave_pix),'') is null or nullif(trim(c.pix_beneficiario),'') is null or nullif(trim(c.pix_cidade),'') is null then raise exception 'Configure chave, beneficiário e cidade em Caixa e bancos'; end if;
 if exists(select 1 from public.boletos where conta_receber_id=t.id and coalesce(status,'') not in ('cancelado','baixado','liquidado','pago')) then raise exception 'Confirme baixa/cancelamento do boleto antes de gerar Pix independente'; end if;
 saldo:=round(t.valor+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 if t.status in ('pago','cancelado') or saldo<=0 then raise exception 'Título sem saldo para Pix'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',t.id,'gerar_pix_chave',auth.uid(),jsonb_build_object('conta',c.id,'valor',saldo));
 return jsonb_build_object('chave',c.chave_pix,'beneficiario',c.pix_beneficiario,'cidade',c.pix_cidade,'valor',saldo,'txid',left(replace(t.id::text,'-',''),25));
end $$;
revoke all on function public.dados_pix_219(uuid,uuid) from public,anon;
grant execute on function public.dados_pix_219(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
