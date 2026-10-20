-- Parte1: identidade das Lojas. Preserva IDs, carteira, permissões, cobrança e estoque compartilhado.
begin;
do $$begin
 if to_regprocedure('public.decidir_orcamento_base_241(uuid,text,text)') is null then raise exception 'Aplique a fase241 antes da fase242';end if;
end $$;
alter table public.centros
 add column if not exists razao_social text,
 add column if not exists nome_fantasia text,
 add column if not exists cnpj text,
 add column if not exists inscricao_estadual text,
 add column if not exists email text,
 add column if not exists telefone text,
 add column if not exists logradouro text,
 add column if not exists numero text,
 add column if not exists bairro text,
 add column if not exists cep text,
 add column if not exists logo_url text;
-- Inicializa identidade com os dados existentes apenas uma vez, sem sobrescrever ajustes posteriores.
do $$declare e record;begin
 if not exists(select 1 from public.auditoria where tabela='fase242' and acao='identidade_lojas_iniciada') then
  select * into e from public.empresas order by created_at,id limit 1;
  if found then
   update public.centros set razao_social=coalesce(razao_social,e.razao_social),nome_fantasia=coalesce(nome_fantasia,nome),
    cnpj=coalesce(cnpj,e.cnpj),inscricao_estadual=coalesce(inscricao_estadual,e.inscricao_estadual),
    email=coalesce(email,e.email),telefone=coalesce(telefone,e.telefone),logradouro=coalesce(logradouro,e.logradouro),
    numero=coalesce(numero,e.numero),bairro=coalesce(bairro,e.bairro),cep=coalesce(cep,e.cep),
    cidade=coalesce(cidade,e.cidade),uf=coalesce(uf,e.uf);
  end if;
  insert into public.auditoria(tabela,acao,detalhe) values('fase242','identidade_lojas_iniciada','{}'::jsonb);
 end if;
end $$;
alter table public.centros drop constraint if exists loja_logo_valida_242;
alter table public.centros add constraint loja_logo_valida_242 check(logo_url is null or logo_url='' or
 (length(logo_url)<=350000 and (logo_url~'^https://[^[:space:]<>]+$' or logo_url~'^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')));
notify pgrst,'reload schema';
commit;
