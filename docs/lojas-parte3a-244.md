# Lojas — parte 3A: catálogo e preços

Execute **todo** `db/fase244_catalogo_precos_lojas.sql` no SQL Editor do projeto CaparaoSystem, depois da fase243. Depois publique a atualização no Lovable.

## Uso

1. Abra **Lojas → Configurações da loja** e selecione a loja.
2. Em **Produtos e preços**, pesquise pelo código ou descrição e clique em **Configurar**.
3. Defina disponibilidade, preço-base (até quatro casas decimais) e, opcionalmente, desconto máximo do item. Vazio mantém apenas o limite geral da loja. Quando houver dois limites, o mais restritivo prevalece na validação.
4. Salve e selecione a outra loja para conferir seus valores independentes.

O catálogo inicial de cada loja recebe os produtos e preços de referência atuais. Reaplicar a migração não sobrescreve personalizações. Novos produtos são inicialmente disponibilizados nas lojas, e novas lojas recebem o catálogo de referência; ajuste a disponibilidade conforme a operação.

O cadastro geral de Produtos continua sendo único para descrição, código, custos e estoque físico. O campo de preço nesse cadastro passa a se chamar **Preço de referência** e inicializa novas entradas de catálogo. Alterá-lo não propaga preços para lojas já configuradas.

## Pedidos e orçamentos

O seletor usa somente os produtos disponíveis na loja do documento. A consulta de preço recebe o pedido e obtém a loja e o cliente no servidor, verificando carteira e acesso à loja. Falha de consulta não permite inserir silenciosamente um preço de outra loja. Respostas antigas de preço são descartadas ao mudar de documento, loja ou produto.

A trava dos representantes conserva sua autorização atual de alterar preços, mas passa a usar o preço efetivo da loja. Atualizar a quantidade preserva preços com quatro casas decimais. A criação de pedidos pela Agenda Comercial também consulta o preço do novo documento.

Produtos indisponíveis são recusados na inserção/edição dos itens e na aprovação/confirmação dos pedidos em aberto, inclusive via RPC. Desconto percentual do item acima do teto local exige a aprovação comercial existente. Esse teto não representa uma nova regra para descontos gerais do pedido.

Itens e valores históricos não são reprecificados. A indisponibilidade não altera vendas já confirmadas, financeiro ou estoque. O saldo físico continua compartilhado entre as lojas.

## Permissões e próxima entrega

A ação **Configurar produtos, preços e descontos da loja** está vinculada a **Lojas** em Usuários e papéis. A gravação exige também perfil de gestão e acesso à loja; representantes consultam o catálogo permitido e não podem configurá-lo.

**Promoções e faixas de desconto por peso continuam compartilhadas nesta fase.** Campanhas vigentes conservam sua prioridade sobre o preço-base. Sua configuração e cálculo por loja serão tratados na parte 3B, preservando a tela de campanhas e produtos de Promoções.

## Validação

- TypeScript, compilação de produção e 114 testes automatizados passaram.
- Lint sem erros (nove avisos anteriores); verificações SQL, cliente, servidor e ordem das migrações passaram.
- `scripts/check-catalogo-lojas-database.cjs`: PostgreSQL local/PGlite com validador201, trava48 e RPCs81 reais; preços independentes, teto por produto, disponibilidade, carteira, RLS, rejeição de valores inválidos, precisão, estoque preservado, promoções existentes e reaplicação.
- Navegador com banco simulado: configurar preço 25,1234, desconto 3% e indisponibilidade na loja A; conferir que B permanece com preço 100 e disponível; retornar a A e verificar persistência.

Não houve execução de SQL no Supabase de produção nesta entrega.
