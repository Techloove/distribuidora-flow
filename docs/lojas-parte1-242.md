# Lojas — parte1 (fase242)

Esta primeira entrega cria a identidade de cada loja. **Não separa ainda catálogo, preços, descontos ou parâmetros comerciais**; essas integrações fazem parte das próximas entregas.

1. Execute integralmente `db/fase242_identidade_lojas.sql` no Supabase, após a fase241 já instalada.
2. Publique a atualização no Lovable.
3. Abra **Lojas** (antigo menu Centros), edite cada registro e confira nome, nome fantasia, razão social, CNPJ, contato e endereço.
4. Envie a logo em PNG/JPEG/WebP de até200 KB, ou informe um endereço HTTPS. Salve o cadastro.
5. Imprima um pedido ou orçamento: o cabeçalho usa a identificação e a logo da loja do documento, inclusive ao imprimir pedidos de lojas diferentes juntos.

A migração usa os dados comuns da empresa para preencher campos vazios uma única vez. Revise os dados de cada loja, especialmente CNPJ e endereço. Reaplicar não sobrescreve ajustes posteriores. Campos apagados no cadastro da loja não são silenciosamente substituídos por dados globais na impressão.

Os IDs e a tabela técnica `centros` são preservados para manter pedidos, clientes, relatórios, acessos e cobrança vinculados. A rota `/centros` continua funcionando, com o nome Lojas na interface. O estoque permanece compartilhado e as permissões existentes não são ampliadas. As configurações bancárias continuam com as mesmas regras da fase237. Não existe nova assinatura ou separação em empresas independentes.

As logos enviadas são armazenadas no próprio cadastro como imagem incorporada, sem depender de um bucket público novo. A validação do banco permite apenas HTTPS e imagens raster incorporadas; o modelo de impressão escapa os atributos HTML.

Validação: testes de identidade e logo, impressão de documentos de duas lojas sem misturar dados, migração com PGlite (inicialização única, reexecução, IDs/RLS e rejeição de formato inválido), tipos, lint e build. Nenhuma operação foi executada no banco de produção.
