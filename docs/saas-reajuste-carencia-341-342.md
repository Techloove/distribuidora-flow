# Assinatura pré-paga, carência gratuita e reajustes — 1.41.0

## Configuração e cobrança

A assinatura mensal admite carência inicial gratuita em dias corridos. Ao informar 30, o primeiro vencimento é o início do contrato mais 30 dias; o vencimento inicia o ciclo pré-pago seguinte. O servidor calcula a data independentemente do valor enviado pelo navegador. Com carência não configurada, preserva o primeiro vencimento manual anterior. Zero significa início imediato. Setup, domínio, hospedagem e outros serviços conservam os seus próprios vencimentos e valores.

Cada assinatura mensal pode ter um percentual do salário mínimo (23% sugerido na tela) e uma lista de referências com vigência. O valor inicial vale antes do primeiro reajuste. A partir da vigência, o valor é a referência informada pelo proprietário multiplicada pelo percentual, arredondada em centavos. As referências são manuais; o sistema não presume nem busca um salário mínimo oficial futuro.

O último reajuste pode ficar com referência a definir. A partir dessa vigência, as mensalidades não são geradas até o proprietário informar a referência e salvar a revisão. Esse valor indefinido não vira cobrança zero, dívida ou bloqueio. Avisos na prévia, em Minha assinatura, na fatura e no PDF esclarecem os valores ausentes; outros serviços continuam cobrados normalmente. Ao definir a referência, a grade é recomposta até o fim do contrato, preservando as chaves originais dos ciclos.

As faturas/PDF identificam o período de uso pré-pago, calculado pelo próximo vencimento ancorado no primeiro ciclo e limitado ao fim do contrato. Isso evita lacunas em meses curtos/bissextos. Não há rateio automático no último ciclo; o proprietário deve conferir vigência e valores na prévia.

## Integridade e permissões

As migrações341/342 adicionam metadados e rotinas. Não alteram valores, datas, pagamentos nem ativam configurações de contratos existentes. Formulários antigos que omitem os campos novos preservam as opções gravadas. Campos explícitos nulos/vazios podem desativá-las, sujeitos à proteção de histórico. Parcelas vencidas ou com eventos financeiros não são reprecificadas, removidas nem deslocadas. Revisão concorrente, autorização exclusiva do proprietário e filtros de atualização da fase340 permanecem.

O master consulta referências, pendências e períodos nas faturas, sem permissão para configurar valores ou confirmar pagamentos. Helpers internos não possuem execução para authenticated/anon. O controle de inadimplência continua baseado nas cobranças efetivamente geradas, inclusive serviços independentes do período gratuito da mensalidade.

## Verificação

- `scripts/check-faturas-saas-335.cjs`: regressão do contrato, mensal/anual/parcelado, idempotência, histórico, proprietário/master e isolamento do ERP com as fases340–342.
- `scripts/check-reajustes-saas-341.cjs`: referência a definir, múltiplas vigências, persistência, arredondamento, setup em cinco parcelas preservado, ausência de cobrança/bloqueio por valor indefinido, formulários antigos e histórico protegido.
- `scripts/check-carencia-saas-342.cjs`: 30 dias gratuitos, cálculo no servidor, ciclos pré-pagos sem lacunas em mês bissexto, carência zero, setup independente, permissões e recusa de alteração em ciclo com pagamento.
- Suíte geral: 324 testes, 0 falhas, 2015 verificações. Typecheck, build, lint dos arquivos alterados, segurança SQL e ordem de migrações passaram.
- Chromium com fontes simuladas: janeiro/2027, 23%, referência vazia e depois preenchida, payload correto, primeiro vencimento após30 dias, setup preservado, avisos/uso pré-pago no PDF, computador e celular. Referências salariais usadas nos testes são fictícias; nenhum contrato real foi salvo para testar.

Aplicadas as fases341/342 no banco em uso em 06/11/2026. Hashes do contrato, grade e serviços anteriores e contagem de eventos foram comparados antes/depois, sem mudanças de negócio. Metadados e verificações de acesso estão nos arquivos `auditorias/saas-reajuste-salario-341.json` e `auditorias/saas-carencia-pre-pago-342.json`. A opção de reajuste/carência do contrato atual ainda deve ser revisada e confirmada pelo proprietário no formulário.
