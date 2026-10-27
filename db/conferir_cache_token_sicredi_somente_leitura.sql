-- SOMENTE LEITURA: verifica estrutura/permissões do cache de autenticação.
-- Não lê tokens, senhas, chaves ou registros da tabela e não chama as funções.
with tabela as (
 select to_regclass('public.sicredi_tokens_224') as oid
), funcoes(assinatura,parametros,retorno) as (
 values
 ('public.sicredi_token_reservar_224(text)',array['_chave']::text[],'jsonb'),
 ('public.sicredi_token_concluir_224(text,uuid,jsonb)',array['_chave','_lease','_dados']::text[],'void')
), linhas as (
 select 'Tabela do cache'::text as verificacao,
 case when t.oid is null then 'AUSENTE' else 'PRESENTE' end as resultado
 from tabela t
 union all
 select 'Colunas necessárias do cache',
 case when t.oid is null then 'Tabela ausente'
 when cardinality(x.faltam)=0 then 'Todas presentes' else 'Faltam: '||array_to_string(x.faltam,', ') end
 from tabela t cross join lateral (
 select array(select col from unnest(array['chave','access_token','refresh_token','access_expira','refresh_expira','lease','lease_expira','updated_at']) col
 where not exists(select 1 from pg_attribute a where a.attrelid=t.oid and a.attname=col and a.attnum>0 and not a.attisdropped)) as faltam
 ) x
 union all
 select 'RLS da tabela do cache',case when c.oid is null then 'Tabela ausente' when c.relrowsecurity then 'Ativa' else 'Inativa — revisar proteção' end
 from tabela t left join pg_class c on c.oid=t.oid
 union all
 select 'Permissões de tabela para service_role',case when t.oid is null then 'Tabela ausente'
 when has_table_privilege('service_role',t.oid,'SELECT') and has_table_privilege('service_role',t.oid,'INSERT')
 and has_table_privilege('service_role',t.oid,'UPDATE') and has_table_privilege('service_role',t.oid,'DELETE')
 then 'SELECT/INSERT/UPDATE/DELETE presentes' else 'Permissão necessária ausente' end from tabela t
 union all
 select 'Acesso da service_role ao schema public',case when has_schema_privilege('service_role','public','USAGE') then 'Permitido' else 'AUSENTE' end
 union all
 select f.assinatura||' — presença',case when p.oid is null then 'AUSENTE' else 'PRESENTE' end
 from funcoes f left join pg_proc p on p.oid=to_regprocedure(f.assinatura)
 union all
 select f.assinatura||' — execução pela service_role',case when p.oid is null then 'Função ausente'
 when has_function_privilege('service_role',p.oid,'EXECUTE') then 'Permitida' else 'AUSENTE' end
 from funcoes f left join pg_proc p on p.oid=to_regprocedure(f.assinatura)
 union all
 select f.assinatura||' — parâmetros usados pela RPC',case when p.oid is null then 'Função ausente'
 when p.proargnames=f.parametros then 'Compatíveis' else 'Divergentes: '||coalesce(array_to_string(p.proargnames,', '),'sem nomes') end
 from funcoes f left join pg_proc p on p.oid=to_regprocedure(f.assinatura)
 union all
 select f.assinatura||' — tipo de retorno',case when p.oid is null then 'Função ausente'
 when p.prorettype::regtype::text=f.retorno then 'Compatível: '||f.retorno else 'Divergente: '||p.prorettype::regtype::text end
 from funcoes f left join pg_proc p on p.oid=to_regprocedure(f.assinatura)
 union all
 select f.assinatura||' — SECURITY DEFINER',case when p.oid is null then 'Função ausente' when p.prosecdef then 'Sim' else 'Não — conferir implantação' end
 from funcoes f left join pg_proc p on p.oid=to_regprocedure(f.assinatura)
)
select verificacao,resultado from linhas order by verificacao;
