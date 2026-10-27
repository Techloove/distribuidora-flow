# Preço normal sincronizado — fase275 / versão1.3.0

O preço de venda em Produtos e o preço normal no catálogo das lojas passam a representar o mesmo valor. A alteração é salva numa transação no banco: se houver erro, a transação é revertida e a interface exibe o erro. Não é necessário editar o preço uma segunda vez em outra tela.

## Instalação

1. Execute manualmente no Supabase **somente** `db/fase275_preco_produto_sincronizado.sql`, inteiro. Este guia não é SQL. As fases246 e271 devem estar aplicadas.
2. A ativação alinha os preços normais dos catálogos com os valores **atuais do cadastro geral de Produtos**. Não confirma que as alterações relatadas de26/10 foram gravadas: para isso, consulte `db/diagnostico_precos_produtos_lojas.sql` e confira a auditoria.
3. Os valores anteriores dos catálogos ficam guardados em `public.preco_retrato_275`, privado e sem acesso pelo navegador. O alinhamento também gera auditoria. Não execute comandos de restauração de preços sem revisar o histórico posterior.
4. Publique a versão1.3.0 no Lovable. Não há emissão fiscal, alteração de estoque ou reprecificação de vendas nessa instalação.

## Uso

Em Produtos, edite o preço de venda ou o markup e saia do campo para salvar. Aguarde a confirmação antes de continuar; durante a gravação, a edição direta fica bloqueada. No formulário completo, clique Salvar.

Também é possível editar em Lojas → Produtos e preços → Configurar → Preço normal do produto. A alteração atualiza o cadastro geral e os espelhos do catálogo. Desconto máximo e disponibilidade continuam específicos da loja; dados fiscais, categoria, estoque e CNPJ não são modificados.

Promoção continua sendo um preço especial de campanha, preservando sua validade, seus limites e sua loja. Alterar o preço promocional não substitui o preço normal. Itens de pedidos, orçamentos e vendas já registrados mantêm seus valores; novos itens consultam o novo preço normal ou a promoção vigente.

Cada edição continua exigindo as permissões existentes. Uma mudança do preço geral também verifica o acesso à loja da categoria do produto. A rotina do catálogo bloqueia primeiro o produto e depois o catálogo, como a sincronização originada no cadastro geral.

## Validação técnica

Regressão local com PGlite: `node scripts/check-precos-sincronizados-database.cjs` (o pacote `@electric-sql/pglite` deve estar disponível). Cobre alinhamento inicial, cópia privada, alteração nas duas telas, recálculo por markup/custo, consulta do catálogo, opções por loja, permissões, falha de auditoria com rollback e preservação de itens e promoções.
