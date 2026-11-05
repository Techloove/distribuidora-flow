# Contrato, lista de serviços e faturas SaaS — fase335

O painel continua atendendo somente à empresa atual. A configuração reúne identificação, master, vigência inicial/final e lista de serviços: assinatura, setup/implantação, hospedagem, domínio e outros. Cada linha define descrição, valor, primeiro vencimento, observação e periodicidade mensal, anual, única ou parcelada mensalmente. Não adiciona empresas nem altera domínios da aplicação.

## Cálculo e faturas

A prévia é calculada no servidor pela mesma função usada ao salvar. Mensal/anual significam valor de cada cobrança; parcelado significa valor total distribuído em centavos, com diferença na última parcela. Recorrências partem da data original, ajustando o dia ao fim do mês sem acumular mudança para os meses seguintes. Parcelas e recorrências respeitam o término do contrato; parcelamento que ultrapasse o término é recusado. Limites: 50 serviços, vigência de até dez anos e até 120 parcelas por serviço.

Os vencimentos são persistidos ao confirmar a configuração, sem depender de cron ou de o proprietário abrir o sistema. Faturas são demonstrativos que agrupam os itens pelo mesmo vencimento, sem antecipar ou adiar cobranças. O número FAT-AAAAMMDD identifica o vencimento na operação única atual. O master consulta em Minha assinatura, filtra por mês, vê itens, pagamentos, saldo e imprime/salva PDF. Cancelamentos permanecem visíveis e não compõem o total a cobrar. Pagamento parcial significa que alguns itens da fatura foram confirmados e outros permanecem abertos.

O proprietário continua registrando pagamentos, cancelamentos e reaberturas por item, com os motivos e as operações idempotentes existentes. A fatura não é um boleto, nem cria integração bancária ou fiscal. O financeiro da plataforma continua separado do ERP. A data final delimita cobranças previstas, sem renovar automaticamente a contratação; não introduz nova regra de suspensão por expiração. Avisos e suspensão seguem parcelas vencidas e tolerância quando o controle está ativo.

## Histórico e segurança

As tabelas novas têm RLS habilitado e nenhuma leitura/escrita direta para anon/authenticated. Somente o proprietário ativo pode prever e salvar a configuração. Master tem consulta do painel, sem acesso à edição ou confirmação dos pagamentos; demais usuários não recebem valores do contrato. A API mantém disponíveis as rotinas de regularização durante suspensão. Guardas das rotinas antigas impedem geração paralela após adotar a lista.

O salvamento bloqueia a linha do contrato e exige a revisão vigente, evitando sobrescrita entre sessões. O UUID estável do serviço e a sequência identificam cada cobrança e impedem duplicação ao salvar novamente. Cobranças vencidas ou com qualquer evento financeiro, inclusive cancelamento, devem conservar descrição, valor, vencimento e identidade; modificações que as removam ou reescrevam são recusadas.

A instalação mantém o cálculo antigo até que o proprietário adote a lista. Na adoção, cobranças antigas são arquivadas com suas chaves, valores e vencimentos, mantendo os pagamentos. A vigência precisa incluir esse histórico e novos serviços devem começar após o último vencimento anterior para evitar sobreposição. Os dados históricos não são apagados. A instalação não cadastra serviços, não cria cobranças e não ativa o controle.

## Verificação

- `scripts/check-faturas-saas-335.cjs`: banco PGlite descartável com fases330/331/335, instalação repetida, prévia sem escrita, limites, datas mensais/anuais, ano bissexto, arredondamento de setup, concorrência, pagamento e histórico, master sem escrita, usuário comum sem dados, migração de cobranças antigas, regularização durante bloqueio e financeiro do ERP intacto.
- `tests/faturas-saas.test.ts`: agrupamento por vencimento, soma em centavos, total/saldo, pagamento parcial e cancelamentos.
- Testes anteriores das fases330 e331, suíte geral, typecheck, build e guardas SQL/cliente.
- `auditorias/contrato-servicos-faturas-335.json`: hashes e contagens antes/depois da instalação, sem conteúdo de clientes. A configuração existente permaneceu com controle desativado e zero serviços/cobranças novos.

A interface foi conferida em Chromium com autenticação, navegação e RPCs simulados, usando os componentes reais em 1366×768 e 390×844. Foram verificados contrato/prévia, fatura consolidada de R$ 553,23, abertura da impressão, master sem edição e ausência de transbordamento horizontal no formulário móvel. Os cálculos e autorizações do servidor são verificados separadamente no banco descartável.
