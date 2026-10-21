-- Parametrização tributária por loja/produto/CFOP, sem transmissão externa.
begin;
do $$begin
 if to_regclass('public.faznotas_credenciais_257') is null then raise exception 'Aplique as fases256 e257 antes da fase258';end if;
end $$;
create table if not exists public.loja_produto_fiscal_258(
 centro_id uuid not null references public.centros(id), produto_id uuid not null references public.produtos(id),
 cfop text not null check(cfop ~ '^[56][0-9]{3}$'), configuracoes jsonb not null default '{}',
 aceita_padrao_ibs_cbs boolean not null default false,revisado_contador boolean not null default false,
 produto_snapshot jsonb not null,loja_snapshot jsonb not null,
 updated_at timestamptz not null default now(),updated_by uuid not null references public.profiles(id),
 primary key(centro_id,produto_id,cfop),check(jsonb_typeof(configuracoes)='object')
);
alter table public.loja_produto_fiscal_258 enable row level security;
revoke all on public.loja_produto_fiscal_258 from public,anon,authenticated;
grant select on public.loja_produto_fiscal_258 to authenticated;
grant all on public.loja_produto_fiscal_258 to service_role;
drop policy if exists leitura_tributos_258 on public.loja_produto_fiscal_258;
create policy leitura_tributos_258 on public.loja_produto_fiscal_258 for select to authenticated using(public.usuario_ativo() and public.can_manage(auth.uid()) and public.pode_rotina('configuracao_rotinas_editar') and public.usuario_pode_acessar_centro(centro_id));
create or replace function public.snapshot_produto_fiscal_258(_produto uuid) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('codigo',p.codigo::text,'descricao',p.descricao,'ncm',p.ncm,'cest',p.cest,'ean',p.ean,'unidade',p.unidade,'origem',p.origem_fiscal,'cfop',p.cfop,'cfop_interestadual',p.cfop_interestadual) from public.produtos p where p.id=_produto;
$$;
revoke all on function public.snapshot_produto_fiscal_258(uuid) from public,anon,authenticated;
create or replace function public.snapshot_loja_fiscal_258(_loja uuid) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('uf',f.uf_emitente,'crt',f.regime,'cfop_interno',f.cfop_interno,'cfop_interestadual',f.cfop_interestadual,'revisado',f.revisado_contador) from public.loja_fiscal_256 f where f.centro_id=_loja;
$$;
revoke all on function public.snapshot_loja_fiscal_258(uuid) from public,anon,authenticated;
-- Lista fechada de campos do contrato v3.10.0. Não aceita propriedades arbitrárias.
create or replace function public.validar_tributos_258(_config jsonb) returns void
language plpgsql immutable set search_path=public as $$
declare bloco record;campo record;estado jsonb;al record;chave text;permitidos text[];valor text;
begin
 if jsonb_typeof(_config) is distinct from 'object' or length(_config::text)>50000 then raise exception 'Configuração tributária inválida ou muito extensa';end if;
 for bloco in select * from jsonb_each(_config) loop
  if bloco.key not in ('icms','ipi','pis-cofins','cbs-ibs') or jsonb_typeof(bloco.value) is distinct from 'object' then raise exception 'Bloco tributário desconhecido ou inválido: %',bloco.key;end if;
  permitidos:=case bloco.key when 'icms' then array['estados'] when 'ipi' then array['ipi-cst','ipi-aliquota'] when 'pis-cofins' then array['pis-cst','pis-aliquota','cofins-cst','cofins-aliquota'] else array['cbs-ibs-cst','classificacao','aliquotas'] end;
  for campo in select * from jsonb_each(bloco.value) loop
   if not campo.key=any(permitidos) then raise exception 'Campo tributário não previsto no contrato: %',campo.key;end if;
   if campo.key='estados' then
    if jsonb_typeof(campo.value) is distinct from 'array' or jsonb_array_length(campo.value)>27 then raise exception 'Lista de UF inválida';end if;
    if exists(select 1 from jsonb_array_elements(campo.value) e group by e->>'estado' having count(*)>1) then raise exception 'UF repetida no ICMS';end if;
    for estado in select value from jsonb_array_elements(campo.value) loop
     if jsonb_typeof(estado) is distinct from 'object' or coalesce(estado->>'estado','') not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') or coalesce(estado->>'icms-cst','') !~ '^[0-9]{2,3}$' then raise exception 'Informe UF e CST/CSOSN válidos para o ICMS';end if;
     for al in select * from jsonb_each(estado) loop
      if al.key not in ('estado','icms-cst','modalidade-base-calculo','aliquotas') then raise exception 'Campo ICMS desconhecido: %',al.key;end if;
      if al.key<>'aliquotas' and jsonb_typeof(al.value) is distinct from 'string' then raise exception 'Informe códigos ICMS como texto';end if;
     end loop;
     if estado?'modalidade-base-calculo' and estado->>'modalidade-base-calculo' not in ('0','1','2','3','4','5') then raise exception 'Modalidade de base de cálculo inválida';end if;
     if estado?'aliquotas' then
      if jsonb_typeof(estado->'aliquotas') is distinct from 'object' then raise exception 'Alíquotas ICMS inválidas';end if;
      for al in select * from jsonb_each(estado->'aliquotas') loop
       if not al.key=any(array['aliquota-icms','aliquota-icms-st','aliquota-icms-desonerado','aliquota-icms-nao-contribuintes','aliquota-mva','aliquota-interna-uf-destino','aliquota-fcp-interno','aliquota-fcp-destino','percentual-icms-st-ret','percentual-credito-icms','percentual-diferimento','percentual-reducao-bc','percentual-reducao-bc-st','codigo-beneficiario']) or jsonb_typeof(al.value) is distinct from 'string' then raise exception 'Campo de alíquota ICMS desconhecido ou inválido: %',al.key;end if;
       valor:=al.value#>>'{}';
       if al.key='codigo-beneficiario' then
        if valor !~ '^[A-Z0-9]{8}$' then raise exception 'cBenef deve conter 8 caracteres';end if;
       elsif valor !~ '^[0-9]{1,4}(\.[0-9]{1,6})?$' then raise exception 'Informe alíquota ICMS decimal, usando ponto';
       elsif valor::numeric>(case when al.key='aliquota-mva' then 1000 else 100 end) then raise exception 'Alíquota ICMS fora do intervalo';end if;
      end loop;
     end if;
    end loop;
   elsif campo.key='aliquotas' then
    if jsonb_typeof(campo.value) is distinct from 'object' then raise exception 'Alíquotas IBS/CBS inválidas';end if;
    for al in select * from jsonb_each(campo.value) loop
     if not al.key=any(array['percentual-cbs','percentual-diferimento-cbs','percentual-devolucao-cbs','percentual-ibs','percentual-diferimento-ibs','percentual-devolucao-ibs']) or jsonb_typeof(al.value) is distinct from 'string' then raise exception 'Campo IBS/CBS desconhecido ou inválido';end if;
     valor:=al.value#>>'{}';
     if valor !~ '^[0-9]{1,4}(\.[0-9]{1,6})?$' then raise exception 'Informe alíquota IBS/CBS decimal, usando ponto';end if;
     if valor::numeric>100 then raise exception 'Alíquota IBS/CBS fora do intervalo';end if;
    end loop;
   else
    if jsonb_typeof(campo.value) is distinct from 'string' then raise exception 'Informe códigos e alíquotas como texto';end if;
    valor:=campo.value#>>'{}';
    if campo.key='classificacao' then
     if valor !~ '^[0-9]{6}$' then raise exception 'Classificação IBS/CBS deve conter 6 dígitos';end if;
    elsif campo.key='cbs-ibs-cst' then
     if valor !~ '^[0-9]{3}$' then raise exception 'CST IBS/CBS deve conter 3 dígitos';end if;
    elsif campo.key like '%-cst' then
     if valor !~ '^[0-9]{2}$' then raise exception 'CST de PIS/COFINS/IPI deve conter 2 dígitos';end if;
    else
     if valor !~ '^[0-9]{1,4}(\.[0-9]{1,6})?$' then raise exception 'Informe percentual decimal, usando ponto';end if;
     if valor::numeric>100 then raise exception 'Percentual fora do intervalo';end if;
    end if;
   end if;
  end loop;
  if bloco.key='icms' and not bloco.value?'estados' then raise exception 'Informe a lista de UF do ICMS';end if;
  if bloco.key='ipi' and not bloco.value?'ipi-cst' then raise exception 'Informe CST do IPI';end if;
  if bloco.key='pis-cofins' and (not bloco.value?'pis-cst' or not bloco.value?'cofins-cst') then raise exception 'Informe CST de PIS e COFINS';end if;
  if bloco.key='cbs-ibs' and (not bloco.value?'cbs-ibs-cst' or not bloco.value?'classificacao' or not bloco.value?'aliquotas') then raise exception 'Informe CST, classificação e alíquotas IBS/CBS';end if;
 end loop;
end $$;
revoke all on function public.validar_tributos_258(jsonb) from public,anon,authenticated;
create or replace function public.salvar_tributacao_produto_258(_loja uuid,_produto uuid,_cfop text,_config jsonb,_revisado boolean,_aceita_padrao boolean,_versao timestamptz default null,_contexto_produto jsonb default null,_contexto_loja jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
declare loja258 jsonb;produto258 jsonb;estado258 jsonb;cfop258 text:=btrim(_cfop);crt258 text;versao258 timestamptz;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem permissão para parametrizar tributos desta loja';end if;
 perform 1 from public.loja_fiscal_256 f join public.centros c on c.id=f.centro_id where f.centro_id=_loja and c.ativo for update of f,c;
 if not found then raise exception 'Configure primeiro a preparação fiscal da loja';end if;
 perform 1 from public.produtos p where p.id=_produto for share;
 if not exists(select 1 from public.loja_produtos l where l.centro_id=_loja and l.produto_id=_produto and l.disponivel) or not public.produto_categoria_loja_246(_loja,_produto) then raise exception 'Produto fora do catálogo disponível da loja';end if;
 if cfop258 is null or cfop258 !~ '^[56][0-9]{3}$' or _revisado is null or _aceita_padrao is null then raise exception 'Informe CFOP de saída e situação da revisão';end if;
 perform pg_advisory_xact_lock(hashtext('tributacao258'),hashtext(_loja::text||_produto::text||cfop258));
 select r.updated_at into versao258 from public.loja_produto_fiscal_258 r where r.centro_id=_loja and r.produto_id=_produto and r.cfop=cfop258;
 if versao258 is distinct from _versao then raise exception 'Esta regra foi alterada por outro usuário. Recarregue a tributação antes de salvar';end if;
 perform public.validar_tributos_258(_config);
 loja258:=public.snapshot_loja_fiscal_258(_loja);produto258:=public.snapshot_produto_fiscal_258(_produto);crt258:=loja258->>'crt';
 for estado258 in select value from jsonb_array_elements(coalesce(_config#>'{icms,estados}','[]'::jsonb)) loop
  if (estado258->>'estado'=loja258->>'uf') is distinct from (left(cfop258,1)='5') then raise exception 'CFOP incompatível com a UF %',estado258->>'estado';end if;
  if crt258 in ('1','4') and estado258->>'icms-cst' not in ('101','102','103','201','202','203','300','400','500','900') then raise exception 'Informe CSOSN compatível com o Simples Nacional';end if;
  if crt258 in ('2','3') and estado258->>'icms-cst' not in ('00','02','10','15','20','30','40','41','50','51','53','60','61','70','90') then raise exception 'Informe CST compatível com o regime normal';end if;
 end loop;
 if _revisado then
  if _contexto_produto is distinct from produto258 or _contexto_loja is distinct from loja258 then raise exception 'Os dados fiscais do produto ou da loja mudaram. Recarregue antes de confirmar a revisão';end if;
  if loja258->>'revisado' is distinct from 'true' then raise exception 'Revise primeiro as regras fiscais da loja com o contador';end if;
  if coalesce(produto258->>'ncm','') !~ '^[0-9]{8}$' or coalesce(produto258->>'origem','') !~ '^[0-8]$' or btrim(coalesce(produto258->>'unidade',''))='' then raise exception 'Complete NCM, origem e unidade do produto antes de revisar';end if;
  if coalesce(produto258->>'cest','')<>'' and produto258->>'cest' !~ '^[0-9]{7}$' then raise exception 'CEST deve conter 7 dígitos';end if;
  if jsonb_array_length(coalesce(_config#>'{icms,estados}','[]'::jsonb))=0 or not _config?'pis-cofins' then raise exception 'Cadastre ICMS por UF e CST de PIS/COFINS antes de revisar';end if;
  if not _config?'cbs-ibs' and not _aceita_padrao then raise exception 'Configure IBS/CBS ou confirme expressamente os padrões do provedor';end if;
  if _config?'cbs-ibs' and (not (_config#>'{cbs-ibs,aliquotas}')?'percentual-cbs' or not (_config#>'{cbs-ibs,aliquotas}')?'percentual-ibs') then raise exception 'Informe alíquotas de CBS e IBS, incluindo zero quando aplicável';end if;
 end if;
 insert into public.loja_produto_fiscal_258(centro_id,produto_id,cfop,configuracoes,aceita_padrao_ibs_cbs,revisado_contador,produto_snapshot,loja_snapshot,updated_by)
 values(_loja,_produto,cfop258,_config,_aceita_padrao,_revisado,produto258,loja258,auth.uid())
 on conflict(centro_id,produto_id,cfop) do update set configuracoes=excluded.configuracoes,aceita_padrao_ibs_cbs=excluded.aceita_padrao_ibs_cbs,revisado_contador=excluded.revisado_contador,produto_snapshot=excluded.produto_snapshot,loja_snapshot=excluded.loja_snapshot,updated_at=clock_timestamp(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('produtos',_produto,'tributacao_loja_configurada',jsonb_build_object('loja',_loja,'cfop',cfop258,'revisado',_revisado),auth.uid());
end $$;
revoke all on function public.salvar_tributacao_produto_258(uuid,uuid,text,jsonb,boolean,boolean,timestamptz,jsonb,jsonb) from public,anon;
grant execute on function public.salvar_tributacao_produto_258(uuid,uuid,text,jsonb,boolean,boolean,timestamptz,jsonb,jsonb) to authenticated;
create or replace function public.listar_tributacao_produto_258(_loja uuid,_produto uuid)
returns table(cfop text,configuracoes jsonb,aceita_padrao_ibs_cbs boolean,revisado_contador boolean,revisao_valida boolean,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à tributação desta loja';end if;
 return query select r.cfop,r.configuracoes,r.aceita_padrao_ibs_cbs,r.revisado_contador,
 r.revisado_contador and r.produto_snapshot=public.snapshot_produto_fiscal_258(_produto) and r.loja_snapshot=public.snapshot_loja_fiscal_258(_loja) and exists(select 1 from public.loja_produtos l where l.centro_id=_loja and l.produto_id=_produto and l.disponivel) and public.produto_categoria_loja_246(_loja,_produto),r.updated_at
 from public.loja_produto_fiscal_258 r where r.centro_id=_loja and r.produto_id=_produto order by r.cfop;
end $$;
revoke all on function public.listar_tributacao_produto_258(uuid,uuid) from public,anon;
grant execute on function public.listar_tributacao_produto_258(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
