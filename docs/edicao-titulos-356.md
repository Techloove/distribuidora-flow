# Edição de títulos e banco da emissão — fase 356, versão 1.47.0

## Títulos

Em Contas a Receber e Contas a Pagar, Opções → Editar dados do título abre os dados atuais da parcela. O usuário financeiro precisa da permissão receber_editar ou pagar_editar e de acesso à loja. A migração concede as novas ações aos papéis financeiros que já têm o menu correspondente; atribuições específicas continuam administráveis pelas permissões existentes.

Campos: documento, emissão, vencimento, descrição e observações. Nos lançamentos manuais, também valor e categoria. Títulos com pedido_id, compra_id, acordo_id ou nf_entrada_id preservam valor/categoria da origem. Loja, parceiro, parcela, origem, encargos, descontos e dados da baixa não são alterados pela edição. O novo valor deve ser positivo, ter centavos válidos e manter saldo positivo após os ajustes existentes.

Pagos, parciais, cancelados ou com qualquer movimento de baixa (inclusive estornado) não são editados por essa opção. Em receber, a existência de boleto registrado, liquidado, baixado, cancelado, pendente ou em processamento bloqueia a opção. Uma tentativa recusada com status erro e sem nosso número não comprova emissão e não bloqueia sozinha. Uma tentativa inconclusiva permanece protegida pelos estados pendente/em_processamento dos emissores existentes.

O RPC autentica o usuário e verifica rotina, papel financeiro, escopo e loja. A linha é travada, e o servidor revalida boleto e pagamentos antes de salvar. O fingerprint da linha impede sobrescrever alterações posteriores à abertura do formulário. Só campos da lista permitida são aceitos; auditoria registra anterior/novo. Nenhum movimento de caixa, recebimento ou pagamento é criado.

## Emissão do boleto

O aviso da janela estava fixo em Sicredi, embora a seleção do emissor já considerasse a configuração da loja. A janela agora lê centro_id diretamente das parcelas para consultar cobranca_centros, mostra Sicoob ou Sicredi e reconsulta a configuração ao confirmar o envio. Não usa a loja do filtro global nem confia no centro informado pelo componente pai. Loja ausente ou parcelas de lojas diferentes bloqueiam o lote.

Na configuração atual, Cimento → Sicoob e Ferragens → Sicredi. A associação continua no cadastro bancário da loja, sem comparação de nomes ou endereços de API fornecidos pelo navegador. Os emissores existentes continuam conferindo o título e a configuração no servidor antes da chamada bancária. Reimpressões preservam o banco do boleto original.

## Verificação

Fixture PostgreSQL descartável: receber/pagar, auditoria, centro e permissões, versão obsoleta, boleto surgido depois da abertura, estados bancários, pagos/parciais/cancelados, histórico de baixa, proteção da origem e saldo após descontos. Nenhum movimento financeiro produzido.

Chromium: edição manual e moeda brasileira, título atualizado, opção ausente em título com boleto, edição a pagar, campos de origem protegidos e celular sem overflow. Em outra fixture, Cimento chama apenas Sicoob e Ferragens apenas Sicredi, mesmo com centro do componente pai divergente; títulos sem loja ficam bloqueados. São chamadas fictícias, sem bancos reais.

11 testes unitários de emissão, lançamento e baixa (60 expectativas), typecheck, lint, build, manual, datas e verificações SQL aprovados. Nenhum boleto real foi emitido ou alterado.

## Implantação

Aplicar db/fase356_editar_titulos.sql antes da publicação. O acesso de gerenciamento Supabase da sessão retorna HTTP 401; a aplicação automática não ocorreu. O usuário confirmou a execução manual com sucesso em 11/11/2026; essa confirmação não foi verificada independentemente pelo acesso de gerenciamento indisponível. Após instalar e publicar, recarregar a página para obter as novas permissões. A baixa automática Sicoob permanece pendente da validação do primeiro retorno real de pagamento e não é implementada nesta entrega.
