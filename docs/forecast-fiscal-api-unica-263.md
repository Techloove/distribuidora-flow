# Fase263 — Forecast Fiscal como única API fiscal

Substituída pela fase264 a pedido do usuário: `db/fase264_remocao_completa_faznotas.sql` exclui definitivamente os objetos antigos e pode ser aplicado diretamente após a fase262. O arquivamento descrito abaixo registra apenas a etapa anterior.

O usuário confirmou que nunca utilizou a FAZNOTAS e solicitou sua remoção. Esta fase retira a integração do aplicativo e deixa apenas a Forecast Fiscal nas configurações por loja/CNPJ.

## Aplicação

1. **No SQL Editor do Supabase**, executar somente o arquivo inteiro `db/fase263_forecast_api_unica.sql`, após a fase262 já aplicada. A migração é reaplicável e não executa chamadas HTTP.
2. Publicar o código atualizado pelo fluxo habitual do projeto.
3. Em Lojas → Provedor fiscal, conferir o CNPJ e configurar a conexão Forecast. A opção “Emissão por API suspensa” continua disponível para desativar o uso da API naquela loja; não representa outro fornecedor.

Este arquivo `.md` é documentação para leitura; **não deve ser executado no SQL Editor**.

## Remoção realizada

- Excluídos os componentes de conexão, liberação, acompanhamento e tributação específicos da FAZNOTAS, seus adaptadores de transporte, montagem de payload e funções de servidor. Não há mais cliente HTTP ou URL do provedor antigo no código executável.
- Removida das configurações a seção de regras específicas do provedor anterior. Os dados fiscais gerais (série, CRT, CFOP, NCM, CEST, EAN e origem) continuam disponíveis em um módulo independente de fornecedor. Regras antigas não são convertidas automaticamente em regras Forecast.
- A tela de notas identifica a Forecast como API fiscal. Caso existam documentos anteriores, ficam disponíveis em uma consulta local de documentos arquivados, com chave, protocolo e links HTTPS já registrados para XML/DANFE. Essa consulta segue os dados autorizados por RLS e a loja selecionada; não consulta, reenvia, cancela nem altera documentos remotos.
- O endereço antigo de agendamento responde HTTP410 sem autenticar ou acessar uma API externa. É apenas uma resposta de integração removida, sem código de sincronização por trás.
- A migração desativa a configuração automática, remove o job cron antigo e revoga acesso às tabelas e RPCs específicas do fornecedor anterior para os papéis da aplicação, inclusive service role. Funções de escrita/transmissão antigas também passam a recusar execução pelo proprietário. O rótulo da permissão de NF-e passa a Forecast sem modificar os papéis ou conceder acesso novo.

## Preservação do banco

As migrações anteriores e suas estruturas não foram apagadas: fazem parte da cadeia de atualização do banco e podem ser referenciadas por proteções fiscais. Eventuais documentos, tokens antigos, registros de auditoria e snapshots ficam arquivados, sem acesso operacional pela integração removida. Nenhum token é copiado para a Forecast. Os triggers que impedem alteração manual de documentos integrados continuam válidos.

Permissões por loja, carteira dos representantes, pedidos, financeiro e estoque físico compartilhado não são alterados. A migração não escolhe outra loja nem muda o vínculo Forecast de um CNPJ já configurado. A emissão Forecast permanece indisponível até sua implementação e homologação; esta retirada não ativa envio de notas.

## Verificação

- `bun test`: testes atuais da aplicação, da conexão Forecast simulada, das validações fiscais gerais e da leitura segura de documentos arquivados. Os testes exclusivos dos adaptadores FAZNOTAS foram removidos junto com os adaptadores; a redução da quantidade de testes corresponde à remoção dessa funcionalidade.
- `bun run typecheck`, `bun run build`, `bun run check:sql`, `bun run check:migrations`, `bun run check:surface`, `bun run check:server`.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs`: aplica as fases256–261 antes das fases262–264. Verifica as migrações e a remoção definitiva na fase264.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-conexao-database.cjs`: mantém a validação da conexão da fase262.

Os testes usam banco PGlite local e transporte simulado. Nenhuma nota real foi emitida e nenhum SQL foi executado no Supabase do cliente.
