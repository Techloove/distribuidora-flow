# Forecast Fiscal — fase262: conexão por loja, sem emissão

Atualização: a fase264 exclui definitivamente a integração anterior. Consulte `docs/forecast-fiscal-remocao-264.md`. Este documento registra a entrega da fase262; arquivos `.md` são para leitura, não para executar no SQL Editor.

Continuidade do commit `06a4664` (fase261). Contrato analisado: `swaggerDoc` do `swagger-ui-init.js` fornecido em `fore.txt`, OpenAPI 3.0.0, API versão 2. O JavaScript não foi executado. A documentação pública continuou retornando HTTP403 neste ambiente.

## Contrato e limites encontrados

- A descrição declara `Authorization: Basic base64("<token>:")`, com senha vazia. O esquema `token` é HTTP Basic. Não reutilizar `Token ...` da FAZNOTAS.
- `servers` está vazio. Esta fase usa a origem HTTPS da documentação fornecida: `https://forecastfiscal.com.br`, caminho `/api/v2`. Não aceita URL arbitrária do navegador nem segue redirecionamentos com a credencial.
- `GET /api/v2/empresas/{cnpj}` consulta uma empresa. A resposta está documentada apenas como `object`, sem campos ou envelope. A implementação exige `cnpj` textual no primeiro nível correspondente ao CNPJ solicitado; um HTTP200 genérico, envelope diferente ou CNPJ ausente/divergente falha sem liberar emissão. Confirmar o formato real com o provedor antes de ampliar o parser.
- O ambiente vem do **token**; o campo `ambiente` do documento não pode contradizê-lo. O ambiente salvo nesta fase é uma declaração administrativa, não uma verificação remota. Consultar empresa não comprova ambiente, certificado, série ou autorização de emissão.
- NF-e usa `POST /api/v2/nfe`, referência `ref` (a query prevalece sobre o corpo), emitente `cnpj_emitente`, itens e destinatário. Consulta, XML e PDF usam `GET /api/v2/nfe/{ref}`, `{ref}.xml` e `{ref}.pdf`. Não foram implementados envios nesta fase.
- Há cancelamento por `DELETE /api/v2/nfe/{ref}`, carta de correção, inutilização e hooks. O Swagger não define os corpos de resposta, transições de estado, garantia de idempotência/duplicidade, conteúdo/assinatura de webhook ou expansão de `REF_REGEX`. Vários campos fiscais/valores são apenas `object`; não assumir compatibilidade completa com Focus nem converter regras FAZNOTAS automaticamente.
- O catálogo de produtos e as regras tributárias são endereçados por CNPJ. Endpoints de estoque do provedor **não** substituem o estoque físico compartilhado do ERP.

## O que está implementado

Em Lojas → Provedor fiscal, o administrador autorizado pode configurar e testar a conexão Forecast da loja. Gestores autorizados consultam somente metadados; representantes não ganham acesso à configuração fiscal. As checagens existentes de usuário ativo, papel, rotina e acesso à loja são reutilizadas no banco e no servidor. A service role só carrega a credencial depois da autorização do usuário e da loja.

`forecast_credenciais_262` tem RLS e não concede acesso direto a `anon`/`authenticated`. O token é armazenado no banco com o mesmo modelo de proteção server-side usado nas integrações existentes; não há criptografia adicional da coluna nesta fase. Não retorna em estado, resultado de teste ou auditoria. Pode-se usar o mesmo token em lojas diferentes se o provedor autorizar seus CNPJs, mas cada vínculo local precisa de configuração explícita; não se presume um token exclusivo por empresa.

Troca de CNPJ invalida o vínculo. Token vazio só preserva o existente para o mesmo CNPJ **e** ambiente. Provedor suspenso impede teste e configuração. Salvar não libera emissão. Um teste revalida a configuração após a consulta para não apresentar sucesso para um vínculo que mudou durante a requisição. A consulta não persiste aprovação fiscal.

FAZNOTAS permanece bloqueada para novas emissões, com recibos/documentos anteriores preservados. Não há alterações em pedidos, carteira dos representantes, estoque, tributos ou histórico de notas. Não há sincronização automática de empresas, produtos, certificados ou estoque.

## Aplicação manual

1. Aplicar integralmente `db/fase262_conexao_forecast_fiscal.sql` após a fase261. Reaplicável. Não foi executada no Supabase do cliente.
2. Publicar o código pelo fluxo habitual do projeto.
3. Conferir as variáveis server-side existentes: `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY` e `EXT_SUPABASE_SERVICE_ROLE_KEY`. Nunca usar prefixo `VITE_` para a service role.
4. Na loja, salvar a preferência Forecast para o CNPJ atual. Cadastrar o token no campo específico da Forecast e declarar seu ambiente conforme o painel. Não usar os campos antigos FAZNOTAS nem enviar tokens no chat.
5. Usar “Testar acesso sem emitir nota”. Esse botão faz apenas GET da empresa correspondente. Não cadastra empresa ou transmite documento.

## Validação sem API real

- `bun test`: testes existentes e novos testes de transporte simulado (Basic, GET, CNPJ, respostas incompletas, erros, sigilo e rejeição de entrada inválida).
- `bun run typecheck`, `bun run build` e guards `check:sql`, `check:migrations`, `check:surface`, `check:server`.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-conexao-database.cjs`: PGlite, reaplicação, privilégios, isolamento por loja, usuário/rotina/papel, mudança de CNPJ e ambiente, auditoria sem token, suspensão e preservação do bloqueio/histórico FAZNOTAS.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs`: regressão local da cadeia fiscal e remoção definitiva da integração anterior na fase264.

Não houve emissão real, chamada autenticada ao provedor ou migração no banco remoto. As credenciais Supabase não estavam injetadas neste ambiente; login e operações do banco real não foram validados.

## Próxima fase

Confirmar com o provedor o contrato de resposta da empresa, ambientes/tokens, referência e idempotência, estados/erros e tipos fiscais ambíguos. Preparar payload NF-e e snapshot tributário por loja/produto/UF, com testes simulados, sem liberar emissão até homologação explícita. Manter documentos FAZNOTAS vinculados ao fornecedor original; nunca reenviar uma operação de resultado incerto para o novo fornecedor.
