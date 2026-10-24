-- Prévia de homologação: somente leitura, sem transmissão e sem chave de serviço.
begin;
do $$begin
 if to_regprocedure('public.estado_conexao_forecast_262(uuid)') is null
 or exists(select 1 from information_schema.columns where table_schema='public' and table_name='notas_saida' and column_name='faznotas_estado') then
  raise exception 'Aplique a fase264 antes da fase265';
 end if;
end $$;
create or replace function public.contexto_homologacao_forecast_265(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n public.notas_saida;p public.pedidos;resultado jsonb;ator uuid:=auth.uid();begin
 if ator is null or not public.usuario_ativo() or not public.can_bill(ator)
 or not exists(select 1 from public.profiles a where a.id=ator and a.ativo and not coalesce(a.precisa_completar_cadastro,false)) then
  raise exception 'Sem permissão para conferir a homologação fiscal';end if;
 if not public.can_manage(ator) and not (
  exists(select 1 from public.user_roles u join public.role_permissoes rp on rp.role=u.role::text where u.user_id=ator and rp.permissao='faturamento_emitir_nfe')
  and exists(select 1 from public.user_roles u join public.role_menus rm on rm.role::text=u.role::text where u.user_id=ator and rm.path='/notas')) then
  raise exception 'Permissão fiscal não liberada para o usuário';end if;
 select * into n from public.notas_saida where id=_nota;
 select * into p from public.pedidos where id=n.pedido_id;
 if n.id is null or p.id is null or n.centro_id is distinct from p.centro_id or n.cliente_id is distinct from p.cliente_id
 or not public.usuario_pode_acessar_centro(n.centro_id) or not public.ator_financeiro_pode_acessar_centro(ator,n.centro_id) then
  raise exception 'Nota indisponível ou loja sem acesso';end if;
 if public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id) then
  raise exception 'Pedido fora da carteira do usuário';end if;
 if (select count(*) from public.pedido_itens where pedido_id=p.id)>500 then
  raise exception 'A prévia desta fase aceita até 500 itens por nota';end if;
 select jsonb_build_object(
  'nota',(select jsonb_object_agg(k,to_jsonb(n)->k) from unnest(array['id','pedido_id','centro_id','cliente_id','status','serie','nf_numero','chave_acesso','protocolo','valor_total']) k),
  'pedido',(select jsonb_object_agg(k,to_jsonb(p)->k) from unnest(array['id','centro_id','cliente_id','status','total_itens','total_liquido','desconto_valor','forma_desconto_valor','forma_acrescimo_valor','frete_valor','frete_volume_valor','outras_despesas']) k),
  'loja',(select jsonb_object_agg(k,to_jsonb(l)->k) from unnest(array['id','nome','cnpj','uf','ativo','inscricao_estadual']) k),
  'fiscal',(select jsonb_object_agg(k,to_jsonb(f)->k) from unnest(array['serie','regime','uf_emitente','cfop_interno','cfop_interestadual','revisado_contador']) k),
  'cliente',(select jsonb_object_agg(k,to_jsonb(coalesce(nullif(to_jsonb(pe)->>k,''),to_jsonb(c)->>k))) from unnest(array['tipo_pessoa','cnpj_cpf','razao_social','inscricao_estadual','indicador_contribuinte_icms','logradouro','numero','complemento','bairro','cidade','uf','cep']) k),
  'conexao',jsonb_build_object('token_configurado',cr.centro_id is not null,'cnpj_configurado',cr.cnpj,'ambiente_declarado',cr.ambiente_declarado,
   'vinculo_atual',coalesce(v.provedor='forecastfiscal' and v.cnpj=cr.cnpj and cr.cnpj=upper(regexp_replace(l.cnpj,'[^a-zA-Z0-9]','','g')),false)),
  'bloqueio_faturamento',public.bloqueio_faturamento(p.id),
  'itens',coalesce((select jsonb_agg(jsonb_build_object(
   'item',(select jsonb_object_agg(k,to_jsonb(i)->k) from unnest(array['id','produto_id','quantidade','preco_unitario','desconto_percentual','total']) k),
   'produto',(select jsonb_object_agg(k,to_jsonb(pr)->k) from unnest(array['id','codigo','descricao','ncm','cest','ean','unidade','origem_fiscal','cfop','cfop_interestadual']) k),
   'disponivel_loja',coalesce(lp.disponivel and public.produto_categoria_loja_246(p.centro_id,i.produto_id),false)
   ) order by i.id) from public.pedido_itens i
   left join public.produtos pr on pr.id=i.produto_id
   left join public.loja_produtos lp on lp.produto_id=i.produto_id and lp.centro_id=p.centro_id
   where i.pedido_id=p.id),'[]'::jsonb)
 ) into resultado
 from public.centros l join public.clientes c on c.id=p.cliente_id
 left join public.pessoas pe on pe.id=c.pessoa_id
 left join public.loja_fiscal_256 f on f.centro_id=l.id
 left join public.forecast_credenciais_262 cr on cr.centro_id=l.id
 left join public.loja_provedor_fiscal_261 v on v.centro_id=l.id
 where l.id=p.centro_id and l.ativo;
 if resultado is null then raise exception 'Loja ou cliente indisponível';end if;
 return resultado;
end $$;
revoke all on function public.contexto_homologacao_forecast_265(uuid) from public,anon,service_role;
grant execute on function public.contexto_homologacao_forecast_265(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
