# Consulta rápida Sicoob — fase363

A redução do intervalo é uma decisão da integração, não uma obrigação bancária de esperar seis horas. Os boletos abertos eram consultados a cada quinze minutos; as seis horas já se aplicavam somente à reconferência dos títulos liquidados. A identificação financeira depende de arquivo LIQUI próprio, que também tinha esperas entre etapas e ciclos.

Após publicar1.52.1, aplicar `db/fase363_sicoob_consulta_rapida.sql` depois da fase362. A instalação preserva ativação, segredos, permissões, conta, categoria, registros financeiros e os jobs existentes. O acesso de gerenciamento Supabase permanece indisponível; a execução é pelo SQL Editor. Não cria cobrança nem chama o banco durante o SQL.

- A fila individual358 mantém o lote pequeno e o cron de cinco minutos, mas reagenda títulos em aberto para cinco minutos em vez de quinze. Os já liquidados continuam a cada seis horas.
- O cron LIQUI359 passa a cada minuto, preservando o estado ativo/pausado existente. Esperas normais pela geração do relatório passam para um minuto; entre ciclos, nova consulta em cinco minutos. Os horários normais são alinhados ao minuto, evitando perder um tick por poucos segundos.
- O disparador só chama o coletor quando há trabalho devido e sem lease ativa. Sem pagamentos pendentes de coleta, não consulta o banco sem necessidade.
- Erros mantêm o backoff progressivo; recusas403 não provocam rajada de chamadas. A instalação antecipa trabalho normal e a resposta exata400/5002 sem registros já diagnosticada, sem interromper reservas ativas ou resetar os demais erros.
- O retorno de vazio continua sem recebimento/arquivo/tarifa; os mesmos títulos sem recebimento permanecem elegíveis para nova solicitação. O status bancário não substitui valor e data efetivos para a baixa.
- A fila do extrato permanece a cada quinze minutos e sua limitação de requisições é independente. A tarifa individual LIQUI continua pelo processador361, a cada cinco minutos, com idempotência e exclusão dos boletos antigos.

A tela lê do status os intervalos instalados; enquanto a fase363 não for aplicada, mostra os valores anteriores. O ciclo tem solicitação, processamento e download; a cadência de um minuto não garante baixa em um minuto. A disponibilidade dos dados no banco, o tamanho da fila e falhas podem ampliar o prazo. Pix e código de barras usam os mesmos validadores de identidade/valores; não se presumem velocidade ou tarifa idênticas.

Validação local: `node scripts/check-sicoob-liqui-359.cjs --rapido` instala a fase duas vezes em PostgreSQL descartável e confere cron/ativação, prazos de cinco minutos/seis horas, espera de um minuto e todo o fluxo financeiro359. Não chama o banco real. O diagnóstico unificado inclui as três emissões atuais para comparar3850 por código de barras e3851 por Pix quando seus dados bancários chegarem; horários dos pagamentos informados pelo usuário são aproximados.
