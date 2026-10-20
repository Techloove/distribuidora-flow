-- Corrige a ambiguidade entre a variável conta e contas_financeiras.conta.
-- Não altera títulos, saldos, movimentos, credenciais ou permissões.
begin;
do $$
declare
  definicao text;
  antigo text := 'select centro_id into conta_centro from public.contas_financeiras where id=conta and ativo;';
  corrigido text := 'select cf.centro_id into conta_centro from public.contas_financeiras cf where cf.id=recebimento_249.conta and cf.ativo;';
begin
  if to_regprocedure('public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)') is null then
    raise exception 'Rotina receber_titulo não encontrada. Confira a fase71 antes da fase249';
  end if;
  select pg_get_functiondef('public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)'::regprocedure)
    into definicao;
  if position(corrigido in definicao)>0 then return; end if;
  if position(antigo in definicao)=0 then
    raise exception 'Consulta da conta de recebimento não reconhecida. Revise a definição de receber_titulo antes de aplicar a fase249';
  end if;
  if position(E'declare\n  titulo public.contas_receber;' in definicao)=0 then
    raise exception 'Bloco de recebimento não reconhecido. Revise receber_titulo antes da fase249';
  end if;
  definicao:=replace(definicao,E'declare\n  titulo public.contas_receber;',E'<<recebimento_249>>\ndeclare\n  titulo public.contas_receber;');
  execute replace(definicao,antigo,corrigido);
end $$;
notify pgrst,'reload schema';
commit;
