# Manual do usuário — Caparaó System

Versão 1.12.0 · 2026-10-28

Este manual orienta o uso; não concede acesso aos módulos. Consulte a versão atual em Ajuda → Manual do usuário no sistema.

## Primeiros passos e escolha da loja

Entenda o menu, o perfil de acesso e a loja selecionada.

1. Entre com seu e-mail e senha. Após a aprovação, use a mesma senha definida no primeiro cadastro. No primeiro acesso, conclua o cadastro solicitado antes de operar.
2. Para trocar sua senha, use Alterar minha senha no menu e informe a senha atual e a nova senha duas vezes. Você pode trocar novamente sempre que precisar; não há um limite total de trocas, mas o serviço pode limitar muitas tentativas em pouco tempo.
3. Se esqueceu sua senha, preencha o e-mail na tela de entrada e clique Esqueci minha senha. Abra o link recebido no e-mail, defina uma nova senha e entre novamente. O link expira e deve ser solicitado novamente se já foi usado. Redefinir a senha não aprova um cadastro pendente.
4. Escolha a loja no seletor no topo da tela. Confira a loja antes de lançar pedidos, movimentações ou documentos.
5. Use Buscar módulo no menu para encontrar uma tela pelo nome. No celular, abra o menu pelo botão no topo.
6. Nas listas de pedidos, boletos, contas, históricos e relatórios, clique nos nomes de clientes e nas referências sublinhadas para abrir o cadastro, pedido ou título relacionado. Os atalhos aparecem conforme seu acesso ao módulo.
7. No pedido, use Contas a receber deste pedido e Boletos deste pedido. Nas listas abertas por um vínculo, use Ver todos para sair dessa seleção. A loja selecionada e as permissões continuam valendo.
8. Abra Manual do usuário para tirar dúvidas. O número da versão aparece no menu e no início deste manual.
9. Quando aparecer Nova versão disponível, salve o que estiver preenchendo e clique Atualizar agora. Confirme o recarregamento para carregar a versão publicada.
10. Ao entrar no sistema, a versão é conferida antes de abrir as telas de trabalho. Se houver uma versão mais nova, a página é atualizada automaticamente. Se você já estiver trabalhando, aparece o aviso para atualizar quando estiver pronto.

Cuidados:

- Cada perfil vê somente os módulos liberados. A ausência de um menu deve ser tratada com o administrador; o manual não concede acesso.
- Representantes continuam restritos à própria carteira. Selecionar outra loja não libera clientes ou operações fora da sua permissão.
- Todas as lojas é uma visão de consulta quando disponível. Para movimentar estoque, escolha uma loja específica.
- O aviso pode ser recolhido em Depois; ele continua disponível no canto da tela. A consulta é feita enquanto a página está aberta e com conexão. O manifesto de versão deve ser publicado sem cache no provedor de hospedagem, inclusive na Vercel, para que a consulta reconheça as atualizações.

## Clientes, fornecedores e outros cadastros

Cadastre pessoas e mantenha os dados comerciais e de entrega organizados.

1. Abra Cadastro Unificado e procure pelo nome ou documento antes de criar um registro novo.
2. Informe o tipo de cadastro e os dados exigidos: nome, CPF/CNPJ, endereço e contatos.
3. Para clientes, confira representante, rota e endereço de entrega. Essas informações ajudam a organizar a carteira e as entregas.
4. Mantenha categorias, marcas, cidades e rotas nos módulos correspondentes.
5. No Cadastro Unificado, a janela ampliada é dividida em CPF / CNPJ, Dados gerais, Contato e endereço, Dados fiscais, Cliente, Representante, Histórico e Observações. Os campos preenchidos permanecem ao mudar de seção; clique Salvar para gravar.
6. Marque as funções em Dados gerais para habilitar os campos de Cliente e Representante. Na seção Histórico, use a paginação dos pedidos e dos títulos financeiros.

Cuidados:

- Evite duplicar cadastros. Revise o documento e a busca antes de salvar.
- A mudança de responsável comercial deve respeitar a gestão de carteiras; não compartilhe credenciais para acessar outro representante.

## Lojas, categorias e produtos

Entenda como a categoria liga os produtos ao estoque da loja.

1. Em Lojas, confira nome, CNPJ e a categoria dos produtos da loja. Cada loja ativa usa uma categoria exclusiva para o estoque.
2. Em Produtos, cadastre descrição, código, unidade, categoria e os demais dados exigidos.
3. A categoria do produto deve corresponder à categoria configurada para sua loja. Após a fase271, o saldo fica no depósito principal dessa loja.
4. Altere o preço normal em Produtos ou em Lojas → Produtos e preços. Após salvar, o mesmo preço é sincronizado nas duas telas e usado em novos itens de pedidos. Promoções podem aplicar um preço especial; descontos e disponibilidade continuam por loja.
5. Você pode renomear a loja sem perder o vínculo do depósito, que usa o identificador do cadastro.
6. Ao editar um produto, use as seções Dados gerais, Preços e estoque, Dados fiscais e Histórico. Os campos preenchidos permanecem ao trocar de seção; clique Salvar para gravar. O histórico tem botões Anterior e Próxima.

Cuidados:

- Produto com saldo ou reserva não deve ser reclassificado para outra loja por edição da categoria. Solicite a conciliação ao administrador.
- Estoque total do produto no cadastro não representa uma nova quantidade a somar aos depósitos. Consulte o saldo da loja em Estoque.
- Dados fiscais e CNPJ precisam ser conferidos pelo responsável da empresa.
- Alterar o preço normal não reescreve itens de pedidos ou vendas já gravados. Revise os itens de pedidos em digitação pelo fluxo comercial quando precisar atualizar uma proposta.

## Promoções, descontos e formas de pagamento

Configure condições comerciais e confira sua aplicação no pedido.

1. Em Promoção, escolha a campanha e edite os produtos, preços e período de validade na mesma área de trabalho.
2. Confira loja, vigência e condições da campanha antes de ativar.
3. Cadastre as formas de pagamento e suas condições de parcelamento no módulo correspondente.
4. Ao montar o pedido, confira o preço aplicado, descontos, parcelas e total antes de confirmar.

Cuidados:

- Uma promoção precisa estar vigente e atender às condições do pedido para ser aplicada.
- Descontos, margem, crédito e disponibilidade podem exigir aprovação. Não contorne um bloqueio alterando dados do cliente ou da loja.

## Criar pedido ou orçamento

Da escolha do cliente à confirmação da venda.

1. Escolha a loja e abra Pedidos. Procure um pedido existente ou crie um novo.
2. Selecione o cliente, a forma de pagamento e os dados de entrega. Confira representante e rota.
3. Inclua os produtos da loja e informe as quantidades. Confira preço, descontos, frete e total.
4. Se estiver preparando um orçamento, use as ações da proposta e registre o aceite antes de convertê-la em pedido.
5. Envie para aprovação quando necessário e use Confirmar pedido para concluir a venda comercial.
6. Acompanhe os próximos passos nos menus Separação, Cargas de entrega e Entregas.
7. No final do pedido em digitação, preencha Observações do pedido e clique Salvar observações antes de imprimir. É possível escrever várias linhas, até 4000 caracteres.
8. A impressão mostra a razão social e o nome fantasia do cliente, além das observações salvas ao final do documento.

Cuidados:

- Confirmar pedido pode baixar estoque e gerar contas a receber e comissão prevista. Aguarde o resultado e confira o pedido antes de repetir a ação.
- Orçamento não é uma venda confirmada. Não gere movimentação manual para simular sua confirmação.
- Os produtos e suas reservas pertencem à loja do pedido. A venda não usa o estoque de outra loja.
- Após conferência/faturamento, a edição de itens pode estar bloqueada. Trate alterações pelo fluxo apropriado.
- Se a consulta da margem falhar, use Tentar consultar margem novamente. A falha na consulta não impede visualizar os demais dados do pedido.

## Regularizar o status de um pedido antigo

Uso exclusivo do administrador para etapas que já ocorreram fora do sistema.

1. Como administrador, abra um pedido a partir da etapa Em separação e clique Regularizar status.
2. Escolha uma etapa posterior. Para pedido já entregue, pode escolher diretamente Entregue.
3. Informe a data em que a etapa ocorreu e um motivo com pelo menos 10 caracteres, por exemplo: Pedido já entregue ao cliente.
4. Marque a confirmação de que os registros foram conferidos e confirme o avanço. O usuário, a data e o motivo ficam registrados.

Cuidados:

- A regularização não cria nota fiscal, cobrança, comissão, baixa de estoque, carga ou comprovante de entrega.
- Romaneios e cargas existentes precisam ser conferidos separadamente. Mudar o pedido para Entregue não encerra esses registros automaticamente.
- Não é permitido retroceder etapas, marcar nota fiscal emitida manualmente ou usar a ferramenta para resolver entrega parcial/recusa.
- Se o botão estiver desabilitado, confira etapa, data, tamanho do motivo e a caixa de confirmação.

## Entrada, saída e ajuste de estoque

Movimente somente o depósito da loja escolhida.

1. Escolha a loja no topo da tela e abra Estoque → Movimentar.
2. Selecione Entrada, Saída ou Ajuste e busque o produto pelo nome ou código.
3. Confira saldo físico, reservado e disponível. Informe a quantidade positiva.
4. No ajuste, escolha Acrescentar ou Retirar. Informe a diferença a corrigir, não o saldo final desejado.
5. Se necessário, abra os campos opcionais para informar custo da entrada e observação.
6. Registre a movimentação e aguarde a confirmação. Consulte o resultado em Consultar saldos ou Histórico.

Cuidados:

- Uma venda já confirmada faz a baixa pelo próprio fluxo. Não lance uma segunda saída manual para o mesmo pedido.
- Saldo físico é a quantidade registrada; reservado é o que está comprometido; disponível é físico menos reservado.
- Após a fase271, cada loja consome apenas o próprio saldo. Produto de outra categoria/loja é rejeitado.
- Quantidade insuficiente ou mercadoria reservada pode bloquear a saída. Estoque negativo só é permitido quando essa política estiver expressamente habilitada para o produto.

## Depósito e contagem de inventário

Confira as quantidades físicas sem misturar os depósitos das lojas.

1. Selecione a loja e abra Estoque → Depósitos e inventário. O depósito principal é vinculado automaticamente.
2. Escolha Contar estoque e abra um inventário ou selecione uma contagem em andamento.
3. Conte os produtos no local e salve a quantidade contada de cada item. Use as páginas da lista quando necessário.
4. Use Contar outro produto para incluir um produto da mesma loja que precise ser contado fora da lista.
5. O responsável pela conferência deve revisar todos os itens e usar Conferir e aplicar diferenças.
6. Para informar rua ou prateleira, use Localização dos produtos.

Cuidados:

- A conferência aplica diferenças reais ao estoque e respeita as reservas.
- Se o saldo mudou durante a contagem, abra um novo inventário. Não force uma contagem desatualizada.
- Na migração da fase271, contagens abertas foram canceladas com histórico preservado. Reabra a contagem no depósito da loja.
- Transferências entre lojas não são feitas pela antiga transferência de depósitos; exigem um procedimento próprio de conciliação.

## Planejamento e registro de compras

Planeje a reposição e acompanhe a entrada das mercadorias.

1. Consulte o planejamento de reposição da loja e confira estoque, pendências de venda e compras em trânsito.
2. Registre a compra com fornecedor, loja, produtos, quantidades e condições de pagamento.
3. Confira os dados antes de confirmar o documento e siga a ação indicada pela tela.
4. Após a operação, confira o histórico de estoque e os títulos financeiros gerados pelo fluxo.

Cuidados:

- Sugestão de reposição é uma orientação; confira necessidade, prazo e quantidades antes de comprar.
- Não registre uma entrada manual adicional se a compra já gerou a entrada correspondente.

## Separar e conferir pedidos

Prepare a mercadoria antes da montagem da carga.

1. Escolha a loja e abra Separação. Localize os pedidos liberados para preparação.
2. Inicie a separação e confira os produtos e quantidades do pedido.
3. Registre o que foi separado e trate as divergências conforme as opções disponíveis.
4. Conclua a separação e a conferência. Os pedidos liberados seguem para a montagem da carga.

Cuidados:

- Não conclua uma conferência com quantidade divergente sem registrar o tratamento.
- Imprima ou confira o pedido antes de carregar. A preparação logística não substitui o documento fiscal.

## Montar carga, sair em rota e confirmar entrega

Organize o transporte e formalize o recebimento do cliente.

1. Em Cargas de entrega, crie a carga e informe rota, motorista, veículo e os dados exigidos.
2. Inclua pedidos liberados da operação correspondente e confira capacidade, peso e documentos.
3. Feche e despache a carga pela ação indicada na tela, informando a data de saída.
4. Em Entregas, localize o pedido em rota e registre data, recebedor e o comprovante exigido.
5. Se houver entrega parcial ou recusa, registre a ocorrência e trate o saldo/devolução antes de concluir.
6. Confira que pedidos e carga chegaram à situação final esperada.

Cuidados:

- Não use a regularização de status para inventar um comprovante de entrega.
- Uma carga só pode ser concluída quando as entregas e pendências exigidas estiverem resolvidas.
- Documentos e clientes continuam sujeitos às permissões de loja e carteira.

## Devoluções, recusas e créditos

Trate o retorno da mercadoria e seus efeitos financeiros pelo fluxo correto.

1. Localize o pedido de origem e registre os produtos, quantidades e motivo da devolução.
2. Confira a loja e o vínculo com a entrega ou ocorrência correspondente.
3. Siga a conferência e confirmação previstas pela tela, verificando o retorno físico e os valores.
4. Confira os créditos gerados e sua utilização na conciliação de créditos, quando aplicável.

Cuidados:

- Não faça entrada manual nem desconto financeiro duplicado para uma devolução já tratada pelo fluxo.
- Comissões e créditos dependem do tratamento da devolução e dos recebimentos existentes. Confira os registros antes de repetir operações.

## Receber, pagar, caixa e conciliação

Acompanhe títulos, registre baixas e confira o caixa da loja.

1. Escolha a loja e consulte Contas a receber ou Contas a pagar.
2. Localize o título e confira cliente/fornecedor, vencimento, valor e o que já foi pago.
3. Para registrar uma baixa, informe os dados exigidos, incluindo conta, valor e data, e confira o resultado.
4. Acompanhe saldos em Caixa e bancos e concilie os movimentos com os documentos existentes.
5. Use Dashboard financeiro, Fluxo de caixa, DRE e relatórios para acompanhar resultados e pendências.
6. Registre os custos de rota no módulo correspondente para acompanhar a operação.

Cuidados:

- Pedido entregue não significa título recebido. A baixa financeira precisa representar o pagamento real.
- Evite registrar o mesmo recebimento manualmente se ele já entrou por conciliação ou integração.
- Saldo bancário, caixa e resultado gerencial têm finalidades diferentes. Confira período e filtros antes de comparar relatórios.

## Boletos e notas fiscais

Entenda os cuidados com documentos bancários e fiscais.

1. Para boletos, localize o título elegível e confira loja, cliente, valor, vencimento e a configuração bancária correspondente.
2. Use as ações de emissão, consulta e conciliação disponíveis no módulo e confira o resultado antes de repetir.
3. Na lista de Boletos, filtre pelo cliente e por períodos de emissão, vencimento ou liquidação. Os filtros podem ser combinados; um período de liquidação exclui boletos ainda sem data de pagamento.
4. Cada linha mostra emissão, vencimento, liquidação, valor emitido, valor recebido e tarifas confirmadas. Abra Opções para consultar o Sicredi, copiar a linha digitável e acessar as demais ações daquele boleto.
5. A lista começa pelo primeiro vencimento, em ordem crescente de cima para baixo, inclusive ao limpar os filtros. Em Ordenar por, escolha outra ordem de emissão ou vencimento se necessário. A ordenação respeita os filtros e mantém datas ausentes no final.
6. Para solicitar baixa no Sicredi, abra Opções e use Cancelar boleto, à direita, em um boleto API registrado. Na pergunta “Deseja realmente cancelar este boleto?”, confira cliente, nosso número e valor. Use Voltar para desistir ou Sim, solicitar cancelamento para enviar a solicitação, sem digitar senha. A linha fica como Cancelamento solicitado até a consulta bancária confirmar a baixa.
7. Para notas, confira o pedido, o CNPJ da loja e os dados fiscais com o responsável da empresa.
8. A integração Forecast Fiscal disponível nesta versão está em homologação. A emissão em produção permanece bloqueada.
9. XML e DANFE de homologação ficam identificados como sem valor fiscal e separados da nota operacional.
10. Em Boletos, use Liquidação e tarifa nos boletos API Sicredi liquidados para conferir o valor do boleto, juros, multa, descontos, abatimentos e total recebido retornados pelo banco.
11. Quando a tarifa já chegou pela API, valor, data e descrição aparecem preenchidos em Liquidação e tarifa ou Tarifas e financeiro. Escolha a conta financeira e a categoria de Despesas Financeiras da loja. A categoria sugerida é Tarifas de emissão de boletos.
12. As tarifas retornadas pelo Sicredi aparecem automaticamente na lista com a origem API Sicredi. Em Opções, confira a data do lançamento, a descrição e o valor dos débitos. A atualização ocorre pelo agendamento, mesmo com o sistema fechado; o histórico inicial é preenchido aos poucos.
13. Para ativar a contabilização, confira a data inicial, a conta e a categoria, marque a autorização e use Salvar e contabilizar tarifas da loja. Isso processa os retornos já recebidos desde a data escolhida e habilita o lançamento das próximas tarifas identificadas. Cada tarifa mostra seu resultado e a conta/categoria vinculadas.
14. Na linha do boleto, use Reimprimir boleto para abrir o PDF original do Sicredi e imprimir ou baixar apenas aquele documento. A reimpressão não gera uma nova cobrança. O cancelamento fica separado, dentro de Opções, à direita, e exige confirmação.

Cuidados:

- Não use documentos de homologação como nota fiscal ou cobrança real.
- Um botão de consulta não confirma, sozinho, que houve autorização fiscal ou liquidação bancária. Confira o estado retornado.
- A integração fiscal ainda precisa de validação dos retornos reais e dos cenários fiscais antes da liberação de produção.
- Credenciais bancárias e fiscais devem ser configuradas por responsáveis autorizados, sem compartilhamento por chat.
- CONSULTA_FALHOU na automação não confirma pagamento. O diagnóstico técnico da fase277 distingue obtenção do token e consulta do boleto, com tipo de falha e HTTP quando disponível. O responsável deve conferir a próxima tentativa; não force baixa ou reemissão para eliminar o alerta.
- Após publicar uma correção da consulta automática, aguarde a próxima tentativa agendada. Os alertas são atualizados pela consulta; não reemita boletos ou force recebimentos para remover mensagens antigas.
- A tarifa não reduz a dívida do cliente: é uma despesa bancária separada. O sistema não presume tarifa fixa de R$1,63 nem deduz tarifa pela diferença entre o valor emitido e recebido. No registro manual de despesa, uma tarifa de cobrança é vinculada por boleto; tarifas já lançadas por outra rotina devem ser conferidas para evitar duplicidade.
- A consulta de movimentações financeiras (Francesinha) traz débitos por boleto. A lista soma como tarifa apenas os débitos cuja descrição identifica TARIFA; os demais aparecem como débitos a conferir. Sem retorno confirmado ou em caso de falha de acesso, não é exibida tarifa zero como se houvesse isenção.
- A contabilização automática só começa depois de configurar e autorizar a loja. Ela gera saídas na conta escolhida, em Despesas Financeiras no DRE, sem reduzir o valor recebido do cliente. A instalação da fase282 não cria despesas. Confira os lançamentos anteriores antes de ativar o período retroativo.
- O agendamento consulta uma data a cada 15 minutos e preenche até 90 dias anteriores. Datas dos últimos sete dias são reconsultadas a cada seis horas; as demais, semanalmente. Uma falha mantém o resultado anterior e permite nova tentativa. A lista mostra a última consulta e os dias com pendência ou falha.
- Cancelar boleto envia um pedido de baixa ao Sicredi; não cancela a venda nem quita a conta a receber. Boletos liquidados, já baixados ou com solicitação pendente não permitem novo cancelamento. Se o banco ainda não confirmar a baixa, consulte a situação e confira com o Sicredi antes de qualquer nova cobrança.
- Reconsultar a API não duplica despesas. Tarifas manuais conhecidas com data, valor, conta e categoria correspondentes podem ser vinculadas sem novo lançamento. Uma saída avulsa semelhante, divergência no retorno, conta/categoria inativa, responsável sem acesso ou estorno exige conferência. Não há correção ou relançamento automático de movimentos estornados.
- A configuração vale por loja e apenas para as datas a partir do início escolhido. Alterar a conta ou categoria não move despesas já lançadas. As tarifas de emissão podem ser contabilizadas antes do pagamento do boleto; outros débitos sem identificação de TARIFA não são lançados automaticamente.

## Agenda, metas, comissões e relatórios

Acompanhe clientes, atividades e resultados da carteira.

1. Na Agenda comercial, organize visitas, contatos e acompanhamento dos clientes da sua carteira.
2. Consulte metas e compare o período selecionado com os resultados apresentados.
3. Em Comissões, confira a situação dos valores e os recebimentos/devoluções que influenciam sua apuração.
4. Use Relatórios de Vendas para analisar os resultados com os filtros corretos.
5. Acompanhe Central de pendências e Notificações para identificar as próximas ações.

Cuidados:

- Representantes consultam sua própria carteira, conforme as permissões atribuídas.
- Comissão prevista, liberada e paga representam situações diferentes. Não trate uma previsão como pagamento realizado.
- Confira filtros de loja, período e situação do pedido antes de comparar totais.

## Usuários, auditoria e backup

Administre os acessos e acompanhe as cópias de segurança.

1. Em Usuários e papéis, o administrador atribui perfis, módulos, lojas e rotinas conforme a responsabilidade de cada pessoa.
2. Use Auditoria para conferir operações e alterações registradas, respeitando o acesso concedido.
3. Em Manutenção do sistema → Backup dos dados, o administrador pode solicitar uma cópia e acompanhar o histórico.
4. Aguarde o resultado Cópia externa verificada. Aguardando executor indica apenas uma solicitação na fila.
5. O responsável técnico pode executar o ensaio isolado de restauração de um backup. O relatório confere o conteúdo recuperado sem alterar a produção; login e integrações externas precisam de validação separada.
6. Consulte o número da versão no menu e informe-o ao pedir suporte.
7. Em Manutenção do sistema, consulte Diagnóstico de integridade para conferir estoque por loja, reservas, preços e vínculos financeiros. O diagnóstico respeita as lojas autorizadas.

Cuidados:

- Em Manutenção do sistema → Backup dos dados, use Fazer backup manual. Aguarde a geração e a disponibilização e clique Salvar no computador no histórico. Em navegadores compatíveis, escolha a pasta e o nome; nos demais, confira as configurações e a conclusão dos downloads do navegador.
- Na automação GitHub configurada, a cópia diária é solicitada às 03h07 de Brasília e a fila manual é verificada aproximadamente a cada hora. Aguarde o histórico confirmar a conclusão; horários podem variar pelo agendador.
- O backup manual e o agendamento diário dependem de executor e armazenamento externo configurados. O download também exige a atualização fase283 e a publicação privada habilitada no executor. A presença do botão não significa que o backup está ativo.
- A próxima execução inclui os novos schemas, tabelas, funções e buckets de dados da aplicação automaticamente, além do código versionado no host executor. Backups antigos não são atualizados retroativamente e cópias anteriores não são incluídas novamente no pacote.
- O pacote é criptografado. Guarde a chave de recuperação separadamente; sem ela o arquivo não pode ser recuperado. Configurações do provedor, funções remotas fora do repositório, segredos e infraestrutura exigem guarda separada. A restauração deve ser testada em ambiente isolado.
- Restauração deve ser testada em ambiente separado pelo responsável técnico; não há restauração destrutiva pelo manual.
- Limpar dados do sistema é uma ação destrutiva. Ela não faz parte de gerar backup ou de atualizar a versão.
- Nunca compartilhe sua senha ou inclua tokens e chaves em capturas de tela.
- Após a fase276, Operação identifica situações informativas, como inventários abertos ou estoque negativo permitido. Atenção e Revisar exigem análise; a consulta não corrige dados e uma contagem zero não certifica todas as rotinas.

## Dúvidas frequentes e pedido de suporte

O que conferir quando uma opção não aparece ou uma ação fica bloqueada.

1. Menu ausente: confira o perfil e solicite ao administrador a revisão do acesso ao módulo e à loja.
2. Botão desabilitado: confira os campos obrigatórios, a loja, a quantidade/data e as confirmações exigidas. Na regularização do pedido, o motivo precisa ter 10 caracteres ou mais.
3. Produto ausente na loja: confira categoria do produto, categoria configurada para a loja e disponibilidade no catálogo.
4. Saldo insuficiente: confira o saldo disponível da loja e as reservas. Não use a mercadoria de outra loja para contornar o bloqueio.
5. Mensagem pedindo uma fase do banco: encaminhe o texto ao administrador. Somente o arquivo SQL indicado deve ser executado no Supabase; guias com títulos e textos explicativos não são SQL.
6. Ao pedir suporte, informe versão, tela, loja, número do pedido/documento e o texto do erro. Não envie senha, token ou chave de integração.

Cuidados:

- Antes de repetir uma operação após erro ou demora, confira se ela já foi registrada no histórico.
- Se a tela publicada estiver antiga, o responsável deve conferir a sincronização com o GitHub e a publicação no Lovable.
