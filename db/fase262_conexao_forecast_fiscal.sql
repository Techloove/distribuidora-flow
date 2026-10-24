-- Conexão somente leitura. Aplicar manualmente após a fase261.
begin;
do $$begin
 if to_regprocedure('public.estado_provedor_fiscal_261(uuid)') is null then
  raise exception 'Aplique a fase261 antes da fase262';
 end if;
end $$;
create table if not exists public.forecast_credenciais_262 (
 centro_id uuid primary key references public.centros(id),
 cnpj text not null check(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 token text not null check(length(token) between 1 and 2048 and token !~ '[[:space:][:cntrl:]:]'),
 ambiente_declarado text not null check(ambiente_declarado in ('homologacao','producao')),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id)
);
alter table public.forecast_credenciais_262 enable row level security;
revoke all on public.forecast_credenciais_262 from public,anon,authenticated;
grant all on public.forecast_credenciais_262 to service_role;

create or replace function public.estado_conexao_forecast_262(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare e jsonb;c public.forecast_credenciais_262;begin
 e:=public.estado_provedor_fiscal_261(_loja);
 select * into c from public.forecast_credenciais_262 where centro_id=_loja;
 return jsonb_build_object('cnpj_loja',e->>'cnpj_loja','cnpj_configurado',c.cnpj,
  'token_configurado',c.token is not null,'ambiente_declarado',c.ambiente_declarado,
  'vinculo_atual',coalesce(c.cnpj=e->>'cnpj_loja' and (e->>'vinculo_atual')::boolean and e->>'provedor'='forecastfiscal',false),
  'emissao_disponivel',false,'updated_at',c.updated_at);
end $$;
revoke all on function public.estado_conexao_forecast_262(uuid) from public,anon;
grant execute on function public.estado_conexao_forecast_262(uuid) to authenticated;

create or replace function public.salvar_conexao_forecast_262(_loja uuid,_cnpj text,_token text,_ambiente text) returns void
language plpgsql security definer set search_path=public as $$
declare e jsonb;c public.forecast_credenciais_262;novo_token text;begin
 perform 1 from public.centros where id=_loja for update;
 e:=public.estado_provedor_fiscal_261(_loja);
 if not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador configura a Forecast';end if;
 if e->>'provedor'<>'forecastfiscal' or not coalesce((e->>'vinculo_atual')::boolean,false) then
  raise exception 'Salve o provedor Forecast para o CNPJ atual da loja antes de configurar';end if;
 if _cnpj is null or _cnpj !~ '^[A-Z0-9]{12}[0-9]{2}$' or _cnpj<>e->>'cnpj_loja' then
  raise exception 'CNPJ deve corresponder ao CNPJ atual da loja';end if;
 if _ambiente is null or _ambiente not in ('homologacao','producao') then raise exception 'Ambiente inválido';end if;
 select * into c from public.forecast_credenciais_262 where centro_id=_loja;
 novo_token:=nullif(_token,'');
 if novo_token is null and c.cnpj=_cnpj and c.ambiente_declarado=_ambiente then novo_token:=c.token;end if;
 if novo_token is null or length(novo_token)>2048 or novo_token ~ '[[:space:][:cntrl:]:]' then
  raise exception 'Informe um token válido para este CNPJ e ambiente, sem prefixo Basic';end if;
 insert into public.forecast_credenciais_262(centro_id,cnpj,token,ambiente_declarado,updated_by)
 values(_loja,_cnpj,novo_token,_ambiente,auth.uid())
 on conflict(centro_id) do update set cnpj=excluded.cnpj,token=excluded.token,
  ambiente_declarado=excluded.ambiente_declarado,updated_at=now(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
 values('centros',_loja,'forecast_conexao_configurada',jsonb_build_object('cnpj',_cnpj,'ambiente_declarado',_ambiente,'emissao_liberada',false),auth.uid());
end $$;
revoke all on function public.salvar_conexao_forecast_262(uuid,text,text,text) from public,anon;
grant execute on function public.salvar_conexao_forecast_262(uuid,text,text,text) to authenticated;
-- Preservar configuração quando a limpeza administrativa mantém configurações.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('forecast_credenciais_262' in d)=0 then
   if position('''sicredi_config''' in d)=0 then raise exception 'Revise a preservação da conexão Forecast na limpeza';end if;
   execute replace(d,'''sicredi_config''','''sicredi_config'',''forecast_credenciais_262''');
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
