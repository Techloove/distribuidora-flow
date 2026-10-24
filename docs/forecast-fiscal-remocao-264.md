# Fase264 — remoção definitiva da FAZNOTAS

O usuário esclareceu que a integração nunca foi usada, nem em tentativa de homologação, e solicitou remover todas as suas estruturas. Esta fase substitui o arquivamento feito na fase263 pela exclusão efetiva dos objetos específicos do fornecedor antigo.

## Executar no Supabase

Executar **apenas** `db/fase264_remocao_completa_faznotas.sql`, inteiro, no SQL Editor. Requer a fase262 já aplicada. Funciona tanto com a fase263 quanto sem ela; não é necessário executar a fase263 antes. Depois publicar o código atualizado.

Este `.md` é documentação para leitura, não SQL.

## Exclusão efetiva

- Tabelas de credenciais, liberações, emissões, eventos, configuração automática e regras tributárias específicas da antiga API, inclusive qualquer configuração/teste que esteja nessas tabelas.
- Funções das fases257–260 e função de bloqueio específica da fase261, com seus triggers.
- Colunas `faznotas_estado`, `faznotas_recibo`, `faznotas_request_id` de `notas_saida`.
- Job cron e referências às tabelas antigas na lista da limpeza administrativa.
- Endereço especial do servidor, interface de documentos arquivados e dependência da coluna antiga na consulta de notas. Não há mais tratamento especial para o endpoint removido.

Não usa `DROP CASCADE`. Se houver uma dependência personalizada não prevista, a transação aborta e desfaz a remoção; a dependência deve ser examinada antes de continuar.

## Preservado

Forecast (credenciais, vínculo por loja/CNPJ e permissões), cadastros fiscais gerais da fase256, produtos/NCM/CFOP/CRT/série, notas de saída com suas chaves/protocolos/XML/DANFE, pedidos, itens, financeiro, carteira de representantes, estoque compartilhado e auditoria geral. Não há alteração automática do estado de notas nem envio à SEFAZ. A emissão Forecast segue dependendo de implementação e homologação.

As migrações anteriores permanecem no histórico versionado porque outros bancos podem já tê-las aplicado e a sequência precisa continuar reproduzível. Após aplicar até a fase264, seus objetos específicos deixam de existir no banco; não são tabelas arquivadas ou integrações desativadas mantidas para uso futuro. Não reaplicar fases antigas depois da fase264.

## Validação local

- `bun test`, `bun run typecheck`, `bun run build` e guards de SQL, migrations e superfícies de segurança.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs`
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs --sem263`

A fixture aplica as migrações históricas em PGlite, inclui dados de teste para provar que a exclusão realmente acontece, verifica remoção do cron, reaplicação e rollback diante de dependência desconhecida. Compara os dados gerais e a configuração Forecast antes/depois, confirma ausência de tabelas/funções/colunas antigas e testa a conexão/configuração fiscal por loja após a limpeza. Não usa API real nem executa SQL no Supabase do cliente.
