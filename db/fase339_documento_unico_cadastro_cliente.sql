-- CPF/CNPJ pontuado e sem máscara identificam a mesma pessoa.
-- Não altera documentos nem mescla registros. Duplicidades existentes abortam a instalação.
begin;
create unique index if not exists pessoas_documento_normalizado_339
 on public.pessoas ((upper(regexp_replace(cnpj_cpf,'[^0-9A-Za-z]','','g'))))
 where nullif(upper(regexp_replace(cnpj_cpf,'[^0-9A-Za-z]','','g')),'') is not null;
commit;
