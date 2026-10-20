# Catálogo automático pela categoria da loja

Execute todo `db/fase246_catalogo_categoria_loja.sql` após a fase245 e publique a atualização no Lovable.

Em **Lojas → Configurações da loja**, selecione uma loja. No bloco **Produtos e preços → Categoria dos produtos da loja**, vincule a categoria já utilizada no cadastro geral de Produtos e clique em **Salvar categoria da loja**. Repita para a outra loja.

A categoria existente nos produtos era identificada como “Categoria Centro Custo”, mas a configuração de loja criada nas fases anteriores ainda não tinha um vínculo com esse cadastro. Esta fase cria o vínculo explícito por ID, sem inferir categorias pelo nome da loja ou alterar a classificação dos produtos.

- Os produtos da categoria selecionada entram automaticamente no catálogo da loja, inclusive produtos novos.
- Alterar a categoria de um produto atualiza seu enquadramento nas lojas sem sincronização manual.
- O vínculo usa o cadastro mestre e sua normalização existente de nomes, espaços e acentos. O mecanismo existente de renomear categorias e propagar o nome aos produtos continua funcionando.
- Preços, descontos e suspensões individuais configurados anteriormente são preservados. A categoria define o conjunto de produtos; a suspensão continua disponível como exceção de venda.
- Produtos fora da categoria não aparecem na seleção de novos itens e são recusados pelo servidor na consulta de preço, inserção/edição e aprovação/confirmação de pedidos em aberto.
- Promoções exibidas também respeitam a categoria da loja.
- O estoque continua compartilhado. Itens e valores já gravados não são alterados; pedidos em aberto com itens fora da categoria precisam ser revisados antes da aprovação.

Inicialmente a loja fica em **Todas as categorias (sem filtro)** para conservar a operação. Selecione uma categoria por loja uma única vez; não é necessário liberar cada produto individualmente. A edição usa a permissão existente **Configurar produtos, preços e descontos da loja**, junto de perfil de gestão e acesso à loja.

## Verificação

O teste PostgreSQL local/PGlite `scripts/check-categoria-lojas-database.cjs` cobre normalização da categoria, inclusão de produtos novos, mudança de categoria, rejeição de itens de outra categoria, preservação de preços e suspensões, autorização, ACLs, estoque e reaplicação. O teste de navegador com banco simulado configura categorias distintas nas duas lojas e verifica a filtragem e persistência da seleção. TypeScript, 114 testes automatizados, compilação, lint e verificações de segurança também foram executados.

Não houve execução do SQL no Supabase de produção.
