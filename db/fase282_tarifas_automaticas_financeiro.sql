-- Execute inteiro antes de publicar versão1.7.0.
-- Instala configuração por loja. Só lança após configuração e autorização pelo usuário.
begin;
do $$begin
 if to_regclass('public.sicredi_tarifas_api_280') is null or to_regclass('public.sicredi_tarifas_279') is null then
 raise exception 'Aplique as fases279 e280 antes da fase282';end if;
end $$;
-- Categorias de DRE. Não escolhe conta bancária nem ativa automação na instalação.
insert into public.categorias_financeiras(nome,tipo,grupo_dre,ordem)
select 'Despesas Financeiras','despesa','despesa_financeira',40
where not exists(select 1 from public.categorias_financeiras where nome='Despesas Financeiras' and parent_id is null);
insert into public.categorias_financeiras(nome,tipo,grupo_dre,parent_id,padrao_para,ordem)
select 'Tarifas de emissão de boletos','despesa','despesa_financeira',p.id,'tarifa',20
from public.categorias_financeiras p where p.nome='Despesas Financeiras' and p.parent_id is null and p.grupo_dre='despesa_financeira'
and not exists(select 1 from public.categorias_financeiras c where c.parent_id=p.id and c.nome='Tarifas de emissão de boletos');
create table if not exists public.sicredi_tarifas_config_282(
 centro_id uuid primary key references public.centros(id),conta_id uuid not null references public.contas_financeiras(id),
 categoria_id uuid not null references public.categorias_financeiras(id),inicio date not null,ativo boolean not null default false,
 responsavel uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table if not exists public.sicredi_tarifas_financeiro_282(
 boleto_id uuid not null references public.boletos(id) on delete restrict,data_lancamento date not null,
 centro_id uuid not null references public.centros(id),valor numeric(14,2) not null default 0,
 assinatura text,estado text not null,movimento_id uuid unique references public.movimentos_financeiros(id) on delete restrict,
 valor_lancado numeric(14,2),conta_id uuid references public.contas_financeiras(id),categoria_id uuid references public.categorias_financeiras(id),
 updated_at timestamptz not null default now(),primary key(boleto_id,data_lancamento)
);
alter table public.sicredi_tarifas_config_282 enable row level security;
alter table public.sicredi_tarifas_financeiro_282 enable row level security;
revoke all on public.sicredi_tarifas_config_282,public.sicredi_tarifas_financeiro_282 from public,anon,authenticated,service_role;
grant select on public.sicredi_tarifas_config_282,public.sicredi_tarifas_financeiro_282 to authenticated;
drop policy if exists config_leitura_282 on public.sicredi_tarifas_config_282;
create policy config_leitura_282 on public.sicredi_tarifas_config_282 for select to authenticated using(
 public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
drop policy if exists financeiro_leitura_282 on public.sicredi_tarifas_financeiro_282;
create policy financeiro_leitura_282 on public.sicredi_tarifas_financeiro_282 for select to authenticated using(
 public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)
 and (not public.escopo_representante() or public.documento_na_minha_carteira('boletos',boleto_id)));
-- Processador privado: usa somente valores confirmados do cache da API, nunca valores do navegador.
create or replace function public.sicredi_contabilizar_tarifa_282(_boleto uuid,_dia date) returns text
language plpgsql security definer set search_path=public as $$
declare b public.boletos;s public.sicredi_tarifas_api_280;c public.sicredi_tarifas_config_282;
 f public.sicredi_tarifas_financeiro_282;legado public.sicredi_tarifas_279;m public.movimentos_financeiros;
 total numeric:=0;v_assinatura text;resultado text;old_claims text;old_sub text;old_role text;
begin
 select * into b from public.boletos where id=_boleto for update;
 if b.id is null then return 'boleto_ausente';end if;
 select * into s from public.sicredi_tarifas_api_280 where boleto_id=b.id and data_lancamento=_dia;
 select * into f from public.sicredi_tarifas_financeiro_282 where boleto_id=b.id and data_lancamento=_dia;
 select coalesce(sum((v->>'valor')::numeric),0),md5(coalesce(jsonb_agg(v order by v->>'descricao',(v->>'valor')::numeric)::text,'[]'))
 into total,v_assinatura from jsonb_array_elements(coalesce(s.debitos,'[]'::jsonb)) v where upper(v->>'descricao') ~ '\mTARIFA\M';
 -- Um vínculo já criado nunca é relançado, nem após estorno ou alteração do retorno.
 if f.movimento_id is not null then
  select * into m from public.movimentos_financeiros where id=f.movimento_id;
  resultado:=case when m.status is distinct from 'ativo' then 'estornado'
   when m.valor is distinct from f.valor_lancado or m.conta_id is distinct from f.conta_id or m.categoria_id is distinct from f.categoria_id or m.data is distinct from _dia then 'movimento_divergente'
   when s.boleto_id is null then 'retorno_ausente'
   when f.valor_lancado is distinct from total or f.assinatura is distinct from v_assinatura then 'retorno_divergente'
   else case when exists(select 1 from public.sicredi_tarifas_279 z where z.movimento_id=f.movimento_id) then 'vinculado_manual' else 'lancado' end end;
  update public.sicredi_tarifas_financeiro_282 set estado=resultado,valor=total,updated_at=now() where boleto_id=b.id and data_lancamento=_dia;
  return resultado;
 end if;
 if total<=0 then update public.sicredi_tarifas_financeiro_282 set estado='sem_tarifa',valor=0,updated_at=now() where boleto_id=b.id and data_lancamento=_dia;return 'sem_tarifa';end if;
 insert into public.sicredi_tarifas_financeiro_282(boleto_id,data_lancamento,centro_id,valor,estado)
 values(b.id,_dia,b.centro_id,total,'pendente') on conflict(boleto_id,data_lancamento) do update set valor=excluded.valor,updated_at=now();
 select * into c from public.sicredi_tarifas_config_282 where centro_id=b.centro_id;
 resultado:=case when c.centro_id is null then 'sem_configuracao' when not c.ativo then 'pausado' when _dia<c.inicio then 'fora_periodo' else 'pendente' end;
 if c.centro_id is not null and c.ativo and _dia>=c.inicio then
  resultado:='configuracao_invalida';
  if b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status in('registrado','liquidado','baixado','cancelado')
  and exists(select 1 from public.contas_financeiras where id=c.conta_id and ativo and (centro_id is null or centro_id=b.centro_id))
  and exists(select 1 from public.categorias_financeiras cat left join public.categorias_financeiras pai on pai.id=cat.parent_id
   where cat.id=c.categoria_id and cat.ativo and cat.tipo='despesa' and coalesce(pai.grupo_dre,cat.grupo_dre)='despesa_financeira'
   and (pai.id is null or pai.ativo)) then
   old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);old_role:=current_setting('request.jwt.claim.role',true);
   begin
    perform set_config('request.jwt.claims',jsonb_build_object('sub',c.responsavel,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',c.responsavel::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
    if not coalesce(public.usuario_ativo(),false) or not coalesce(public.can_finance(auth.uid()),false)
    or not coalesce(public.pode_rotina('boletos_tarifa_registrar'),false)
    or not coalesce(public.usuario_pode_acessar_centro(b.centro_id),false)
    or (public.escopo_representante() and not coalesce(public.documento_na_minha_carteira('boletos',b.id),false)) then
     resultado:='responsavel_sem_acesso';
    else
     select * into legado from public.sicredi_tarifas_279 where boleto_id=b.id;
     if legado.boleto_id is not null and not exists(select 1 from public.sicredi_tarifas_financeiro_282 z where z.movimento_id=legado.movimento_id and z.data_lancamento<>_dia) then
      select * into m from public.movimentos_financeiros where id=legado.movimento_id;
      if legado.data_cobranca=_dia and legado.valor=total and m.status='ativo' and m.valor=total and m.tipo='saida' and m.centro_id=b.centro_id
      and m.conta_id=c.conta_id and m.categoria_id=c.categoria_id and m.data=_dia then resultado:='vinculado_manual';
      else resultado:='conferir_manual';end if;
     elsif exists(select 1 from public.movimentos_financeiros x where x.centro_id=b.centro_id and x.conta_id=c.conta_id and x.data=_dia
      and x.tipo='saida' and x.valor=total and x.status='ativo' and not exists(select 1 from public.sicredi_tarifas_financeiro_282 z where z.movimento_id=x.id)
      and not exists(select 1 from public.sicredi_tarifas_279 z where z.movimento_id=x.id)) then resultado:='conferir_preexistente';
     else
      select * into m from public.lancar_movimento(c.conta_id,'saida',total,_dia,c.categoria_id,b.centro_id,
       'Tarifas Sicredi API — nosso número '||coalesce(b.nosso_numero,''),'SICREDI-TARIFA-'||b.id::text||'-'||_dia::text);
      resultado:='lancado';
     end if;
     if resultado in('lancado','vinculado_manual') then
      update public.sicredi_tarifas_financeiro_282 set movimento_id=m.id,valor_lancado=total,assinatura=v_assinatura,
       conta_id=m.conta_id,categoria_id=m.categoria_id where boleto_id=b.id and data_lancamento=_dia;
      insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'tarifa_api_financeiro_282',c.responsavel,
       jsonb_build_object('movimento_id',m.id,'valor',total,'data',_dia,'estado',resultado));
     end if;
    end if;
   exception when others then resultado:='falha_financeira';end;
   perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
  end if;
 end if;
 update public.sicredi_tarifas_financeiro_282 set estado=resultado,updated_at=now() where boleto_id=b.id and data_lancamento=_dia;
 return resultado;
end $$;
revoke all on function public.sicredi_contabilizar_tarifa_282(uuid,date) from public,anon,authenticated,service_role;
create or replace function public.sicredi_tarifa_cache_financeiro_282() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if TG_OP='DELETE' then perform public.sicredi_contabilizar_tarifa_282(old.boleto_id,old.data_lancamento);return old;end if;
 perform public.sicredi_contabilizar_tarifa_282(new.boleto_id,new.data_lancamento);return new;
end $$;
revoke all on function public.sicredi_tarifa_cache_financeiro_282() from public,anon,authenticated,service_role;
drop trigger if exists tarifa_cache_financeiro_282 on public.sicredi_tarifas_api_280;
create trigger tarifa_cache_financeiro_282 after insert or update or delete on public.sicredi_tarifas_api_280
for each row execute function public.sicredi_tarifa_cache_financeiro_282();
create or replace function public.configurar_tarifas_sicredi_282(_centro uuid,_conta uuid,_categoria uuid,_inicio date,_ativo boolean,_confirmado boolean) returns void
language plpgsql security definer set search_path=public as $$declare r record;begin
 if not coalesce(public.usuario_ativo(),false) or not coalesce(public.can_finance(auth.uid()),false)
 or not coalesce(public.pode_rotina('boletos_tarifa_registrar'),false) or not coalesce(public.usuario_pode_acessar_centro(_centro),false)
 or public.escopo_representante() then raise exception 'Sem permissão para configurar automação financeira da loja';end if;
 if _confirmado is distinct from true or _ativo is null or _inicio is null or _inicio>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Confira a data inicial e confirme a autorização';end if;
 if not exists(select 1 from public.contas_financeiras where id=_conta and ativo and (centro_id is null or centro_id=_centro)) then raise exception 'Selecione conta ativa da própria loja ou compartilhada';end if;
 if not exists(select 1 from public.categorias_financeiras cat left join public.categorias_financeiras pai on pai.id=cat.parent_id
  where cat.id=_categoria and cat.ativo and cat.tipo='despesa' and coalesce(pai.grupo_dre,cat.grupo_dre)='despesa_financeira'
  and (pai.id is null or pai.ativo)) then raise exception 'Categoria deve compor Despesas Financeiras no DRE';end if;
 insert into public.sicredi_tarifas_config_282(centro_id,conta_id,categoria_id,inicio,ativo,responsavel)
 values(_centro,_conta,_categoria,_inicio,_ativo,auth.uid()) on conflict(centro_id) do update set conta_id=excluded.conta_id,categoria_id=excluded.categoria_id,
 inicio=excluded.inicio,ativo=excluded.ativo,responsavel=excluded.responsavel,updated_at=now();
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_centro,'tarifas_config_282',auth.uid(),jsonb_build_object('conta',_conta,'categoria',_categoria,'inicio',_inicio,'ativo',_ativo));
 if _ativo then
  for r in select s.boleto_id,s.data_lancamento from public.sicredi_tarifas_api_280 s where s.centro_id=_centro and s.data_lancamento>=_inicio order by s.boleto_id,s.data_lancamento loop
   perform public.sicredi_contabilizar_tarifa_282(r.boleto_id,r.data_lancamento);
  end loop;
 end if;
end $$;
revoke all on function public.configurar_tarifas_sicredi_282(uuid,uuid,uuid,date,boolean,boolean) from public,anon;
grant execute on function public.configurar_tarifas_sicredi_282(uuid,uuid,uuid,date,boolean,boolean) to authenticated;
-- O formulário manual antigo não pode duplicar tarifa já observada pela API.
do $$declare d text;alvo text:='if b.banco is distinct from ''sicredi''';begin
 select pg_get_functiondef('public.registrar_tarifa_sicredi_279(uuid,numeric,date,uuid,text,boolean)'::regprocedure) into d;
 if position('api_guard_282' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Revise o registro manual da fase279 antes da fase282';end if;
  execute replace(d,alvo,$patch$-- api_guard_282
 if exists(select 1 from public.sicredi_tarifas_api_280 where boleto_id=b.id and tarifa_total>0)
 or exists(select 1 from public.sicredi_tarifas_financeiro_282 where boleto_id=b.id and movimento_id is not null) then
 raise exception 'Tarifa já retornada pela API. Use a configuração de contabilização automática';end if;
 if b.banco is distinct from 'sicredi'$patch$);
 end if;
end $$;
notify pgrst,'reload schema';
commit;
