# Sicredi — consulta e baixa automáticas

## Ativação

1. Publique esta versão no Lovable.
2. Execute **todo** `db/fase247_sicredi_consulta_automatica.sql` no SQL Editor do projeto CaparaoSystem. As fases224 e237 precisam estar aplicadas.
3. Aguarde o próximo ciclo de cinco minutos e consulte **Financeiro → Boletos → Consulta automática Sicredi**. Confira a última chamada e eventuais pendências.

O SQL cria um job com pg_cron e pg_net, extensões disponíveis no Supabase. Se aparecer erro de extensão/permissão, envie o erro: a transação é desfeita e não deve ser executada parcialmente. A consulta não precisa de um navegador aberto.

O destino configurado é `https://caparaosystem.lovable.app/api/sicredi/sincronizar`. O servidor usa as variáveis seguras de Supabase já exigidas pela emissão Sicredi (`EXT_SUPABASE_URL` e `EXT_SUPABASE_SERVICE_ROLE_KEY`) e lê o convênio existente. Nenhuma chave bancária precisa ser digitada novamente. O segredo do agendamento é gerado e mantido na tabela privada do banco; não o copie para o chat.

## Funcionamento

- Seleciona boletos **registrados, Sicredi, API e produção**, incluindo os já emitidos antes da implantação.
- Consulta a API v2 com `data-movimento: true`, usando o token e o cache persistente da integração existente.
- Verifica cooperativa, posto e beneficiário antes da consulta. Não usa dados de sandbox nem consulta outro convênio como alternativa.
- Só uma resposta bancária de liquidação reconhecida, com dados completos, é encaminhada à rotina financeira existente `sicredi_liquidar_api_224`.
- A rotina existente confere valor, juros, multa, desconto, abatimento, saldo e conta financeira. Sua confirmação e a atualização do resultado automático ocorrem na mesma transação.
- Valores divergentes ou pagamentos parciais exigem conferência. Não há baixa pelo valor nominal apenas porque apareceu uma situação de pagamento.
- Cancelamento/baixa bancária não é contabilizado como recebimento.
- Reservas com prazo, bloqueios por boleto e a idempotência existente impedem receber duas vezes, inclusive quando alguém consulta manualmente durante o lote automático.
- Falhas de rede são tentadas novamente. Itens não iniciados pelo limite de duração são liberados para outro ciclo; reservas interrompidas expiram.

O agendamento ocorre a cada cinco minutos, em lotes de até dez boletos, com limite de duração e fila ordenada. O prazo individual depende do processamento bancário, volume pendente e disponibilidade da API; não significa necessariamente baixa cinco minutos depois de pagar. Falhas sinalizadas aguardam trinta minutos antes de nova tentativa. As consultas individuais continuam disponíveis.

## Responsável e acesso

A rotina precisa de um administrador ativo autorizado para a loja. Seleciona esse responsável no servidor e conserva todas as verificações de acesso da baixa existente. Se não houver responsável elegível, sinaliza a pendência. O recebimento registra auditoria adicional identificando **consulta automática / agendamento**, além da auditoria financeira existente.

Representantes não recebem permissões de baixa, acesso a segredos ou execução dos RPCs internos. O endpoint exige o segredo privado, e as funções de reserva/finalização aceitam somente service_role. A tela disponibiliza apenas estado do agendamento, data da última chamada e quantidade de pendências dentro das lojas autorizadas.

A limpeza administrativa conserva a configuração e o segredo do agendamento, enquanto a fila acompanha os boletos excluídos.

## Acompanhamento pelo SQL Editor

Estas consultas não exibem o segredo nem as credenciais bancárias:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'sicredi-consulta-automatica-247';

select ativo, ultima_chamada
from public.sicredi_auto_config_247;

select b.documento, b.parcela, b.nosso_numero,
       f.ultima_consulta, f.resultado, f.erro
from public.sicredi_auto_fila_247 f
join public.boletos b on b.id = f.boleto_id
order by f.ultima_consulta desc nulls last
limit 50;
```

Para conferir uma pendência, use a consulta individual do boleto; ela conserva as mensagens de validação da integração existente. Corrija o cadastro/convênio ou concilie os valores quando necessário, sem forçar a situação para pago.

## Validação realizada

- 118 testes automatizados passaram, incluindo autenticação do endpoint, situação desconhecida, sandbox, dados incompletos e falhas bancárias/persistência.
- PostgreSQL local/PGlite com a baixa224 e recebimento financeiro reais: liquidação de R$107 com encargos, uma única movimentação, corrida com consulta manual, segredo privado, reaplicação e valor divergente sem baixa. pg_cron/pg_net foram simulados nesse teste, sem chamadas externas.
- Navegador e servidor locais: painel do agendamento, POST sem segredo recusado com401 e GET recusado com405.
- TypeScript, lint (sem erros, nove avisos anteriores), compilação, segurança SQL/cliente/servidor e ordem de migrações.
- Nenhuma emissão ou consulta ao Sicredi de produção foi realizada durante os testes. O SQL ainda precisa ser aplicado no Supabase para ativar o job.
