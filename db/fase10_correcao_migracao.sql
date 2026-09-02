-- Correção da migração da Fase 10: desabilita o gatilho de espelhamento
-- durante a cópia dos cadastros existentes para evitar duplicidade de CNPJ,
-- depois reabilita e alinha a sequência de códigos.
-- Rode somente SE a Fase 10 já criou a tabela pessoas e o gatilho
-- trg_sincronizar_pessoa, mas falhou no bloco de migração.

alter table public.pessoas disable trigger trg_sincronizar_pessoa;

-- clientes -> pessoas
do $mig$
declare r record; _pid uuid;
begin
  for r in select * from public.clientes where pessoa_id is null loop
    select id into _pid from public.pessoas
      where cnpj_cpf is not null and cnpj_cpf = r.cnpj_cpf limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, nome_fantasia, tipo_pessoa, cnpj_cpf, inscricao_estadual, email, telefone,
        logradouro, numero, complemento, bairro, cidade, uf, cep,
        is_cliente, limite_credito, condicao_pagamento, tabela_preco, representante_id, status, observacoes
      ) values (
        r.razao_social, r.nome_fantasia, r.tipo_pessoa, r.cnpj_cpf, r.inscricao_estadual, r.email, r.telefone,
        r.logradouro, r.numero, r.complemento, r.bairro, r.cidade, r.uf, r.cep,
        true, r.limite_credito, r.condicao_pagamento, r.tabela_preco, r.representante_id, r.status, r.observacoes
      ) returning id into _pid;
    else
      update public.pessoas set is_cliente = true where id = _pid;
    end if;
    update public.clientes set pessoa_id = _pid where id = r.id;
  end loop;

  for r in select * from public.fornecedores where pessoa_id is null loop
    select id into _pid from public.pessoas
      where cnpj_cpf is not null and cnpj_cpf = r.cnpj_cpf limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, nome_fantasia, cnpj_cpf, email, telefone, cidade, uf,
        is_fornecedor, condicao_pagamento, ativo
      ) values (
        r.razao_social, r.nome_fantasia, r.cnpj_cpf, r.email, r.telefone, r.cidade, r.uf,
        true, r.condicao_pagamento, coalesce(r.ativo, true)
      ) returning id into _pid;
    else
      update public.pessoas set is_fornecedor = true where id = _pid;
    end if;
    update public.fornecedores set pessoa_id = _pid where id = r.id;
  end loop;

  for r in select * from public.representantes where pessoa_id is null loop
    select id into _pid from public.pessoas
      where (r.email is not null and email = r.email) or razao_social = r.nome limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, email, telefone, is_representante, regiao, comissao_percentual, profile_id, ativo
      ) values (
        r.nome, r.email, r.telefone, true, r.regiao, r.comissao_percentual, r.profile_id,
        coalesce(r.ativo, true)
      ) returning id into _pid;
    else
      update public.pessoas set
        is_representante = true, regiao = coalesce(regiao, r.regiao),
        comissao_percentual = greatest(comissao_percentual, coalesce(r.comissao_percentual, 0))
      where id = _pid;
    end if;
    update public.representantes set pessoa_id = _pid where id = r.id;
  end loop;
end $mig$;

alter table public.pessoas enable trigger trg_sincronizar_pessoa;

-- alinha a sequencia com os codigos ja usados
select setval(
  'public.seq_codigo_pessoa',
  greatest(1, coalesce((select max(codigo::bigint) from public.pessoas where codigo ~ '^[0-9]+$'), 0))
);

-- preenche codigos vazios
update public.pessoas set codigo = nextval('public.seq_codigo_pessoa')::text
where codigo is null or codigo = '';
