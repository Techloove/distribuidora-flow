# Distribuidora Flow

PROMPT MESTRE — ERP DE DISTRIBUIDORA, PEDIDOS, VENDAS, FINANCEIRO E LOGÍSTICA

Crie um sistema ERP web completo para uma distribuidora, com arquitetura profissional, modular, segura e preparada para crescimento.

O sistema deverá controlar toda a operação comercial, desde o cadastro de clientes e produtos, criação do pedido pelo representante, aprovação, separação, faturamento, expedição e entrega, até contas a receber, contas a pagar, comissões, compras, estoque e integração bancária.

Utilize uma arquitetura moderna baseada em:

Lovable para frontend

Supabase/PostgreSQL para banco de dados

Supabase Auth para autenticação

Row Level Security (RLS) para segurança

Supabase Edge Functions para integrações externas

Storage para documentos e arquivos

Jobs/cron para processos automáticos

NÃO colocar credenciais, tokens, certificados ou chaves de APIs no frontend.

1. CONCEITO MULTI-CENTRO

O sistema deverá possuir dois Centros de Custo/Unidades Operacionais independentes dentro do mesmo sistema.

Exemplo:

Centro de Custo A

Centro de Custo B

Todos os principais registros deverão possuir relacionamento com centro de custo quando aplicável.

O usuário deverá poder selecionar globalmente:

TODOS

Centro A

Centro B

Quando "TODOS" estiver selecionado, apresentar dados consolidados.

Quando um centro específico estiver selecionado, apresentar somente os dados daquele centro.

Não duplicar clientes e fornecedores desnecessariamente. Um mesmo cliente ou fornecedor poderá estar relacionado a mais de um centro.

Criar controle rigoroso para impedir que informações financeiras e operacionais sejam misturadas incorretamente entre centros.

2. AUTENTICAÇÃO E PERFIS

Criar autenticação segura utilizando Supabase Auth.

Criar perfis:

Administrador

Diretor/Gestor

Gerente Comercial

Vendedor/Representante

Financeiro

Estoque

Compras

Separação

Expedição/Entrega

Consulta

Criar RBAC e RLS.

O vendedor/representante deverá conseguir visualizar e alterar somente os próprios pedidos e os clientes sob sua responsabilidade, conforme permissões.

Administradores e gestores autorizados poderão visualizar os dois centros.

Registrar todas as ações importantes em audit_logs.

3. CADASTRO DE VENDEDORES/REPRESENTANTES

Criar cadastro completo:

nome

CPF/CNPJ

telefone

WhatsApp

e-mail

endereço

status

data de cadastro

centro de custo

tipo de vendedor

meta mensal

observações

Relacionar vendedor com clientes.

Criar painel individual do vendedor contendo:

pedidos

faturamento

clientes

clientes inativos

comissão

metas

desempenho

ticket médio

4. SISTEMA DE COMISSÕES

Implementar sistema flexível de comissão.

Deve permitir:

Comissão padrão do vendedor

Exemplo:

Vendedor João = 3%.

Comissão específica do produto

Produto X = 5%.

Comissão por cliente

Cliente X = comissão diferenciada.

Comissão escalonada

Permitir criar faixas:

Exemplo:

0 até 20.000 = 2%

20.001 até 40.000 = 3%

40.001 até 60.000 = 4%

Acima de 60.000 = 5%

Permitir configurar se a comissão será calculada sobre:

valor bruto

valor líquido

valor após desconto

valor efetivamente recebido

Permitir definir período:

mensal

semanal

por pedido

por faturamento

por recebimento

Criar histórico de regras para que alterações futuras não alterem comissões já calculadas.

5. CADASTRO DE PRODUTOS

Criar cadastro completo de produtos com:

código interno

SKU

código de barras

descrição

categoria

subcategoria

marca

unidade

NCM

CEST

CFOP

peso

dimensões

estoque mínimo

estoque máximo

preço de venda

preço promocional

comissão

margem mínima

centro de custo

ativo/inativo

Criar módulo de custos.

Mostrar:

último custo

custo médio

custo atual

custo de reposição

maior custo

menor custo

Criar histórico de custos:

data

fornecedor

NF

quantidade

custo unitário

custo total

6. MARKUP E MARGEM

Dentro do produto apresentar:

preço de venda

custo

lucro unitário

margem %

markup

margem mínima

Criar alertas:

margem abaixo do mínimo

margem próxima do mínimo

margem saudável

Calcular essas informações também nos pedidos.

7. HISTÓRICO DE VENDAS DO PRODUTO

Criar dentro do cadastro do produto:

quantidade vendida

faturamento

custo

lucro

margem

clientes compradores

vendedores

última venda

média mensal

vendas dos últimos 30 dias

60 dias

90 dias

12 meses

Criar gráficos e filtros.

8. CADASTRO DE CLIENTES

Criar cadastro único de clientes:

PF/PJ

CPF/CNPJ

razão social

nome fantasia

inscrição estadual

telefone

WhatsApp

e-mail

endereço

endereço de cobrança

endereço de entrega

vendedor responsável

limite de crédito

condição de pagamento

tabela de preço

centro de custo

status

Criar histórico completo:

pedidos

produtos comprados

última compra

ticket médio

faturamento acumulado

títulos em aberto

títulos vencidos

vendedor

rota

9. CLIENTES INATIVOS

Criar módulo "Clientes sem comprar".

Filtros:

15 dias

30 dias

45 dias

60 dias

90 dias

120 dias

Mostrar:

cliente

vendedor

última compra

dias sem comprar

média de compras

faturamento histórico

potencial de recuperação

Criar ranking de clientes que precisam ser contatados.

10. ROTAS

Criar cadastro de rotas.

Cada rota poderá possuir:

nome

região

cidade

bairros

dias da semana

motorista

veículo

sequência de entrega

Relacionar clientes às rotas.

Permitir organizar entregas por rota.

11. PEDIDOS

Criar módulo completo de pedidos.

Status:

em digitação

enviado para aprovação

aprovado

recusado

em separação

separado

faturado

em rota

entregue

parcialmente entregue

não entregue

devolvido

cancelado

Pedido deverá possuir:

número

data

cliente

vendedor

centro de custo

tabela de preço

condição de pagamento

forma de pagamento

endereço de entrega

rota

previsão de entrega

desconto

frete

observações

Itens:

produto

código

quantidade

preço

desconto

total

custo

margem

comissão

estoque disponível

12. APROVAÇÃO DO PEDIDO

Antes da aprovação, validar automaticamente:

limite de crédito

títulos vencidos

estoque

margem mínima

desconto máximo

condição de pagamento

vendedor

centro de custo

Se houver problema, bloquear ou enviar para aprovação específica.

Registrar quem aprovou, quando aprovou e eventuais alterações.

13. SEPARAÇÃO

Pedidos aprovados devem entrar na fila de separação.

Criar:

separação por pedido

separação por onda

Mostrar:

pedido

cliente

produto

quantidade solicitada

quantidade separada

estoque

localização

Permitir confirmar a separação.

Registrar divergências.

14. EXPEDIÇÃO E ENTREGA

Após separação, criar processo de expedição.

Criar romaneio contendo:

rota

motorista

veículo

pedidos

volumes

cliente

endereço

Status:

aguardando

separado

expedido

em rota

entregue

parcial

não entregue

devolvido

Registrar eventos da entrega.

15. ESTOQUE

Criar controle de estoque com:

estoque atual

reservado

disponível

mínimo

máximo

estoque em trânsito

Criar movimentações:

entrada

saída

ajuste

devolução

transferência

Nunca alterar estoque diretamente sem gerar movimentação.

Manter histórico completo.

16. COMPRAS

Criar módulo de compras.

Permitir:

solicitação de compra

cotação

pedido de compra

recebimento

entrada de NF

Criar planejamento automático de compras baseado em:

estoque atual

estoque mínimo

estoque máximo

média de venda

venda dos últimos 30 dias

60 dias

90 dias

pedidos pendentes

estoque em trânsito

prazo de fornecedor

Gerar sugestão de quantidade para compra.

17. NOTA FISCAL DE ENTRADA

Criar registro de NF de entrada:

fornecedor

número

série

chave NF-e

data

produtos

quantidades

custos

impostos

frete

descontos

centro de custo

Ao confirmar a entrada:

atualizar estoque

registrar movimentação

recalcular custo médio

atualizar histórico de custos

18. CONTAS A RECEBER

Criar contas a receber integrado aos pedidos/faturamento.

Permitir gerar parcelas automaticamente.

Campos:

cliente

pedido

documento

parcela

vencimento

valor

juros

multa

desconto

centro de custo

status

Status:

aberto

pago

parcialmente pago

vencido

cancelado

Criar dashboard financeiro.

19. CONTAS A PAGAR

Criar contas a pagar para:

fornecedores

compras

despesas

serviços

impostos

outras despesas

Permitir:

parcelas

vencimento

pagamento

juros

multa

desconto

categoria

centro de custo

fornecedor

20. INTEGRAÇÃO COM SICREDI

Criar arquitetura preparada para integração com a API de Cobrança do Sicredi.

A integração deverá ocorrer exclusivamente por backend/Edge Function.

Nunca expor credenciais no frontend.

Criar configuração segura para:

OAuth

API Key

cooperativa

posto

código do beneficiário

Criar módulo de boletos:

emitir boleto

consultar boleto

gerar/armazenar informações do boleto

consultar situação

baixar/cancelar

alterar instruções permitidas

registrar nosso número

acompanhar liquidação

conciliar recebimentos

Criar tabela sicredi_boletos.

Criar tabela sicredi_webhooks.

Criar Edge Functions para comunicação com Sicredi.

Criar tratamento de:

timeout

erro de autenticação

erro de validação

limite de requisições

indisponibilidade

duplicidade

Implementar idempotência para impedir emissão duplicada.

Preparar webhook para atualização automática de liquidações.

21. CONCILIAÇÃO FINANCEIRA

Criar mecanismo para conciliar:

boleto emitido

boleto pago

conta a receber

valor recebido

data de liquidação

Nunca marcar um título como pago somente porque o boleto foi emitido.

Somente atualizar para pago após confirmação da liquidação.

Registrar origem da confirmação.

22. DASHBOARD

Criar dashboard executivo com filtros globais.

Indicadores:

faturamento do dia

faturamento do mês

pedidos

pedidos aprovados

pedidos em separação

pedidos em entrega

contas a receber

contas vencidas

contas a pagar

estoque

produtos abaixo do mínimo

clientes inativos

comissões

margem

markup

Filtro:

TODOS / CENTRO A / CENTRO B

23. DASHBOARD COMERCIAL

Mostrar:

vendas por vendedor

vendas por cliente

vendas por produto

ticket médio

margem

comissão

metas

evolução mensal

clientes novos

clientes inativos

24. DASHBOARD DE ESTOQUE

Mostrar:

estoque total

produtos abaixo do mínimo

produtos sem estoque

produtos parados

giro

custo de estoque

entradas

saídas

produtos mais vendidos

produtos menos vendidos

25. DASHBOARD FINANCEIRO

Mostrar:

contas a receber

contas vencidas

contas a pagar

fluxo de caixa

recebimentos

pagamentos

previsão financeira

boletos emitidos

boletos liquidados

inadimplência

Permitir filtro por centro de custo.

26. RELATÓRIOS

Criar relatórios:

vendas

pedidos

clientes

vendedores

comissões

produtos

margem

markup

estoque

compras

fornecedores

contas a receber

contas a pagar

boletos

inadimplência

clientes inativos

entregas

rotas

centros de custo

Permitir filtros e exportação.

27. AUDITORIA

Criar audit_logs.

Registrar:

usuário

data/hora

ação

tabela

registro

valor anterior

valor novo

IP quando disponível

origem da ação

Registrar especialmente:

alterações de preço

alterações de custo

alterações de comissão

aprovação de pedido

cancelamento

alteração de limite de crédito

emissão de boleto

baixa de boleto

alteração financeira

alteração de estoque

28. NOTIFICAÇÕES

Criar sistema de notificações.

Exemplos:

pedido aguardando aprovação

cliente inadimplente

cliente sem comprar há X dias

estoque abaixo do mínimo

produto com margem baixa

boleto vencido

boleto liquidado

conta a pagar próxima do vencimento

pedido pronto para separação

entrega pendente

29. REGRAS DE SEGURANÇA

Implementar RLS em todas as tabelas necessárias.

Nunca confiar somente na interface para restringir acesso.

O vendedor deve ter acesso apenas aos registros autorizados.

Usuários financeiros não devem conseguir alterar regras comerciais sem permissão.

Usuários de estoque não devem conseguir alterar contas financeiras.

Criar matriz de permissões.

Impedir acesso direto a dados de outro centro de custo quando o usuário não tiver autorização.

30. EXPERIÊNCIA DO USUÁRIO

Criar interface profissional de ERP.

Sidebar com:

Dashboard

Comercial

Clientes

Vendedores

Pedidos

Aprovações

Produtos

Produtos

Categorias

Estoque

Custos

Compras

Fornecedores

Solicitações

Pedidos de compra

NF de entrada

Logística

Separação

Expedição

Rotas

Entregas

Financeiro

Contas a receber

Contas a pagar

Boletos

Conciliação

Fluxo de caixa

Comissões

Relatórios

Configurações

Auditoria

31. REGRAS IMPORTANTES DE DESENVOLVIMENTO

Não criar dados fictícios permanentes.

Não criar tabelas duplicadas sem necessidade.

Não colocar lógica financeira somente no frontend.

Utilizar transações quando operações afetarem múltiplas tabelas.

Criar índices adequados para consultas.

Utilizar paginação em listas grandes.

Evitar consultas N+1.

Preparar o sistema para milhares de clientes, produtos e pedidos.

Não carregar todos os registros de uma tabela de uma única vez.

Criar logs para integrações externas.

Implementar retry seguro para APIs externas.

Implementar idempotência.

Não modificar registros financeiros críticos sem histórico.

Não apagar registros financeiros definitivamente; utilizar cancelamento/estorno quando apropriado.

32. ESTRATÉGIA DE IMPLEMENTAÇÃO

NÃO tente implementar tudo de uma única vez sem validação.

Primeiro crie a arquitetura do banco, autenticação, RLS e estrutura de permissões.

Depois implemente nesta ordem:

FASE 1

autenticação

usuários

perfis

centros de custo

clientes

fornecedores

produtos

FASE 2

vendedores

comissões

pedidos

aprovação

FASE 3

estoque

separação

expedição

rotas

entregas

FASE 4

compras

NF de entrada

custos

custo médio

planejamento de compras

FASE 5

contas a receber

contas a pagar

fluxo de caixa

FASE 6

integração Sicredi

boletos

webhook

conciliação

FASE 7

dashboards

relatórios

auditoria

notificações

Após cada fase, testar o fluxo completo antes de avançar.

Antes de alterar qualquer estrutura existente, analisar dependências e evitar quebrar funcionalidades já implementadas.

Priorizar consistência de dados, segurança, performance e rastreabilidade.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/599ecf78-86fe-4954-a45a-bc95e3e51d2d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
