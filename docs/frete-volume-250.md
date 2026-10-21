# Frete por volume e outras despesas — fase250

Execute inteiro `db/fase250_frete_volume_despesas.sql` no Supabase e publique o código no Lovable. A migração preserva documentos existentes; não preenche tarifas nem modifica o estoque físico compartilhado.

## Configuração

Em **Lojas → Configurações da loja**, selecione a loja e use **Frete por volume**. Selecione uma cidade/UF existente nos clientes, um produto do catálogo da loja e o valor cobrado por unidade de venda desse produto. Exemplo: cimento vendido em SC, tarifa R$ 2,50, quantidade 100: frete R$ 250,00. Produtos vendidos em KG utilizam a quantidade em KG; não há conversão automática de quilogramas para sacos. Configure o produto com a unidade de venda correta.

As cidades são agrupadas por nome e UF, ignorando diferenças de caixa e espaços. Estados diferentes têm tarifas independentes. Produtos sem tarifa ativa para a cidade não recebem a cobrança. Valor zero é permitido. A opção Editar também permite inativar uma tarifa sem apagar seu histórico nos documentos. Para localizar produtos, use a busca do catálogo (50 resultados por busca); a tabela de tarifas tem filtro próprio.

As regras são específicas por loja, inclusive para novas lojas. Não são copiadas entre lojas. Alterar uma tarifa não reescreve pedidos aprovados. Nos rascunhos, ela entra no próximo recálculo de itens ou em **Atualizar encargos**.

## Pedido e orçamento

O painel **Frete por volume e outras despesas** mostra os produtos cobrados, sua quantidade/unidade, cidade/UF, tarifa e subtotal. A opção **Aplicar frete por volume** permite habilitar o cálculo. Novos documentos a iniciam habilitada; documentos anteriores à implantação conservam a opção desligada, para não alterar preços já combinados.

**Outras despesas cobradas** é um valor adicional ao cliente. O frete manual continua disponível e é somado separadamente. Portanto:

`total = itens − descontos + acréscimos da forma + frete manual + frete por volume + outras despesas`

Os encargos não compõem a base da comissão dos produtos, nem substituem os custos internos de entrega/rentabilidade. A confirmação existente gera as parcelas sobre o total final do pedido, usado também na emissão dos boletos. Não emite boleto automaticamente. O orçamento continua sem estoque, títulos e comissão efetiva até sua conversão pelo fluxo existente.

Salve os encargos antes de confirmar o pedido ou aceitar o orçamento. Ao alterar quantidades, produto, cidade do documento (via cliente) ou loja em digitação, o cálculo é atualizado pelos motores do banco. Mudanças no endereço do cadastro do cliente aparecem no próximo recálculo do rascunho. Após sair da digitação, a fotografia dos encargos fica preservada. A impressão compartilhada mostra as três cobranças separadamente. A devolução de produtos não incorpora esses encargos ao preço unitário devolvido.

## Acesso e validação

Duas ações aparecem em Usuários e papéis: **Configurar frete por volume e cidade da loja** e **Definir frete por volume e outras despesas do pedido/orçamento**. A configuração exige gestão e acesso à loja; a edição do pedido também exige a carteira do representante e as permissões de orçamento, quando aplicável. A migração não restaura permissões removidas caso seja executada novamente.

Validação: teste integrado PGlite com os motores reais de recálculo e devolução, tarifas por produto/cidade/UF/loja, quantidades, encargos, comissão, documentos anteriores, preservação após aprovação, orçamentos, valores inválidos e acessos; testes de impressão e compilação. Nenhum SQL foi executado no Supabase de produção pela ferramenta.
