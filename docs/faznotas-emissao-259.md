# FAZNOTAS — emissão e acompanhamento de NF-e55, fase259

## Instalar

1. Executar integralmente `db/fase259_emissao_faznotas.sql` no Supabase após as fases256,257 e258. A migração é reaplicável e não altera notas históricas nem transmite documentos.
2. Publicar no Lovable. Manter `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY` e `EXT_SUPABASE_SERVICE_ROLE_KEY` configuradas no servidor. Nunca usar a service role como variável pública.
3. Em **Lojas**, conferir CNPJ/IE/endereço/UF, série e regime, token da empresa, teste de conexão e regras tributárias revisadas para os produtos, CFOPs e UFs utilizados.
4. Como administrador, em **Liberação de emissão FAZNOTAS**, informar o ambiente que o provedor confirmou na conta e liberar o envio. Esse campo é uma declaração local; **não troca o ambiente remoto**. A documentação recebida informa uma única URL. Confirmar com o provedor certificado, CNPJ, série, ambiente e liberação de NF-e55.
5. Administradores/gestores operam conforme as permissões existentes. O papel financeiro recebe a nova ação `faturamento_emitir_nfe` na primeira instalação se já tiver acesso ao menu `/notas`. Revogar essa ação depois não é desfeito pela reaplicação da migração. Acesso à loja e restrição de carteira para representantes com papéis combinados continuam sendo verificados.

## Emitir

1. Concluir e conferir a separação do pedido.
2. Em **Faturamento e nota fiscal**, usar **Faturar** para criar a nota pendente, caso ainda não exista. Esse botão continua sendo o processo local de faturamento; ele sozinho não transmite NF-e.
3. Na nota pendente, usar **Conferir e emitir FAZNOTAS**.
4. Confirmar consumidor final, situação da IE e modalidade de transporte. Quando necessário, selecionar um CFOP de operação entre as regras comuns revisadas de todos os itens. Esses valores são guardados no snapshot da emissão; não alteram o cadastro geral do cliente.
5. **Conferir dados para emissão** valida os dados fiscais, dígitos de CPF/CNPJ, CEP/UF/cidade via ViaCEP, regra de CFOP, revisão tributária, itens e totais. Nenhuma nota é transmitida ao conferir.
6. Conferir emitente, ambiente declarado, série, destinatário, CFOP, itens, frete, despesas e total. A requisição preparada pode ser inspecionada na própria janela. Confirmar a revisão e usar o botão de emissão, cujo texto identifica produção ou homologação declarada.
7. O servidor reserva o documento, sincroniza os produtos necessários e transmite a solicitação. Em seguida a tela acompanha o recibo a cada8s enquanto a janela estiver aberta. O servidor também aplica intervalo mínimo5s entre consultas ao provedor.
8. Após confirmação do status004, código100/120/150, chave44 numérica do mesmo CNPJ/modelo55/série e protocolo, registra número, chave, protocolo e os links fornecidos para DANFE/XML. Uma resposta HTTP200 ou um recibo001 não autoriza a nota por conta própria.

A janela pode ser fechada. O snapshot e o recibo permanecem salvos, mas **não existe consulta em segundo plano com a janela fechada nesta fase**. Voltar em **Acompanhar FAZNOTAS** retoma as etapas/consultas. Não há cron fiscal nem webhook inventado nesta entrega.

## Segurança e recuperação

- O número de origem é determinístico: `CPR-NFE-<UUID da nota>`. A reserva é única por nota e por pedido. Não há geração de outro número em tentativas de recuperação.
- Depois da reserva, os dados enviados ficam congelados. Retomadas usam o mesmo payload; não regeneram a emissão com preços/endereço alterados. Produtos recebem referências próprias e imutáveis derivadas do snapshot; não há PUT que altere produtos remotos usados por outra emissão.
- A sincronização acontece em blocos de até dois produtos por etapa. Os produtos confirmados são registrados duravelmente; uma interrupção não obriga reenviar todo o lote. Não é feita atualização destrutiva do cliente: a emissão utiliza o objeto de cliente inline permitido pelo contrato.
- Lease com nonce evita processamento concorrente; expira em90s para permitir retomada após interrupção. Não há transação SQL aberta esperando HTTP. Resultados de uma lease vencida não sobrescrevem a execução atual.
- Timeout/resultado desconhecido não vira autorização nem nova nota. Usar **Recuperar envio original** reutiliza exatamente o número de origem e o snapshot; o status050 devolve o recibo original. Se já houver recibo, a retomada consulta esse recibo e não faz POST de emissão.
- `900` com105/217 permanece em acompanhamento; uma recusa definitiva conserva sua identificação. Não tentar criar outra nota para contornar uma recusa. Se o provedor corrigir um documento com recibo, usar **Atualizar acompanhamento** para consultar o mesmo documento.
- A preparação pode ser descartada se nunca houve tentativa de transmissão e não existe lease ativa. Também é possível corrigir uma recusa interna400 sem recibo quando houve exatamente uma tentativa e nenhuma falha incerta anterior: conforme a documentação,400 não enfileira documentos. O banco decide se o descarte é seguro. Emissão possivelmente aceita nunca é descartada por esse caminho.
- Depois do vínculo, autorização/rejeição/cancelamento manuais do registro são bloqueados. Ações remotas de cancelamento/carta de correção não são implementadas nesta fase; tratar no provedor e consultar o retorno. Notas históricas sem vínculo continuam no fluxo manual existente.
- Uma falha de atualização após autorização não apaga a chave/protocolo nem regride a situação autorizada. O estado logístico do pedido também não regride: pedidos em carga/rota/entregues continuam nessas etapas. Dados comerciais e itens são preservados após a reserva; atualizações logísticas e de comissão continuam permitidas.
- Tokens e a service role permanecem no servidor. RPCs de reserva/claim/persistência são exclusivas de service_role e revalidam o ator, a loja e a carteira. Eventos, snapshots e credenciais não têm leitura direta para anon/authenticated. A prévia expõe somente os dados necessários à conferência fiscal, sem custos/comissões ou segredos.

## Valores e limites desta fase

- Escopo: venda normal nacional de produtos, modelo55, de1 a200 itens, emitente com CNPJ numérico. Destinatário aceita CPF e CNPJ numérico/alfanumérico com verificação de dígitos. Operações de entrada, exportação, devolução, complementares, ajustes, NFC-e e NFS-e não são transmitidas por esse fluxo.
- O contrato recebido expõe CFOP no cabeçalho e não no Item. Pedidos que resultem em múltiplos CFOPs são bloqueados até confirmar o suporte por item com a FAZNOTAS; não se força um CFOP único incorreto.
- CFOP usa UF confirmada pelo CEP, com prioridade das exceções do produto e regra da loja. ICMS exige regra revisada para a UF específica. Não há tributação presumida pelo CEP sozinho. Para não contribuinte em venda interestadual, códigos genéricos6101/6102 não são aplicados automaticamente: selecionar o enquadramento próprio, revisado com o contador.6107/6108 também não são aceitos para destinatário declarado contribuinte.
- Descontos de itens e cabeçalho são representados como desconto unitário, com rateio em centavos e verificação da soma. Valores unitários usam até10 casas decimais; quantidade mantém até3. Não há desconto aplicado duas vezes no cabeçalho.
- Frete manual + por volume vai em `transporte.valor-frete`; outras despesas + acréscimo da forma de pagamento vão em `valor-despesas`. Os totais precisam coincidir com pedido e nota pendente antes do envio.
- Parcelas entram em `faturas` somente se a soma corresponder ao total fiscal. Créditos de devolução podem reduzir o financeiro sem reduzir a mercadoria fiscal: nesses casos as faturas são omitidas com aviso. Títulos/baixas não são recriados nem alterados.
- A FAZNOTAS/SEFAZ apura os impostos. A prévia mostra o valor comercial antes dessa apuração; conferir o total efetivo no DANFE/XML, especialmente IPI/ST. Esta fase não implementa um motor tributário próprio nem reconciliação automática do total retornado com os títulos.
- Produto utiliza os campos do contrato recebido. EAN/CEST permanecem locais porque não constam no schema Produto fornecido; operações que precisem transmiti-los devem ser confirmadas com o provedor antes do uso. Não foram inventadas propriedades para contornar lacunas da documentação.
- XML/DANFE são links HTTPS do retorno autorizado. Não há cópia dos arquivos em storage próprio nem promessa de retenção dos links; podem ser atualizados consultando o mesmo recibo. O ambiente remoto também não é comprovado pela simples seleção local.

## Validação realizada

- Migração reaplicada em PGlite, com reserva única, lease concorrente, intervalo de consulta, retorno001 pendente,900 transitório, chave de outro CNPJ recusada, autorização legítima, autorização preservada em falha posterior, proteção manual e preservação do status de entrega.
- Testes de contrato cobrem rateio de centavos, frete/despesas, totais divergentes, revisão, CPF/CNPJ, referência estável, redaction de token, criação de produto sem PUT destrutivo e divergência remota.
- Navegador com servidor real e provedores simulados percorreu conferência, confirmação explícita, POST, recibo, polling e DANFE/XML. Todos os acessos externos foram interceptados/bloqueados no teste; nenhuma nota real foi emitida.
