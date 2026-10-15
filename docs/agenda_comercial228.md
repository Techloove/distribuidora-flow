# Agenda Comercial unificada — fase228

A Agenda Comercial passa a reunir Relacionamento, Clientes sem comprar e Cobrança. O menu lateral tem uma única entrada. Os endereços antigos `/cobranca` e `/clientes-inativos` redirecionam para a respectiva área, mantendo os links existentes.

## Implantação

Após as fases anteriores, execute integralmente `db/fase228_agenda_comercial_unificada.sql` no SQL Editor do Supabase como proprietário. Não desative RLS. Depois, atualize a aplicação e confira **Usuários e papéis > Agenda comercial**.

O catálogo mantém ações independentes: `comercial_acompanhar`, `clientes_reativar` e `cobranca_acompanhar`. Na primeira aplicação, acessos dos dois menus antigos são convertidos para o menu único; os representantes recebem reativação e cobrança da própria carteira. Financeiro mantém a ação de cobrança, sem ganhar acompanhamento comercial. A migração pode ser reaplicada sem restaurar ações posteriormente revogadas. O editor administrativo também normaliza nomes antigos enviados por clientes desatualizados.

Não é necessário recadastrar clientes ou acompanhamentos: o histórico, responsáveis, promessas e a unicidade de uma cobrança aberta por cliente usam a mesma tabela existente. Não há duplicação de contatos, alteração de títulos, baixa financeira ou autorização geral do financeiro para representantes.

## Uso

- **Relacionamento:** prioridades da carteira, última compra, vendas recentes e registro de visita/contato com próxima ação.
- **Clientes sem comprar:** faixas de15,30,45,60,90 e120 dias; inclui clientes sem compras registradas, mostra último pedido e ticket médio individual. A soma dos tickets é apenas uma estimativa de referência, sem previsão garantida de recuperação.
- **Cobrança:** clientes com parcelas abertas ou parciais, incluindo clientes bloqueados/inativos que ainda têm dívida, saldo e valor vencido com encargos/descontos já registrados. Permite contato, observação, próxima ação e promessa de pagamento. A promessa não quita títulos.
- Filtros de busca por nome/código, representante, rota e cidade permanecem ao alternar áreas. O centro de custo segue o seletor global. Representantes não têm seletor de outras carteiras; administradores podem filtrar todas as carteiras.
- Lista de clientes, parcelas e histórico possuem paginação de50 registros. Os totais dos cartões são calculados no banco sobre todo o conjunto filtrado, não apenas a página. A impressão utiliza a página atualmente exibida.
- Ao escolher um cliente, o formulário começa sem as observações/promessas do cliente anterior. Alterar os filtros limpa a seleção para evitar registrar contato na carteira errada.
- A cobrança sem um centro selecionado considera os centros permitidos e registra acompanhamento geral do cliente; com centro selecionado, fica associada a esse centro. O histórico permite concluir ações próprias; gestão também pode concluir ações de outros responsáveis.

## Isolamento de dados

As novas RPCs verificam usuário ativo, permissão da ação, acesso ao centro e carteira no servidor. Um representante sem vínculo tem carteira vazia. Papéis combinados, como representante e gestor/financeiro, continuam limitados à carteira; administrador é a exceção explícita da fase206. A troca da carteira de um cliente impede novas leituras e ações pelo representante anterior nas consultas seguintes.

As opções dos filtros também são calculadas somente a partir de clientes acessíveis. Consultar títulos por um ID de cliente de outra carteira é negado. Os detalhes de cobrança retornam somente os campos necessários ao acompanhamento; as permissões gerais de contas a receber, bancos, baixa e conciliação não são ampliadas. O histórico permanece sob RLS, e registrar/concluir acompanha novamente as permissões e a carteira dentro da transação. As ações são auditadas.

## Verificação

```sh
NODE_PATH=/caminho/das/dependencias node scripts/check-agenda-unificada-database.cjs
bun test
bun run typecheck
bun run lint
bun run build
bun run check:sql
bun run check:migrations
bun run check:surface
bun run check:server
```

O teste PostgreSQL isolado usa os controles reais de carteira e permissões das fases206/211. Abrange representantes A/B, administrador, papéis combinados, ausência de vínculo, filtros de centro, encargos, registro/conclusão, duplicidade de cobrança, revogação de ação/menu, troca de carteira, sessão inativa, acesso anônimo, paginação e reaplicação. A conferência de Chromium com dados simulados cobre menu único, três áreas, manutenção dos filtros, promessa, parcelas, perfil de representante, redirecionamentos e tela de390px sem rolagem horizontal. Não houve consulta ou alteração do banco de produção pelo ambiente de desenvolvimento.
