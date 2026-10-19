# Correção da criação de orçamentos — fase240

A mensagem “A criação de documento gerou comissão inesperada; nenhuma proposta foi criada” é uma proteção transacional da fase236. A rotina criava um pedido comum e só depois alterava sua natureza para orçamento. O gatilho `trg_comissao_pedido`, instalado na fase21, apurava uma previsão de comissão no INSERT inicial, mesmo com valor zero. A checagem detectava esse efeito indevido e revertia a criação.

A fase240 faz o registro nascer como **orçamento em negociação**, antes de qualquer gatilho de INSERT. O motor atual de criação é usado como origem de uma função interna, preservando as validações instaladas de centro, carteira, cliente, rota, representante e pagamento; o motor público de pedidos normais, sua assinatura, OID e permissões não são alterados. A nova função interna não é executável por usuários autenticados ou anônimos. O endpoint de orçamento mantém a mesma assinatura e as verificações da fase236.

O apurador continua ignorando documentos de natureza orçamento. A proteção contra comissão inesperada e as barreiras de estoque, títulos e entrega permanecem; nenhum gatilho é desativado e nenhuma comissão é apagada. Após o aceite e a conversão em pedido, a apuração de comissão continua pelo fluxo de vendas existente.

## Aplicação

1. Abra o SQL Editor do projeto CaparaoSystem no Supabase.
2. Execute **todo** `db/fase240_orcamento_sem_comissao_na_criacao.sql`, depois da fase236 já instalada. Não precisa repetir as fases anteriores.
3. Tente criar novamente o orçamento e incluir os itens. A tentativa que apresentou a mensagem foi revertida; não é necessário apagar pedidos ou comissões.

A correção é somente no banco e mantém o endpoint usado pela tela atual; não requer nova publicação da interface no Lovable. É reaplicável. Se uma manutenção futura reescrever a fase236 ou alterar o motor de criação de pedidos, reaplique a fase240 após essa manutenção ou atualize os dois motores em conjunto. A migração recusa padrões incompatíveis para evitar alterações parciais.

## Validação

`NODE_PATH=<instalação do PGlite>/node_modules node scripts/check-orcamentos-database.cjs` instala o gatilho real da fase21, reproduz a mensagem antes da correção e verifica o fluxo corrigido: criação e edição sem efeitos operacionais, validade e recusa, revisão, aceite idempotente, reserva e confirmação, preservação do motor normal e de sua comissão, bloqueios de carteira/centro/permissões e inacessibilidade da função interna. Os motores de recálculo e escrita física do estoque são fixtures controladas, como indicado no resultado do teste.

O teste anterior não incluía o gatilho de INSERT da comissão. Essa lacuna permitia que a criação passasse no teste, embora o banco real acionasse o gatilho. A regressão agora cobre esse cenário.

A validação local não executa a migração no Supabase de produção.
