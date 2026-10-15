# Lead Rota na Agenda Comercial — fase229

O Lead Rota passa a integrar a Agenda Comercial com as áreas de Relacionamento, Clientes sem comprar e Cobrança. O menu lateral independente é removido; `/lead-rota` redireciona para `/agenda-comercial?aba=rotas`.

## Ativação

Execute integralmente `db/fase229_lead_rota_agenda_integrada.sql` no SQL Editor do Supabase, após a fase228. Não desative RLS. A migração bloqueia brevemente as tabelas de contatos/acompanhamentos para fazer a vinculação com consistência; prefira um momento sem registros em andamento. Atualize a aplicação depois da publicação do código.

Os perfis que tinham o menu Lead Rota recebem a ação **Consultar Lead Rota, histórico e funil de contatos** (`lead_rota_operar`) dentro de **Usuários e papéis > Agenda comercial**. As demais ações da agenda continuam independentes. Reaplicar a fase não restaura ações ou menus posteriormente revogados.

## Navegação e recursos

- Os filtros de rota, representante, cidade, busca e centro de custo são compartilhados. Clientes só são carregados no Lead depois de selecionar uma rota. Indicadores e paginação de24 clientes são calculados no banco para todo o filtro, sem o limite silencioso de1000 registros da consulta anterior.
- Foram preservados os cartões, oportunidades, funil, indicadores de compra e conversão, classificação e ordenação do Lead Rota. Os indicadores usam os mesmos clientes filtrados, evitando dividir o total geral da rota por apenas uma página ou carteira.
- **Ver cliente** mostra endereço, telefone/WhatsApp, situação de crédito, compras, produtos frequentes e sugestões baseadas no histórico real. **Histórico** apresenta pedidos e produtos. O histórico detalhado informa quando alcança o limite de200 pedidos/produtos retornados.
- **Novo pedido**, **Repetir último pedido** e **Repetir produtos frequentes** continuam disponíveis. Agora usam os motores atuais `criar_pedido_rascunho` e `adicionar_item_pedido`, em vez de DML direto incompatível com os bloqueios atuais. A repetição usa as quantidades do histórico e os preços atuais aplicáveis ao cliente, sem transportar descontos antigos automaticamente.
- Para criar pedidos, o usuário também precisa do menu Pedidos; a condição de pagamento do cliente deve corresponder a uma única forma ativa. Centro e rota são validados pelo motor atual. O pedido permanece em rascunho; confirmação e aprovação mantêm as validações existentes de estoque, crédito e pagamento.
- **Cobrar cliente**, quando há saldo e permissão de cobrança, abre essa área já filtrada e com o cliente selecionado. Não emite boleto nem baixa títulos automaticamente.
- Nas outras três áreas, selecionar um cliente disponibiliza **Visão completa do cliente** e **Histórico de compras**, reutilizando o mesmo painel e ações do Lead, conforme a permissão `lead_rota_operar`.

## Contatos integrados

Novos contatos do Lead atualizam o funil e criam um acompanhamento ligado pelo campo único `lead_contato_id`. Se houver próxima data, a ação fica aberta; sem próxima data, fica no histórico concluído. O registro comum de acompanhamento comercial também atualiza o funil e mantém o resultado livre na agenda. Uma cobrança permanece financeira/comercialmente separada e não altera o funil de vendas.

Os contatos anteriores que possuem responsável são vinculados uma única vez à agenda: com próxima data ficam abertos; sem próxima data ficam concluídos, preservando datas e autor originais. Contatos antigos sem responsável permanecem no histórico do Lead, sem inventar um responsável. Reaplicar a migração não duplica acompanhamentos. A gravação direta em `lead_contatos`/`lead_situacoes` pelo navegador é revogada para impedir que um contato contorne o vínculo com a agenda; o fluxo usa RPC transacional.

Não reaplique as fases25,211 ou228 depois da229: elas restaurariam rotinas, permissões ou formas de gravação anteriores.

## Carteira e segurança

Toda consulta/ação verifica usuário ativo, ação liberada, carteira atual do cliente e centros permitidos no servidor. Representante sem vínculo recebe carteira vazia. Perfil combinado de representante/gestor continua restrito; administrador é a exceção explícita. Filtros e IDs forjados não permitem consultar histórico, registrar contato ou criar pedido para outra carteira.

Saldos incluem os encargos/descontos registrados nos títulos e respeitam os centros autorizados. A permissão Lead inclui consulta de crédito necessária à venda, mas não concede baixa, conciliação ou acesso geral ao financeiro. Consultas de produtos usam o estoque global compartilhado já existente.

## Verificação

```sh
NODE_PATH=/caminho/das/dependencias node scripts/check-lead-agenda-database.cjs
bun test
bun run typecheck
bun run lint
bun run build
bun run check:sql
bun run check:migrations
bun run check:surface
bun run check:server
```

PostgreSQL isolado: representantes A/B, gestor combinado, administrador, sem vínculo, centros, encargos reais, filtros e paginação, contatos ligados sem duplicação, funil, cobrança sem interferência no funil, migração reaplicada, bloqueio de DML direto e criação/repetição pelos motores81 com preços atuais. Revogar Lead ou o menu Pedidos bloqueia a respectiva operação.

Chromium com dados simulados: redirecionamento antigo, quatro áreas no menu único, escolha da rota, filtros compartilhados, painel e histórico reutilizados, registro de contato, abertura da cobrança com cliente selecionado, repetição de pedido, carteira de representante e tela de390px sem rolagem horizontal. As verificações não consultaram nem alteraram o banco de produção.
