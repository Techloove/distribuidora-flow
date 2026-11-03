-- Distingue resposta fixa do sandbox de registro bancário. Não toca produção.
begin;
alter table public.sicoob_sandbox_316 drop constraint if exists sicoob_sandbox_316_status_check;
alter table public.sicoob_sandbox_316 add constraint sicoob_sandbox_316_status_check check(status in('em_processamento','registrado','liquidado','baixado','erro','simulado'));
create or replace function public.sicoob_mock_recebido_320(_actor uuid,_teste uuid,_resposta jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare t sicoob_sandbox_316;o sicoob_operacoes_316;
begin
 select * into t from sicoob_sandbox_316 where id=_teste for update;
 perform validar_sicoob_316(_actor,t.centro_id);
 if t.ambiente is distinct from 'homologacao' or t.nosso_numero is not null or t.status not in('em_processamento','simulado') then raise exception 'Teste não elegível para resposta simulada';end if;
 if jsonb_typeof(_resposta)<>'object' or _resposta->>'nossoNumero' is distinct from '-2147483648' or _resposta->>'codigoModalidade' is distinct from '1' or coalesce((_resposta->>'numeroCliente')::bigint,0)<=0 or coalesce((_resposta->>'valor')::numeric,-1)<0 then raise exception 'Resposta simulada não reconhecida';end if;
 if t.status='simulado' then return;end if;
 select * into o from sicoob_operacoes_316 where id=t.sicoob_pendente_316 and teste_id=t.id and tipo='emissao' and estado in('enviado','incerto') for update;
 if o.id is null then raise exception 'Emissão sandbox pendente não encontrada';end if;
 update sicoob_operacoes_316 set estado='encerrado',resposta=_resposta,nota='Resposta fixa do sandbox recebida; não confirma registro de boleto ou execução financeira.',updated_at=now() where id=o.id;
 update sicoob_sandbox_316 set status='simulado',retorno=_resposta,erro=null,sicoob_pendente_316=null,updated_at=now() where id=t.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('sicoob_sandbox_316',t.id,'resposta_simulada_320',_actor,jsonb_build_object('operacao_id',o.id,'efeito_financeiro',false));
end $$;
revoke all on function public.sicoob_mock_recebido_320(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sicoob_mock_recebido_320(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
