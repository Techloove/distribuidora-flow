# Fase260 — Consulta automática de recibos FAZNOTAS

Após publicar esta versão e executar `db/fase260_faznotas_consulta_automatica.sql` no mesmo Supabase das fases256–259, o pg_cron chama o servidor a cada minuto. Não é necessário manter o navegador aberto. A publicação precisa usar o domínio `https://caparaosystem.lovable.app` e ter `EXT_SUPABASE_URL` e `EXT_SUPABASE_SERVICE_ROLE_KEY` no servidor, como na fase259. A migração cria pg_cron e pg_net se necessário; falha na instalação das extensões exige corrigir isso no Supabase antes de considerar o agendamento ativo.

A rotina processa um recibo pendente por execução, ordenado pela próxima consulta. Filas maiores levam mais tempo. Consulta somente notas em `processando` com recibo. Não cria notas, não envia produtos nem repete POST de emissão. Preparações sem recibo e situações incertas continuam exigindo acompanhamento pela tela. Estados autorizada, rejeitada e cancelada saem da consulta automática. Cancelamentos posteriores à autorização não são monitorados nesta fase.

O responsável original precisa continuar ativo, com permissão fiscal, acesso à loja e à carteira correspondente. Se perder acesso, ou a credencial mudar de empresa, a consulta aguarda conferência; não assume outro usuário silenciosamente. A API usa a credencial da mesma empresa da emissão. A reserva da fase259 impede consulta concorrente pelo navegador. A autorização, chave, protocolo e links continuam sendo validados e gravados pela mesma função da fase259. Falha de rede não autoriza nota nem altera contas a receber.

O segredo do agendamento permanece em tabela privada e no transporte HTTPS, nunca em configuração pública. O endpoint aceita apenas POST autenticado. O agendamento pode ser pausado pelo SQL Editor:

```sql
update public.faznotas_auto_config_260 set ativo = false where id;
-- Para reativar: set ativo = true.
```

Diagnóstico sem revelar segredo/token:

```sql
select ativo, ultima_chamada, ultimo_resultado
from public.faznotas_auto_config_260;
select jobname, schedule, active from cron.job
where jobname = 'faznotas-consulta-automatica-260';
select nota_id, estado, recibo, proxima_consulta, lease_ate, updated_at
from public.faznotas_emissoes_259
where estado in ('processando', 'incerta') order by proxima_consulta;
```

`recibo_reservado` indica seleção para consulta, não autorização. Confira o estado da nota e os eventos em `faznotas_eventos_259`. `ultima_chamada` vazia indica que o servidor ainda não autenticou uma chamada; confira publicação, variáveis de ambiente e respostas do pg_net. O primeiro teste deve usar um recibo já existente, sem gerar outra nota. Validação local usa provedor simulado e PostgreSQL PGlite; não executa SQL de produção nem emite NF-e real.
