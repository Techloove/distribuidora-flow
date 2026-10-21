# Central de pendências — frete por volume (fase252)

Execute inteiro `db/fase252_pendencias_frete_volume.sql` após a fase251 e publique a atualização no Lovable. A migração adiciona somente uma consulta protegida; não modifica tarifas, pedidos, contas a receber ou estoque.

A Central e seu resumo no painel exibem **Cidades com frete por volume pendente**. Cada ocorrência identifica loja, cidade/UF e quantos produtos ainda não têm tarifa ativa. O contador representa combinações loja × cidade, incluindo cidades parcialmente configuradas.

Para evitar alertas de produtos que não utilizam esse frete, os produtos esperados são aqueles disponíveis no catálogo/categoria da loja que já possuem pelo menos uma tarifa ativa em alguma cidade. Uma loja sem uso configurado de frete por volume não gera esse alerta; cadastre a primeira tarifa para os produtos que devem usar a rotina. Produtos retirados do catálogo e lojas inativas não geram pendências.

As cidades são as mesmas do cadastro de clientes usadas na grade de tarifas. Novas cidades aparecem automaticamente; nomes com diferenças de caixa/espaços são agrupados, preservando a distinção entre UFs. Uma tarifa ativa com valor zero é válida. Tarifas inativas são consideradas ausentes para um produto que continua usando a cobrança em outras cidades.

**Revisar** abre Lojas com a loja selecionada e a cidade/UF filtrada na grade de frete. Selecione o produto, grupo ou categoria, complete os valores e salve. O salvamento invalida a consulta da Central; ela também atualiza automaticamente a cada minuto e possui botão para atualização manual.

A consulta exige gestão, a ação existente **Configurar frete por volume e cidade da loja** e acesso à loja. Representantes não recebem pendências administrativas de precificação, e gestores restritos não veem lojas fora de seu acesso. A Central mantém o limite de 40 ocorrências exibidas por tipo, com contador completo.

Verificação: teste integrado SQL de cidades novas, configuração parcial/inativa, valor zero, deduplicação, lojas/produtos fora de uso, filtros/acessos; teste de tela da Central até a configuração correta e desaparecimento da pendência após salvar.
