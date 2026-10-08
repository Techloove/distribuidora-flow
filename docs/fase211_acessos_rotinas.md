# Fase 211 — acessos às novas rotinas

Execute `db/fase211_acessos_rotinas.sql` no SQL Editor do Supabase, depois das fases 209 e 210. A migração foi validada em PostgreSQL local com PGlite; precisa ser aplicada ao banco do sistema para ativar os controles.

Em **Usuários e papéis → Menus liberados por perfil**, selecione o perfil, marque os menus e ajuste **Ações das novas rotinas**. Clique em **Salvar acesso**. Menus e ações são gravados juntos, com auditoria; falhas de carregamento impedem salvar uma lista incompleta. “Menus padrão” altera apenas a seleção de menus.

Agenda comercial, Agenda de cobrança e Central de pendências passam a ter seleção independente. Na primeira aplicação, os acessos anteriormente herdados de Lead Rota, Contas a receber e Dashboard são copiados. Reaplicar a fase não restaura acessos revogados.

As 16 ações configuráveis abrangem margem e custo do transporte, reposição, acompanhamento comercial e cobrança, registro de entrega, capacidade do veículo, devoluções e trocas, visualização e conferência de ajustes de comissão, leitura/importação/conciliação/desconciliação de extratos e os parâmetros de margem mínima e comissão.

Para usuários comuns, a rotina exige tanto o menu quanto sua ação. O banco valida as operações, além dos controles de interface. Permanecem as exigências do papel operacional e as restrições de centro e carteira: conceder uma ação não transforma um representante em financeiro ou gestor. Usuários com mais de um perfil recebem a união das concessões; retirar de um perfil não revoga uma concessão existente em outro.

Administrador e gestor continuam com acesso total. Somente administrador ativo altera acessos. Auditoria e parâmetros de gestão continuam exigindo os papéis de gestão. As permissões financeiras anteriores são preservadas ao salvar; esta fase acrescenta controles das novas rotinas e não substitui todas as regras das operações financeiras antigas.

A aplicação consulta novamente os acessos a cada 30 segundos. Para conferir imediatamente uma alteração em outra sessão, atualize a página. Não há alteração de sequenciais Sicredi, configurações bancárias, carteiras ou dados comerciais.
