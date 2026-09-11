-- Fase 40: consulta cadastral (CNPJ/CPF) e Inscrição Estadual no Cadastro Unificado (pessoas)
-- Reutiliza a estrutura já existente de clientes: mesmos nomes de coluna, mesmo cache
-- (consultas_cadastrais / consultas_ie) e mesmo histórico (consultas_log).
-- Idempotente e sem alterar dados existentes.

alter table public.pessoas
  add column if not exists situacao_cadastral text,
  add column if not exists data_abertura date,
  add column if not exists data_nascimento date,
  add column if not exists natureza_juridica text,
  add column if not exists porte text,
  add column if not exists cnae_principal text,
  add column if not exists cnae_secundarios text,
  add column if not exists cadastro_provedor text,
  add column if not exists cadastro_consultado_em timestamptz,
  add column if not exists cadastro_atualizado_em timestamptz,
  add column if not exists uf_inscricao_estadual text,
  add column if not exists situacao_inscricao_estadual text,
  add column if not exists indicador_contribuinte_icms text,
  add column if not exists data_ultima_consulta_ie timestamptz,
  add column if not exists ie_provedor text;

-- histórico pode apontar para uma pessoa do cadastro unificado
alter table public.consultas_log
  add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null;

-- duplicidade de documento dentro do cadastro unificado
create or replace function public.pessoa_por_documento(_documento text)
returns table(id uuid, codigo text, razao_social text, cnpj_cpf text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.codigo, p.razao_social, p.cnpj_cpf, p.status
  from public.pessoas p
  where public.so_digitos(p.cnpj_cpf) = public.so_digitos(_documento)
    and public.so_digitos(_documento) <> ''
  limit 5
$$;

grant execute on function public.pessoa_por_documento(text) to authenticated;

create index if not exists pessoas_documento_digitos_idx
  on public.pessoas (public.so_digitos(cnpj_cpf));
