# Salvamento SaaS com contrato identificado — fase340

O banco com proteção contra atualizações sem filtro recusava `saas_salvar_grade_335` com `UPDATE requires a WHERE clause`. Embora o contrato tenha uma única linha (`unico=true`, chave primária com restrição), a instrução de atualização não declarava WHERE.

A fase340 acrescenta `where unico=true` às atualizações do contrato em salvar configuração legada, salvar serviço adicional, salvar grade e registrar pagamento. Não desativa a proteção do banco. A autorização do proprietário, os bloqueios/revisões concorrentes, a preservação de parcelas vencidas e o histórico permanecem no corpo original das funções. A instalação aborta se não reconhecer a instrução esperada e pode ser repetida.

O teste isolado `scripts/check-faturas-saas-335.cjs` instala a correção repetidamente, exige filtro explícito nas quatro funções e exercita configuração, parcelas mensais/anuais/parceladas, centavos, prévia sem escrita, histórico, autorização, isolamento do ERP e regularização durante bloqueio.

Aplicada no banco em uso em 06/11/2026. A conferência comparou hashes das linhas de contrato, grade e serviços, além da quantidade de eventos, antes e depois: nenhum dado foi modificado. O resultado técnico está em `auditorias/saas-atualizacao-com-filtro-340.json`. Não foi salvo nem ativado um contrato real para testar. O proprietário deve reenviar a configuração desejada pelo formulário. Uma tentativa recusada reverte a operação inteira, inclusive parcelas daquela tentativa.

Typecheck, build, segurança SQL e ordem das migrações passaram na entrega 1.40.10.
