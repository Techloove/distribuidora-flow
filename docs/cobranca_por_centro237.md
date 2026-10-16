# Cobrança por centro de custo — fase237

A configuração fica em **Centros → Cobrança por centro de custo**. A emissão em Pedidos e Contas a receber utiliza o centro real do título, conferido novamente no servidor e na reserva do banco. O filtro global de relatórios não escolhe o banco da emissão.

- **Ferragem:** selecionar Sicredi, API, conta financeira ativa de recebimento e ambiente; conferir o convênio preservado, preencher as credenciais faltantes e habilitar novas emissões.
- **Outro centro:** selecionar Sicoob, ainda pendente. Nenhuma chamada ou boleto Sicoob foi implementado: aguarda a definição de API ou CNAB e o respectivo manual/convênio. Não utiliza credenciais, identificação ou arquivo do Sicredi.
- Novos boletos Sicredi utilizam apenas API e cobrança NORMAL. Não ativa boleto híbrido.
- Uma única associação Sicredi é permitida nesta instalação, conforme o escopo Ferragem. Seu convênio e cache de tokens continuam privados, sem duplicar credenciais entre centros. A tabela de roteamento por centro permite integrar outro banco independentemente depois.

## Aplicação e ativação

1. Confirmar que a fase236 foi aplicada e executar `db/fase237_cobranca_por_centro.sql` no SQL Editor do Supabase. A fase224 também é pré-requisito.
2. Atualizar/publicar a versão conectada ao GitHub no Lovable e recarregar a página.
3. Em Centros, selecionar **Ferragem** e banco **Sicredi · API**. A migração não adivinha o centro pelo nome e não habilita emissão automaticamente.
4. Selecionar a conta financeira Sicredi correta: conta compartilhada ou vinculada ao próprio centro. Uma conta exclusiva de outro centro é rejeitada.
5. Conferir cooperativa (4 dígitos), posto (2), beneficiário (5), ambiente e regras de cobrança; preencher a chave do ambiente e habilitar novas emissões. Salvar.
6. Configurar o outro centro como **Sicoob · integração a definir**, sem ativar emissão.
7. Validar um boleto de homologação de um título de Ferragem antes de mudar para produção. O sandbox não movimenta o caixa real. Produção depende da liberação bancária e de credenciais de produção.

A fase pode ser reaplicada sem restabelecer concessões removidas. Somente administrador ativo configura; gestor consulta dentro de seus centros. A ação `centros_cobranca_configurar` integra Usuários e papéis no módulo Centros; mantém a exigência de administrador. Não amplia carteiras ou permissões financeiras de representantes.

## Documentos analisados

- **Cartilha — Portal Desenvolvedor:** apresentação de sete páginas, metadados de abril/2023. Orienta cadastro de conta profissional, criação de aplicações, seleção de APIs de autenticação/cobrança, solicitação das chaves e canais de suporte. Os endereços/telas antigos podem diferir do portal atual.
- **Sem título (1).pdf:** Manual API da Cobrança, **versão4.0, 24/06/2026**. As seções de autenticação, cadastro, impressão, baixa, vencimento e consulta mantêm os contratos utilizados na implementação: OAuth com contexto COBRANCA, chave `x-api-key` própria de cada ambiente, convênio nos cabeçalhos, dados fixos de sandbox e identificação bancária da resposta.
- A chave chamada “Access Token” no portal/cartilha é cadastrada no campo **x-api-key** correspondente; não é o token OAuth temporário da autenticação, obtido/renovado automaticamente pelo servidor. **Client ID não substitui x-api-key.**
- Produção: usuário beneficiário+cooperativa, código de acesso gerado no Internet Banking e chave da aplicação de produção. Homologação: chave própria do sandbox; usuário `123456789`, senha `teste123`, cooperativa6789/posto03/beneficiário12345, automaticamente usados pelo servidor.
- O manual também descreve operações adicionais, inclusive contratos de webhook. Esta remodelagem não instala um receptor público nem habilita automaticamente todos esses serviços. A liquidação continua conferida por consulta autenticada, com valores/data e baixa idempotente; não é um serviço de atualização em tempo real.

## Preservação financeira

Nenhum boleto existente, sequência CNAB, nosso número, credencial ou arquivo é apagado/reiniciado pela migração. A API atribui o nosso número bancário; o ERP preserva seu identificador de emissão e as proteções contra duplicidade/retentativas inconclusivas.

Cada novo ciclo API conserva `boletos.conta_cobranca_id` na reserva. A liquidação usa essa conta mesmo se a configuração do centro ou a conta prevista do título mudar depois. Boletos anteriores sem essa informação conservam o fallback existente (conta prevista no título; em último caso, conta CNAB antiga). Mudanças na identidade de convênios de produção com histórico são bloqueadas; pendências inconclusivas impedem troca de ambiente incompatível.

Desativar um centro bloqueia novas emissões; consulta, PDF e tratamento dos boletos API existentes continuam disponíveis, sujeitos às permissões e à correspondência do convênio/ambiente. Boletos antigos de outros centros não são transferidos para Ferragem. A configuração CNAB fica preservada exclusivamente para consulta/importação dos retornos históricos. Novas remessas e novos boletos CNAB Sicredi são bloqueados no servidor e no banco; o Sicoob não reutiliza este gerador específico do Sicredi.

## Validação

- `NODE_PATH=<dependências de validação> node scripts/check-cobranca-centros-database.cjs`: PostgreSQL/PGlite com schemas/motores reais18/204/208/131/129/71/223/224 e fase237; fixtures de identidade/centros/catálogo e pré-requisito236, sem acesso ao Supabase real.
- Casos: reexecução; preservação de chaves e contadores legados; Sicredi somente no centro autorizado; Sicoob pendente; conta de outro centro recusada; administrador/ativo; identificação e ambiente; snapshot da conta por emissão e baixa idempotente; bloqueio CNAB; RLS e RPCs privadas.
- Testes de funções HTTP usam respostas bancárias simuladas. Não substituem homologação com o Sicredi.
