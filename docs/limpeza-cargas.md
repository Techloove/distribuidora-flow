# Excluir cargas e reiniciar numeração

Execute integralmente `db/limpar_cargas_reiniciar_numero1.sql` no SQL Editor do Supabase como proprietário, sem desativar RLS. É uma limpeza pontual de **todas** as cargas existentes, em todos os centros, conforme solicitado. Não é uma migração de instalação automática nem altera a numeração de pedidos, boletos ou romaneios.

O script guarda uma cópia das cargas, vínculos e status anteriores na auditoria, libera os pedidos `em_carga` que ainda aguardam saída para nova montagem (`faturado` ou `nf_emitida`, conforme a nota existente), desvincula os romaneios e apaga as cargas e seus vínculos. Pedidos em rota, parciais, entregues, separações e comprovantes permanecem. Entregas já iniciadas continuam na rotina Entregas, sem vínculo com as cargas apagadas. Não refaz confirmação de venda nem altera estoque, parcelas ou pagamentos.

Usa bloqueios durante a operação e reinício transacional da sequência: após sucesso, a próxima carga criada recebe **1**, sem consumir esse número na consulta de resultado. Dependências adicionais de outras tabelas, ou pedidos ainda marcados `em_carga` mas com evidência de saída/recebimento, abortam a operação para conferência. Não usa `TRUNCATE CASCADE`.

A tabela final deve mostrar `cargas_restantes = 0` e `proximo_numero_carga = 1`. Depois, atualize a tela Cargas com Ctrl+F5. Não reaplique o script depois de criar novas cargas, pois elas também seriam excluídas.

Verificação isolada: `NODE_PATH=/caminho/das/dependencias node scripts/check-limpeza-cargas.cjs`, com PGlite instalado. Testa exclusão e cópia na auditoria, liberação dos pedidos antes da saída, preservação de entregas/financeiro/estoque, bloqueio de dependências e inconsistências, reinício em1 e rollback transacional da sequência. Não houve execução no Supabase de produção.
