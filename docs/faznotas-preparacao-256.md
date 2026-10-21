# Preparação fiscal FAZNOTAS — fase256

Documento analisado: `api-1.json`, OpenAPI3, Myse/FAZNOTAS v3.10.0. Escopo desta entrega: preparação cadastral de NF-e de saída (modelo55), por loja, e conferência de CFOP. Não transmite notas nem substitui o processo manual atual de faturamento.

## Aplicação

1. Executar integralmente `db/fase256_preparacao_faznotas.sql` no Supabase do CaparaóSystem. Requer a estrutura existente de lojas, catálogo e permissões (inclusive fase246). Pode ser reaplicado sem sobrescrever configurações.
2. Publicar a versão sincronizada no Lovable.
3. Em **Lojas → Configurações da loja → NF-e · Preparação FAZNOTAS**, cadastrar série, UF real do emitente, CRT e CFOPs de venda revisados pelo contador. Não há CFOP nem origem fiscal preenchidos automaticamente.
4. Em Produtos, completar NCM8, CEST7 quando aplicável, unidade, origem0–8 e GTIN/EAN quando existente. CFOP interno e interestadual específicos prevalecem sobre a regra geral da loja. CEST não está descrito como propriedade do Produto na documentação recebida: ele fica preparado localmente; não enviar propriedade inventada à API.
5. Conferir as pendências do catálogo na mesma tela da loja. Produtos históricos não são bloqueados para venda nem têm classificação alterada pela migração.
6. A conferência de CFOP consulta ViaCEP e exige consistência entre a UF retornada e a UF do cadastro do cliente. Se o serviço estiver indisponível, não adivinhar a UF pelo prefixo do CEP. É uma prévia para venda normal; ainda não preenche os documentos de faturamento automaticamente.

## Critérios fiscais

CEP identifica localização; não define sozinho a natureza da operação. As famílias5xxx e6xxx correspondem respectivamente a saída interna e interestadual. Exemplos5102/6102 só servem quando a operação efetivamente for revenda compatível com esses códigos. Produção própria, ST, bonificação, devolução, remessa e exportação exigem suas regras. Um produto com ST pode usar CFOP próprio. Não converter qualquer CFOP apenas trocando o primeiro dígito.

Antes da emissão real, revisar com o contador: CRT e CNPJ/IE/endereço do emitente de cada loja; NCM, origem, CEST/ST; CST/CSOSN por UF; bases/alíquotas de ICMS/ST/FCP e DIFAL; IPI, PIS/COFINS e IBS/CBS quando aplicáveis. O schema permite `configuracoes-fiscais` por CFOP e ICMS por estado, além de IPI, PIS/COFINS e CBS/IBS. Esses blocos tributários ainda não possuem editor nem sincronização nesta fase. NCM com8 dígitos não comprova existência/classificação correta.

Destinatário precisa CPF ou CNPJ (a API aceita CNPJ alfanumérico), nome/razão social, tipo de inscrição estadual1/2/9 e IE coerente, consumidor final0/1 e endereço com CEP, rua, número, bairro, cidade e UF. A revisão básica dos produtos não atesta que os clientes estejam fiscalmente completos.

## Contrato da próxima integração de emissão

- Única URL documentada: `https://api.mysebr.com.br/nfemyse-v3/rest`. Não foi documentada URL separada de homologação; confirmar ambiente e credenciais com a FAZNOTAS antes de transmitir.
- `Authorization: Token <token_da_empresa>`; token específico da empresa, mantido somente no servidor. Não usar anon key, token Sicredi ou gravar token em produtos/loja_parametros. Esta fase não pede, armazena nem envia credenciais.
- Cadastrar/sincronizar clientes em `/clientes` e produtos em `/produtos`, incluindo os blocos fiscais aprovados. `Item.produto` referencia produto previamente cadastrado.
- `POST /nfe/emissao`: série, cliente e itens obrigatórios; `numero-origem` estável e único por documento local para idempotência; tipoS e finalidadeN para venda normal. Item usa strings decimais para quantidade e valor-unitario, além de desconto-unitario quando aplicável.
- Conciliar totais, descontos, transporte/frete e despesas antes de enviar. Não adicionar campos sem suporte no schema. Pedidos com vários CFOPs e regras fiscais precisam validar o comportamento do provedor: o contrato mostra um CFOP no cabeçalho e não um CFOP por Item.
- Persistir recibo, número de origem, request_id, resposta e trilha fiscal antes de liberar reenvio; consultar `GET /nfe/nota/{recibo}` respeitando intervalo mínimo5s. Não abrir transação SQL enquanto aguarda HTTP.
- HTTP200 não significa autorização. Status001/002/003 aguardam;050 exige consultar o recibo original;900 com SEFAZ105/217 continua aguardando;400 é recusa;999 é falha interna. Status004 com código100/120/150 confirma autorização. Resposta usa `data.recibo` e `data.sefaz` (não campos na raiz). O módulo `src/lib/faznotas.ts` trata essa classificação de forma conservadora.
- Persistir chave44, protocolo, número/série, XML e DANFE após confirmação. Cancelamento e carta de correção têm recibos próprios e não podem ser simulados alterando só status local.
- Somente usuários autorizados, lojas liberadas e pedidos elegíveis podem emitir; mudanças remotas não devem passar pela autorização manual como se fossem confirmações da SEFAZ.

Não há chamada externa de emissão nesta entrega. A conexão autenticada, editor tributário, prévia por documento, fila de envio/consulta, DANFE/XML e eventos fiscais constituem a etapa de integração operacional, ainda necessária para emitir pela FAZNOTAS.

## Verificação

`bun test tests/faznotas.test.ts` verifica CFOP interno/interestadual, exceções por produto, divergência de endereço, revisão fiscal, GTIN e retornos assíncronos. `NODE_PATH=/tmp/validacao-unificacao/node_modules node scripts/check-faznotas-database.cjs` executa a migração duas vezes no PGlite e verifica validação, atualização e isolamento de permissões. Nenhum teste transmite NF-e real.
