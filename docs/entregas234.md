# Entregas unificadas — fase234

Execute integralmente `db/fase234_entregas_unificadas.sql` no SQL Editor do Supabase, depois da fase233. Atualize o sistema com Ctrl+F5.

O fluxo principal permanece **Pedidos → Separação → Cargas de entrega → Entregas**. O menu Expedição foi removido; o endereço antigo `/expedicao` redireciona para `/entregas`. Os romaneios e registros existentes não são apagados.

Na tela Entregas:

- **Entregas:** pedidos nas cargas, aguardando saída, em rota e recebimentos concluídos. Cada pedido permite imprimir pelo modelo compartilhado, abrir **Ocorrências e entregas parciais** e formalizar o recebimento completo com data, recebedor e referência do comprovante.
- **Romaneios e ocorrências:** consulta de romaneios antigos e atuais com filtros de cliente/pedido, rota, situação e previsão; impressão e edição dos dados de transporte. Os comandos duplicados de separação/despacho foram removidos; essas ações acontecem nas respectivas etapas do fluxo principal.
- **Ocorrências e entregas parciais:** histórico, referências de comprovantes e arquivos privados. Para entregas parciais, informe apenas as quantidades da visita, recebedor e anexe PDF/JPG/PNG de até5 MB. Recusas exigem motivo e geram devolução em rascunho, para conferência do retorno em Devoluções. Não geram crédito/reposição automaticamente. A entrega só termina quando o saldo e as recusas estiverem resolvidos.

## Permissões e segurança

O módulo configurável é Entregas. As ações de formalização, registro de ocorrências/comprovantes e entregas parciais/recusas continuam separadas em Usuários e papéis. Transportes e consulta de romaneios exigem a ação de Entregas e a capacidade logística existente. A migração transfere os menus antigos uma única vez; não libera a ação de entregas parciais para quem não a tinha e não restaura revogações ao reaplicar.

As três rotinas movidas verificam acesso ativo, ação de Entregas, capacidade logística, centros do romaneio/pedido e carteira atual no banco, com locks e nova conferência após travar os registros. Representantes com outros papéis continuam restritos à carteira e representação do pedido; admin mantém a exceção existente. O atalho antigo de confirmação completa é bloqueado: o recebimento integral segue pela formalização232, preservando data/comprovante e a proteção contra saldo parcial.

Não há emissão fiscal nem alterações automáticas de estoque, títulos ou status de pedidos na aplicação da migração. Os dados operacionais mudam somente pelas ações do usuário.

## Verificação

- `NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-logistica-pratica-database.cjs --unificadas`: aplica232/233/234 em PostgreSQL/PGlite, verifica migração repetível, catálogo, transferência de menus, revogação de acesso, ocorrências/transporte, centros/carteiras e bloqueio do atalho antigo. Executa o motor real214 para entrega parcial, conclusão do saldo e recusa com devolução pendente, além do fluxo233 de carga/entregas.
- Chromium com dados de teste: redirecionamento antigo, menu único, ocorrência/histórico, envio de comprovante e parcial, edição de transporte na aba de romaneios e celular sem transbordamento horizontal. Nenhum dado de produção foi alterado.
