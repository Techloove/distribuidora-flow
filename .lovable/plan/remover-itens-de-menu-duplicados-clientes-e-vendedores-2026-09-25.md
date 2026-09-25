# Remover itens de menu duplicados (Clientes e Vendedores)

## Objetivo
O menu lateral mostra "Clientes" e "Vendedores" no grupo Comercial, mas ambos apontam para a mesma tela do "Cadastro Unificado" (`/pessoas`). Remover esses dois itens, mantendo apenas o Cadastro Unificado.

## Mudança
- Em `src/components/erp-layout.tsx`, grupo "Comercial":
  - Remover `{ to: "/pessoas", label: "Clientes", icon: Users }` (linha 73)
  - Remover `{ to: "/pessoas", label: "Vendedores", icon: UserRound }` (linha 75)
- O grupo Comercial fica com: Pedidos, Lead Rota, Metas, Comissões, Gestão de comissões.

## O que NÃO muda
- As telas `/clientes` e `/representantes` continuam existindo e funcionando (links internos e redirecionamentos não quebram).
- Nenhuma alteração no banco de dados: o controle de menus por papel (`role_menus`) é por caminho (`/pessoas`), que permanece liberado.
- Ícones `Users` e `UserRound` seguem usados em outros itens; ajustar imports apenas se ficarem sem uso.

## Verificação
- Typecheck (`bunx tsgo --noEmit`).
- Conferir no preview que o menu Comercial não mostra mais Clientes nem Vendedores e que o Cadastro Unificado abre normalmente.
