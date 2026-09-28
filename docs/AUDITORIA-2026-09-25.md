# Auditoria técnica — Distribuidora Flow

Base analisada: `4bf9a2d6fb826c38a14c24987bd7fcb644d0dfd2`, branch `main`.

Foi feito inventário dos 209 arquivos versionados (208 textuais e um ícone), busca estática no código e SQL, revisão aprofundada de autenticação, permissões, centros, integrações, painel e fluxos financeiros, instalação das dependências, compilação e testes. Isso não equivale a testar todas as operações no banco real: o Supabase, o Sicredi e a hospedagem não estavam conectados ao ambiente local.

## Correções nesta proposta

Atualização: as fases 79–81 foram aplicadas e verificadas no Supabase após esta revisão inicial. Consulte [VALIDACAO-SUPABASE.md](VALIDACAO-SUPABASE.md) para o estado da implantação e da integração com as alterações recentes do usuário.

| Problema confirmado | Mudança |
| --- | --- |
| Funções Sicredi e consultas cadastrais sem autenticação no servidor | Middleware valida JWT com `auth.getUser`, consulta perfil ativo e papéis usando o JWT do usuário e exige perfil adequado antes de acessar integrações. |
| Parâmetros bancários aceitos apenas por anotação TypeScript | Validação Zod, valores finitos/positivos, datas válidas, vínculo do título e do pagador, conferência do valor/vencimento, centro permitido e existência de boleto ativo. |
| Repetição de consulta de boleto liquidado somava novamente o pagamento | Fase 81 verifica permissão financeira e centro, bloqueia linhas durante a transação e torna a segunda confirmação uma operação sem efeito. Divergências de valor exigem conciliação. |
| Falha ao consultar menus liberava menus padrão; usuário sem papel ficava carregando indefinidamente | Falhas negam acesso, lista vazia significa ausência de permissão e existe uma tela explícita de acesso pendente/erro. |
| Dados de consultas e papéis podiam sobreviver à troca de usuário | Limpeza do cache na mudança de identidade, chaves de permissões por usuário, consulta de perfil ativo e atualização periódica de papéis. |
| Perfil podia alterar seus próprios campos de autorização | Trigger limita edição própria a nome/telefone; campos como `ativo`, `empresa_id` e `todos_centros` exigem administrador. |
| Cadastro público concedia papel comercial e o primeiro cadastro virava administrador | Novo usuário recebe apenas perfil; atribuição de papel é administrativa. Cadastro público foi removido da tela. Não se recomenda desativar confirmação de e-mail. |
| Alguns helpers ignoravam usuário inativo | `has_role`, `can_manage`, `can_finance`, `can_stock` e `can_operate` passam a considerar o perfil ativo. |
| Policies permissivas e views podiam ultrapassar o escopo esperado | Fase 79 adiciona policies restritivas de usuário ativo e de centro em tabelas já protegidas por RLS; restringe carteira de pessoas; views usam `security_invoker`; funções `SECURITY DEFINER` existentes deixam de ser executáveis por anônimos. |
| Painel somava no navegador resultados limitados pela API e ignorava centro | RPC `dashboard_resumo` agrega no PostgreSQL com RLS e filtro de centro. Considera encargos/descontos e estados posteriores à confirmação. Cadastros/estoque continuam consolidados nos dados visíveis ao usuário. |
| CSV podia transportar fórmula fornecida por usuário | Neutralização de texto iniciado por `=`, `+`, `-` ou `@`, inclusive após espaços/controles. |
| Chamadas externas podiam esperar indefinidamente | Timeout explícito; operações bancárias não recebem repetição automática. Falha ao carregar configuração bancária não troca silenciosamente para outra configuração. |
| Interface densa e menu móvel sem diálogo acessível | Nova tela de acesso, paleta, tipografia, cartões, cabeçalho, busca de módulos, links sem duplicação, menu móvel Radix, foco visível e respeito a movimento reduzido. |
| Ausência de verificação automática versionada | Scripts de typecheck/testes, lockfile npm e workflow de qualidade para PRs. |

## Validação

- TypeScript: sem erros.
- Compilação de produção: executada localmente; avisos de APIs legadas do TanStack e configuração de paths do pacote Lovable permanecem.
- Testes Node: autenticação remota simulada, sessão inválida/inativa/sem papel, papéis financeiros, validação bancária e CSV.
- PostgreSQL via PGlite: aplicação e reaplicação das fases 79/80/81 em schema de teste; bloqueio de escalada de perfil, carteira e centro; usuário inativo; agregação de 1.005 pedidos; baixa repetida de boleto sem duplicar pagamento.
- O schema de teste cobre as estruturas necessárias a essas mudanças; não representa a restauração integral do banco real.
- Auditoria npm inicial: nenhuma vulnerabilidade conhecida reportada na resolução instalada durante a revisão. A repetição final não pôde ser concluída por falha de acesso ao registry. Isso não certifica a segurança do código da aplicação.
- Lint dos arquivos de código alterados: sem erros; existem avisos de desenvolvimento e débito de formatação em outros arquivos do repositório. O lint global ainda não é um gate de CI.
- Verificação visual: acesso real local sem configuração Supabase; painel com os componentes reais e dados fictícios em prévia local separada, em desktop e celular. Busca de módulos e abertura do menu móvel verificadas. Não houve login em conta real nem emissão bancária.

## Pendências que bloqueiam afirmar que o ERP está pronto para produção

### P0 — Isolamento entre empresas SaaS

O modelo é principalmente multi-centro. `profiles.empresa_id` não constitui isolamento entre empresas: diversas tabelas operacionais e cadastros não carregam uma chave de organização com referências compostas e policies correspondentes. A fase 79 reforça centros, mas não implementa multi-tenancy. Antes de hospedar empresas independentes no mesmo banco, definir organização/membros, papéis por organização, chaves compostas, RLS de todas as relações, storage e jobs. Alternativa inicial: projeto/banco separado por distribuidora.

### P0 — Histórico do banco incompleto

Há fases 1 a 53 (as fases 2/3 compartilham arquivo) e depois 77/78. Não estão versionadas as fases intermediárias. A fase 78 usa `devolucao_operacoes`, cuja criação não está no repositório; a função de centro nela referenciada também não estava definida na base versionada. A fase 79 define o helper de centro, mas não reconstrói as demais estruturas ausentes. Obter dump apenas de schema/migrations do projeto real e reconciliar antes de aplicar a proposta. Não executar todos os scripts históricos indiscriminadamente.

### P0 — Emissão bancária precisa de idempotência persistente

A chamada ao Sicredi ainda ocorre antes de o navegador persistir o boleto. Falha de rede/gravação após emissão pode deixar boleto no banco sem registro local; duas emissões simultâneas também ultrapassam a verificação prévia. Implementar reserva transacional por título, identificador idempotente aceito pelo provedor, persistência no servidor e reconciliação de resultado desconhecido. A verificação adicionada reduz erros comuns, mas não resolve essa concorrência. A fase 81 resolve repetição da **liquidação local**, não idempotência da **emissão externa**.

### P1 — Conciliação e funções financeiras antigas

A baixa de boleto preserva o modelo da fase 16 e ainda não cria movimento em `movimentos_financeiros`. Por isso, saldo de título e extrato bancário precisam de conciliação. `receber_titulo`/`pagar_titulo` da fase 33 limitam o acumulado com `least`, mas gravam o valor integral informado no movimento; pagamentos excedentes podem divergir. Esses RPCs `SECURITY DEFINER` também precisam validar centro do título, conta financeira e permissões específicas dentro da função. RLS restritiva não limita automaticamente o dono de uma função definer. Rever também cancelamento, transferência, reserva e estorno com o schema efetivamente instalado.

### P1 — Segredos bancários

`sicredi_config` guarda chave/senha e a tela de configurações ainda consulta os valores para gestores. Migrar esses campos para secrets/Vault, prover gravação pelo servidor com resposta mascarada e auditoria de alteração. Não compartilhar service role com o navegador. Chaves já expostas fora dos destinatários autorizados precisam ser rotacionadas pelo operador.

### P1 — Operações e recuperação

Não foram verificados backup/PITR, restauração, RPO/RTO, alertas, limites de taxa, MFA administrativo, política de senha, confirmação de e-mail, storage ou assinatura de webhooks. A branch principal estava sem proteção na consulta realizada. Exigir revisão e checks na branch e homologar o fluxo pedido → estoque → faturamento → entrega → recebimento → comissão → devolução com dois centros e dois representantes.

### P2 — Volume e qualidade contínua

Listagens genéricas e rankings ainda podem depender do limite REST padrão e fazem filtros/agregações no cliente. Migrar para paginação e agregações no banco por módulo; medir planos com `EXPLAIN (ANALYZE, BUFFERS)` usando massa real. A otimização desta proposta cobre os indicadores principais do dashboard, não todos os relatórios. Remover o débito global de formatação em uma alteração própria e transformar lint em gate. Validar DRE, rentabilidade e comissão contra casos contábeis aprovados pela distribuidora.

## Referências técnicas

- [TanStack Start — middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware): proteção na função de servidor, além da interface.
- A confirmação final de políticas, funções e índices deve ser feita no catálogo do PostgreSQL implantado, não apenas nos arquivos históricos.

