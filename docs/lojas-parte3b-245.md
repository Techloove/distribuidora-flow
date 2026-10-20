# Lojas — parte 3B: promoções e faixas de peso

Execute o arquivo completo `db/fase245_promocoes_descontos_lojas.sql` no SQL Editor do CaparaoSystem **depois da fase244**. Depois publique a atualização no Lovable.

## Configuração

Em **Lojas → Configurações da loja**, selecione a loja e utilize **Configurar promoções desta loja** ou **Configurar faixas de desconto desta loja**.

Promoções conserva a tela de campanhas e produtos. O seletor **Loja das promoções** define quais campanhas são consultadas e onde uma nova campanha é criada. A seleção de produtos e o cálculo de desconto promocional usam os preços-base da loja. A consulta de ofertas em Produtos também respeita a loja selecionada no filtro geral.

As faixas por peso identificam a loja no cadastro. Uma nova faixa recebe a loja selecionada durante a navegação; se o filtro estiver em todas as lojas, é necessário escolher uma no formulário. Para manter o histórico e evitar mover uma oferta indevidamente, campanhas e faixas existentes não podem ser transferidas: crie a oferta na outra loja.

## Preservação dos dados

Na primeira aplicação, cada loja existente recebe uma cópia independente das campanhas, produtos promocionais e faixas compartilhadas. Depois disso, editar, pausar ou excluir uma configuração de uma loja não modifica a outra. Reaplicar o SQL não duplica configurações nem restaura ofertas excluídas. Novas lojas começam sem campanhas ou faixas ativadas automaticamente.

Os registros globais antigos permanecem arquivados e ocultos das consultas autenticadas. Não há alteração de preço, desconto ou valor em pedidos já gravados, nem de estoque ou financeiro. As RPCs antigas de preço sem identificação de loja conservam somente o acesso ao legado arquivado; a emissão de pedidos e a Agenda Comercial usam a consulta pelo próprio documento, implementada na fase244 e atualizada nesta fase.

## Cálculo e acesso

A consulta de preço vigente usa a loja do pedido ou orçamento, cliente, UF, período e prioridade da campanha. Na ausência de promoção válida, aplica o preço-base da loja. A trava de preço dos representantes e a criação de pedidos pela Agenda Comercial já usam essa mesma consulta.

O cálculo do desconto por peso e o aviso “faltam X kg” usam somente as faixas da loja do documento. A regra de categoria e a escolha do maior desconto elegível continuam iguais. Alterar faixas não recalcula silenciosamente documentos existentes; a aplicação do desconto continua sendo uma ação explícita no pedido.

A ação **Configurar promoções e descontos por peso da loja**, em Usuários e papéis → Lojas, controla as gravações junto do perfil de gestão e do acesso à loja. As políticas existentes de carteira continuam vigentes. Representantes não ganham edição de regras comerciais.

## Validação

- PostgreSQL local/PGlite: cópia inicial única, preços e descontos distintos entre lojas, UF e vigência, RLS e view com permissões do usuário, bloqueio de escrita para representante, intervalos inválidos, transferência recusada, exclusão em cascata e reaplicação sem restauração.
- Navegador com banco simulado: entrada a partir de Lojas, campanhas distintas ao trocar a loja e preenchimento da loja na criação de faixa pela navegação interna.
- TypeScript, 114 testes, lint sem erros, compilação e verificações de segurança e ordem das migrações.

Nenhum SQL foi executado no Supabase de produção nesta entrega.
