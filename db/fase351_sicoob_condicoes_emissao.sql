-- Condições padrão somente para novas emissões Sicoob. Não altera credenciais, títulos nem finanças.
begin;
alter table public.sicoob_config_316 add column if not exists condicoes_emissao jsonb not null default '{"especie":"DM","formulario":1,"pix":2,"multaTipo":0,"multaValor":0,"multaDias":1,"jurosTipo":3,"jurosValor":0,"jurosDias":1,"descontoTipo":0,"descontoValor":0,"descontoDias":0,"protestoTipo":3,"protestoDias":30,"negativacaoTipo":3,"negativacaoDias":60,"limiteDias":0,"instrucoes":""}'::jsonb check(jsonb_typeof(condicoes_emissao)='object');
create or replace function public.sicoob_config_salvar_351(_actor uuid,_centro uuid,_config jsonb,_conta uuid,_ativo boolean,_esperada int,_segredo jsonb default null,_ambiente text default 'producao') returns void
language plpgsql security definer set search_path=public as $$
declare anterior jsonb;condicoes jsonb;mudou boolean;
begin
 perform validar_sicoob_316(_actor,_centro,true);
 condicoes:=coalesce(_config->'condicoes_emissao','{}'::jsonb);
 if jsonb_typeof(condicoes) is distinct from 'object' or octet_length(condicoes::text)>8000 then raise exception 'Condições de emissão inválidas';end if;
 insert into sicoob_config_316(centro_id,ambiente) values(_centro,_ambiente) on conflict do nothing;
 select condicoes_emissao into anterior from sicoob_config_316 where centro_id=_centro and ambiente=_ambiente for update;
 mudou:=anterior is distinct from condicoes;
 if mudou and _ativo then raise exception 'Salve as condições desativadas e teste a conexão antes de habilitar';end if;
 perform sicoob_config_salvar_316(_actor,_centro,_config,_conta,_ativo,_esperada,_segredo,_ambiente);
 if mudou then
  update sicoob_config_316 set condicoes_emissao=condicoes,versao=greatest(versao,_esperada+1),autenticado_em=null,autenticado_versao=null,updated_at=now() where centro_id=_centro and ambiente=_ambiente;
  insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('cobranca_centros',_centro,'condicoes_sicoob_351',_actor,jsonb_build_object('ambiente',_ambiente,'condicoes',condicoes));
 end if;
end $$;
revoke all on function public.sicoob_config_salvar_351(uuid,uuid,jsonb,uuid,boolean,int,jsonb,text) from public,anon,authenticated;
grant execute on function public.sicoob_config_salvar_351(uuid,uuid,jsonb,uuid,boolean,int,jsonb,text) to service_role;
create or replace function public.sicoob_reservar_emissao_351(_actor uuid,_conta uuid,_payload jsonb,_versao int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_config_316;r jsonb;
begin
 select s.* into c from sicoob_config_316 s join contas_receber t on t.centro_id=s.centro_id where t.id=_conta and s.ambiente='producao' for share of s;
 perform validar_sicoob_316(_actor,c.centro_id);
 if c.versao is distinct from _versao then raise exception 'As condições de emissão mudaram. Atualize antes de emitir';end if;
 r:=sicoob_reservar_emissao_316(_actor,_conta,_payload);
 if not coalesce((r->>'recuperar')::boolean,true) then
  update boletos set sicoob_snapshot_316=sicoob_snapshot_316||jsonb_build_object('condicoes_emissao',c.condicoes_emissao) where id=(r->'boleto'->>'id')::uuid;
 end if;
 return r;
end $$;
revoke all on function public.sicoob_reservar_emissao_351(uuid,uuid,jsonb,int) from public,anon,authenticated;
grant execute on function public.sicoob_reservar_emissao_351(uuid,uuid,jsonb,int) to service_role;
notify pgrst,'reload schema';
commit;
