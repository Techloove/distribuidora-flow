-- Executar somente por manutenção administrativa, após a fase330.
-- Proprietário indicado expressamente pelo usuário. Não altera papéis do ERP.
begin;
do $$ declare u uuid;quantidade integer;begin
 select count(*),(array_agg(id))[1] into quantidade,u from public.profiles where lower(email)='carlosantoniolucio@gmail.com' and ativo;
 if quantidade<>1 then raise exception 'A conta proprietária deve existir e estar ativa, sem duplicidade';end if;
 insert into public.saas_proprietarios_330(usuario_id) values(u) on conflict do nothing;
end $$;
commit;
