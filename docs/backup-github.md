# Backup com Lovable, Supabase e GitHub Actions

Este é o executor sem servidor próprio. O workflow `.github/workflows/backup.yml` usa máquinas temporárias do GitHub. Não instale os timers systemd em paralelo.

## Funcionamento

- A rotina diária solicita uma cópia às **03h07 de Brasília** (06h07 UTC).
- A fila do botão **Fazer backup manual** é consultada aproximadamente a cada hora. O agendador do GitHub pode atrasar; uma solicitação não é um backup concluído.
- Para atender imediatamente, abra **GitHub → Actions → Backup completo do ERP → Run workflow**. A opção de gerar uma nova cópia vem habilitada; desabilite-a para atender apenas a fila existente.
- O processo cria um dump de todos os schemas exportáveis, inclui o código do commit executado e os arquivos do Storage, verifica a criptografia e envia uma cópia criptografada para os artefatos do GitHub. Depois baixa o artefato e verifica novamente. Uma segunda pasta no mesmo computador não conta como destino externo.
- Só após essa verificação o processo publica o pacote privado no Supabase para **Salvar no computador** e registra sucesso no histórico.
- Os artefatos do GitHub são retidos por **sete dias** nesta configuração inicial. Cópias já baixadas no computador e os pacotes do Storage não são removidos por esse workflow. Defina a retenção de longo prazo conforme a empresa.

## Provisionamento seguro

As fases268 e 283 devem estar instaladas no Supabase. O comando administrativo `node scripts/configurar-backup-github.mjs` exige `SUPABASE_ACCESS_TOKEN` configurado com segurança e GitHub CLI autenticado com permissão de escrita nos segredos e variáveis deste repositório. Credenciais não são passadas em argumentos nem impressas.

O provisionamento cria `caparao_backup_reader`, com login exclusivo, `pg_read_all_data`, leitura através de RLS para copiar todas as lojas e transações somente de leitura por padrão. Não altera a senha do usuário `postgres`. O usuário não recebe permissões de escrita, de criação de papéis, de criação de banco ou de replicação.

O Supabase Vault guarda `caparao_backup_pgpassword` e `caparao_backup_recovery_key`. Reexecuções reutilizam esses segredos; não troque a chave de criptografia sem preservar as chaves das cópias anteriores. Guarde também uma cópia offline da chave de recuperação, fora dos arquivos de backup. Se perder o projeto Supabase, os backups continuam no GitHub, mas a recuperação ainda exige a chave, guardada como segredo do repositório. Segredos do GitHub podem ser usados por workflows autorizados, mas não podem ser lidos pela interface depois de salvos.

São configurados no GitHub, sem valores em código:

| Tipo | Nome | Uso |
| --- | --- | --- |
| Segredo | `BACKUP_PGPASSWORD` | Login do leitor exclusivo |
| Segredo | `ERP_BACKUP_KEY` | Criptografia e verificação |
| Segredo | `BACKUP_SUPABASE_SERVICE_ROLE_KEY` | Fila e Storage privados |
| Variável | `BACKUP_SUPABASE_URL` | URL do projeto |
| Variável | `BACKUP_PGHOST` | Pooler de sessão |
| Variável | `BACKUP_PGUSER` | Leitor exclusivo com referência do projeto |
| Variável | `BACKUP_ATIVO` | `true` para habilitar; sem essa variável o workflow não executa |

Depois de publicar e revisar o workflow em `main`, habilite `BACKUP_ATIVO=true`, execute manualmente e confira tanto o histórico no sistema como o artefato no GitHub e o download privado. Só considere a implantação ativa após uma execução real concluir. O script de provisionamento não habilita nem dispara o workflow automaticamente.

## Conexão, isolamento e recuperação

O dump usa PostgreSQL 17 por Docker, compatível com o servidor 17.6 observado na implantação, e o pooler de **sessão** na porta5432. TLS permanece em `verify-full`, com o certificado raiz do sistema. Não use porta6543 (pooler transacional) nem desative a validação do certificado.

O workflow não roda em pull requests. Ele tem concorrência única, estado temporário fora do checkout, limite de cinco horas e limpeza dos arquivos locais. A cópia do GitHub só contém arquivos criptografados; a chave fica nos segredos, separada do artefato. Não publique os valores dos segredos em logs ou na aplicação. Interrupções abruptas podem deixar a reserva ativa até expirar; revise a execução antes de reenviar.

A conta de leitura contempla tabelas e schemas futuros. Falta de privilégio ou arquivos alterados/truncados durante a coleta causa falha, nunca redução silenciosa do escopo. A restauração real deve ser testada em projeto isolado. Funções remotas fora do repositório, configurações do provedor, papéis globais e segredos externos continuam exigindo plano separado de recuperação, conforme `backup_recuperacao.md`.
