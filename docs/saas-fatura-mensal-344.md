# Fatura mensal e quitação integral — fase344

A lista administrativa e a consulta dos responsáveis agrupam os serviços pela competência (`MM/AAAA`). Serviços com vencimentos diferentes no mesmo mês aparecem na mesma fatura, mantendo as datas originais no detalhe e na impressão. A numeração `FAT-AAAAMM` é de apresentação; as chaves das cobranças e seus históricos são preservados.

O proprietário escolhe **Confirmar pagamento**, confere os serviços pendentes e o saldo, informa data e referência do recebimento e confirma a fatura inteira. Pagamentos já confirmados e itens cancelados não entram no saldo. Outras competências permanecem inalteradas. Cancelamento e reabertura de itens continuam disponíveis no detalhe da fatura.

`saas_quitar_fatura_344` exige proprietário ativo, trava a linha do contrato e confere exatamente as chaves e o valor atuais da competência antes de gravar. Uma transação grava um recibo privado e os eventos individuais dos serviços; qualquer falha desfaz tudo. A mesma requisição pode ser repetida sem nova baixa. Uma fatura alterada exige atualização e nova conferência. A RPC permanece disponível para regularização durante bloqueio, sem ampliar as permissões do responsável.

Validação: 327 testes unitários (2.036 verificações), TypeScript, ESLint dos arquivos alterados, build e controles de manual/versão/datas. O teste isolado `node scripts/check-quitacao-fatura-saas-344.cjs` cobre autorização, idempotência, concorrência, centavos, falha após início da escrita sem baixa parcial, reabertura, pagamentos anteriores e exclusão de outros meses. O navegador com dados simulados validou a fatura de R$ 1.392,83 (três serviços), baixa única, preservação do outro mês, detalhe, acesso somente de consulta do master e celular sem overflow da página.

A migração foi aplicada sem registrar pagamentos reais. A auditoria em `auditorias/saas-fatura-mensal-344.json` confirma preservação do contrato, grade, eventos, papéis e proprietários. Recebimentos continuam manuais e separados do financeiro da distribuidora.
