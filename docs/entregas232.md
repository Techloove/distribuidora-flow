# Rotina Entregas — fase232

Execute integralmente `db/fase232_rotina_entregas.sql` no SQL Editor do Supabase, após a fase231. Depois atualize o aplicativo com Ctrl+F5.

## Como utilizar

1. O administrador cadastra/aprova a conta de quem fará as entregas e define o perfil e os centros permitidos. A rotina usa as capacidades dos perfis **Expedição** ou **Estoque** (administrador/gestor também podem utilizar).
2. Em **Usuários e papéis**, libere o menu **Entregas** e a ação **Consultar e formalizar entregas de pedidos** (`entregas_operar`) para o perfil. Os papéis Expedição/Estoque que já tinham o menu Expedição e a ação de registrar entregas recebem esse acesso na primeira aplicação. Reaplicar a migração não restaura permissões ou menus revogados.
3. Mantenha o fluxo normal: separação, faturamento comercial quando exigido, carga e despacho. O pedido **e** o romaneio precisam estar em rota. Pedidos ainda em separação não podem ser marcados como entregues por esta tela.
4. Acesse **Operação → Entregas**, logo depois de Expedição. Busque pelo número do pedido, código/nome do cliente ou cidade; filtre a rota e use o centro global. A tela lista pedidos em rota e permite consultar os entregues, em páginas de50 com contagens completas. Atualiza a cada30 segundos e pelo botão Atualizar.
5. Abra **Confirmar entrega**, confira os códigos, produtos e quantidades e informe a data efetiva da entrega, o nome de quem recebeu e a referência do comprovante. Exemplo de referência: identificação do canhoto assinado ou protocolo de recebimento. Observação é opcional.
6. Clique **Formalizar entrega completa** somente após entregar integralmente a mercadoria. O pedido e a expedição passam a entregue, com a data informada. O registro guarda o usuário e a data/hora em que a confirmação foi feita. A data de entrega aparece também ao abrir o pedido.
7. Em **Entregues**, consulte data, recebedor, referência, observação e autor do registro.

A referência do comprovante é textual, como já previsto na confirmação integral existente209. Esta tela não envia fotos/arquivos nem exige assinatura digital. A rotina de comprovantes privados e entregas parciais existente na Expedição continua disponível com suas permissões próprias.

## Regras e integração

- A consulta e a confirmação exigem usuário ativo, menu/ação, capacidade logística, centro da expedição e do pedido. Representante com outro papel continua limitado à carteira atual **e** à representação do pedido; somente admin tem a exceção existente. Usuários sem capacidade logística não recebem acesso apenas por marcar o menu.
- Não há vínculo individual entre login e motorista textual. O entregador autorizado vê os pedidos dos centros liberados, com filtros por rota. O autor de cada confirmação é registrado individualmente; não se apresenta a lista como "minhas entregas".
- A data não pode ser futura no calendário de São Paulo nem anterior à saída (ou à data do pedido, se a saída não estiver registrada). Recebedor e referência são obrigatórios e limitados. O pedido precisa conter itens.
- Entregas parciais e recusas com itens registrados ficam bloqueadas nesta confirmação integral e devem ser tratadas na Expedição. Isso impede que uma confirmação simples ignore saldo ou devolução pendente.
- As RPCs de leitura retornam somente dados logísticos do escopo permitido. Não liberam acesso financeiro, custos, dados gerais de usuários ou escrita direta em tabelas. O entregador pode ter apenas o menu Entregas sem precisar do menu Expedição; o perfil continua precisando da capacidade logística existente.
- A confirmação usa chave UUID, lock por operação e locks de expedição/pedido/cliente. Repetir a mesma chave e os mesmos dados retorna o registro anterior, sem nova entrega. Reutilizar a chave com dados diferentes é rejeitado. Em falha de conexão, tente novamente no mesmo formulário, sem fechá-lo: ele preserva a chave. Uma nova tentativa com outra chave não sobrescreve uma entrega já formalizada.
- Reutiliza `entrega_registros` e `avancar_expedicao`; mantém as proteções de comprovante e saldo e a sincronização de status42/214. Não altera os motores de receber pedidos, estoque, títulos, cobrança ou emissão fiscal. Não cria boleto, nota ou recebimento financeiro.
- Acrescenta `pedidos.data_entrega` e `entrega_registros.data_entrega`, separando a data efetiva da entrega da data/hora de registro. A data do pedido é sincronizada da expedição também para as rotinas existentes. Pedidos já entregues recebem, quando ausente, a data conhecida da expedição; não se inventa a data da implantação para históricos sem data.
- O editor de Usuários e papéis aceita `/entregas` e preserva os aliases das unificações anteriores.

## Validação

`NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-entregas-database.cjs` executa a migração em PostgreSQL/PGlite com motores reais59/42/209/214 e auxiliares de acesso206/211. Verifica status/data em pedido e expedição, backfill, histórico/autor, idempotência e colisão, datas inválidas, campos obrigatórios, parcial bloqueada, pedido fora de rota, centros/carteiras/perfis combinados, acesso apenas pelo menu dedicado, revogação/reaplicação, usuário inativo, anonimato e paginação. Não acessa o Supabase de produção.

A interface foi verificada em Chromium, inclusive com usuário que possui somente o menu Entregas: pedidos em rota, bloqueio de parcial, itens/códigos, obrigatoriedade dos campos, confirmação com data histórica, remoção da lista pendente, consulta da entrega/autor/referência e perfil sem autorização. Tela e formulário conferidos visualmente em390px sem transbordamento horizontal. Compilação e TypeScript aprovados; 92 testes aprovados; verificações SQL, migrações e superfícies cliente/servidor aprovadas. Lint sem erros, com9 avisos React Refresh preexistentes.
