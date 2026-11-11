# Condições de novas emissões Sicoob — fase 351

Base: descrições do modelo Boleto, POST /boletos e GET /boletos/segunda-via fornecidas pelo portal Developers Sicoob em 11/11/2026.

Em Lojas → Sicoob → Produção, as condições são salvas por loja e ambiente. A migração adiciona uma coluna JSON e dois RPCs exclusivos do servidor. Reutiliza a autorização administrativa, o controle de versão e a gravação de credenciais existentes. Alterar condições exige salvar com emissão desativada, testar e habilitar novamente. A instalação não modifica a ativação, as credenciais ou os documentos financeiros existentes.

| Condição | Códigos enviados |
| --- | --- |
| Multa | 0 isento; 1 valor fixo; 2 percentual |
| Juros | 1 valor por dia; 2 taxa mensal; 3 isento |
| Desconto padrão | 0 sem desconto; 1 fixo; 2 percentual, com uma faixa de prazo |
| Protesto | 1 dias corridos; 2 dias úteis; 3 não protestar |
| Negativação | 2 dias úteis; 3 não negativar |
| PDF | 1 A4; 2 A4 três vias; 3 A4 autoenvelopável |
| Pix | 0 padrão do banco; 1 com Pix; 2 sem Pix |

Encargos começam pelo menos um dia após o vencimento. O prazo limite de pagamento, quando informado, deve comportar o início dos encargos. O desconto não pode vencer antes da emissão nem atingir o valor integral do título. Instruções: no máximo cinco linhas de quarenta caracteres. Prazos de protesto e negativação são de 1 a 99 dias; a contagem efetiva é feita pelo banco segundo o código escolhido.

A emissão não envia nossoNumero, preservando a atribuição pelo banco. O seuNumero é gerado na reserva transacional existente. As condições do boleto ficam no pedido persistido antes da chamada bancária; o snapshot guarda o formato para a segunda via, mesmo após mudanças na configuração da loja. A reserva verifica a versão para impedir emissão com condições alteradas em outra sessão. Uma recuperação usa a operação já existente e não gera outro boleto.

Limitações: não implementa descontos por antecipação diária (tipos 3–6), múltiplas faixas de desconto, rateio de créditos, cobrança com outras modalidades, automação de liquidação/tarifas nem webhooks. Não emite, protesta ou negativa boletos apenas por salvar a configuração. Esses serviços dependem da liberação do convênio e da emissão real pelo operador.

Validação: testes unitários de parâmetros e datas; fixture PostgreSQL descartável com cofre simulado, permissões, migração repetível, preservação financeira, versão, snapshot e recuperação; conferência visual em Chromium, desktop e celular. Nenhum boleto real emitido nos testes.

Implantação: aplicar db/fase351_sicoob_condicoes_emissao.sql antes de publicar a versão 1.44.0. A tentativa de instalação automática retornou HTTP 401 (Invalid access token). O usuário confirmou a aplicação manual com sucesso pelo SQL Editor em 11/11/2026; essa confirmação permite prosseguir com a publicação, sem verificação independente pelo acesso indisponível. A primeira emissão e o modelo completo da resposta 200 de GET /boletos ainda precisam ser conferidos em produção.
