-- FASE 198: cliente espelha rota, centro de custo, representante e IBGE do cadastro unificado
CREATE OR REPLACE FUNCTION public.sincronizar_pessoa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _id uuid;
begin
  -- CLIENTE
  select id into _id from public.clientes where pessoa_id = new.id limit 1;
  if new.is_cliente then
    if _id is null then
      insert into public.clientes (
        pessoa_id, razao_social, nome_fantasia, tipo_pessoa, cnpj_cpf, inscricao_estadual,
        email, telefone, logradouro, numero, complemento, bairro, cidade, uf, cep,
        limite_credito, condicao_pagamento, tabela_preco, representante_id, rota_id, centro_id, codigo_ibge, status, observacoes
      ) values (
        new.id, new.razao_social, new.nome_fantasia, new.tipo_pessoa, new.cnpj_cpf, new.inscricao_estadual,
        new.email, new.telefone, new.logradouro, new.numero, new.complemento, new.bairro, new.cidade, new.uf, new.cep,
        new.limite_credito, new.condicao_pagamento, new.tabela_preco, new.representante_id, new.rota_id, new.centro_id, new.codigo_ibge,
        case when new.ativo then new.status else 'inativo' end, new.observacoes
      );
    else
      update public.clientes set
        razao_social = new.razao_social, nome_fantasia = new.nome_fantasia,
        tipo_pessoa = new.tipo_pessoa, cnpj_cpf = new.cnpj_cpf,
        inscricao_estadual = new.inscricao_estadual, email = new.email, telefone = new.telefone,
        logradouro = new.logradouro, numero = new.numero, complemento = new.complemento,
        bairro = new.bairro, cidade = new.cidade, uf = new.uf, cep = new.cep,
        limite_credito = new.limite_credito, condicao_pagamento = new.condicao_pagamento,
        tabela_preco = new.tabela_preco, representante_id = new.representante_id,
        rota_id = coalesce(new.rota_id, rota_id), centro_id = coalesce(new.centro_id, centro_id), codigo_ibge = coalesce(new.codigo_ibge, codigo_ibge),
        status = case when new.ativo then new.status else 'inativo' end,
        observacoes = new.observacoes
      where id = _id;
    end if;
  elsif _id is not null then
    update public.clientes set status = 'inativo' where id = _id;
  end if;

  -- FORNECEDOR
  select id into _id from public.fornecedores where pessoa_id = new.id limit 1;
  if new.is_fornecedor then
    if _id is null then
      insert into public.fornecedores (
        pessoa_id, razao_social, nome_fantasia, cnpj_cpf, email, telefone,
        cidade, uf, condicao_pagamento, ativo
      ) values (
        new.id, new.razao_social, new.nome_fantasia, new.cnpj_cpf, new.email, new.telefone,
        new.cidade, new.uf, new.condicao_pagamento, new.ativo
      );
    else
      update public.fornecedores set
        razao_social = new.razao_social, nome_fantasia = new.nome_fantasia,
        cnpj_cpf = new.cnpj_cpf, email = new.email, telefone = new.telefone,
        cidade = new.cidade, uf = new.uf, condicao_pagamento = new.condicao_pagamento,
        ativo = new.ativo
      where id = _id;
    end if;
  elsif _id is not null then
    update public.fornecedores set ativo = false where id = _id;
  end if;

  -- REPRESENTANTE
  select id into _id from public.representantes where pessoa_id = new.id limit 1;
  if new.is_representante then
    if _id is null then
      insert into public.representantes (
        pessoa_id, profile_id, nome, email, telefone, regiao, comissao_percentual, ativo
      ) values (
        new.id, new.profile_id, new.razao_social, new.email, new.telefone,
        new.regiao, new.comissao_percentual, new.ativo
      );
    else
      update public.representantes set
        profile_id = new.profile_id, nome = new.razao_social, email = new.email,
        telefone = new.telefone, regiao = new.regiao,
        comissao_percentual = new.comissao_percentual, ativo = new.ativo
      where id = _id;
    end if;
  elsif _id is not null then
    update public.representantes set ativo = false where id = _id;
  end if;

  -- TRANSPORTADORA
  select id into _id from public.transportadoras where pessoa_id = new.id limit 1;
  if new.is_transportadora then
    if _id is null then
      insert into public.transportadoras (
        pessoa_id, razao_social, cnpj, email, telefone, cidade, uf, ativo
      ) values (
        new.id, new.razao_social, new.cnpj_cpf, new.email, new.telefone,
        new.cidade, new.uf, new.ativo
      );
    else
      update public.transportadoras set
        razao_social = new.razao_social, cnpj = new.cnpj_cpf, email = new.email,
        telefone = new.telefone, cidade = new.cidade, uf = new.uf, ativo = new.ativo
      where id = _id;
    end if;
  elsif _id is not null then
    update public.transportadoras set ativo = false where id = _id;
  end if;

  return new;
end;
$function$;

-- backfill dos clientes já existentes
update public.clientes c set
  rota_id = coalesce(p.rota_id, c.rota_id),
  centro_id = coalesce(p.centro_id, c.centro_id),
  representante_id = coalesce(p.representante_id, c.representante_id),
  codigo_ibge = coalesce(p.codigo_ibge, c.codigo_ibge)
from public.pessoas p where c.pessoa_id = p.id;
