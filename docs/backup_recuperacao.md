# Backup externo e recuperação

Os scripts fazem leitura do PostgreSQL e do Supabase Storage. Não há backup de produção ativo por esta entrega: faltam conexão, credenciais seguras, cliente PostgreSQL e destino externo configurados. O teste automatizado utiliza conteúdo sintético.

## Configuração da infraestrutura

Use um host de administração com Node 24 e `pg_dump` compatível com a versão do PostgreSQL do projeto. Configure por gerenciador de segredos: `PGHOST`, `PGPORT` quando necessário, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLROOTCERT`, `EXT_SUPABASE_URL`, `EXT_SUPABASE_SERVICE_ROLE_KEY`, `ERP_BACKUP_KEY`. A chave de criptografia deve ter 32 bytes em hexadecimal, gerada de forma segura e guardada separadamente dos backups. Não envie valores por chat nem grave em GitHub, frontend ou arquivo versionado.

A conexão usa `PGSSLMODE=verify-full` e HTTPS. Não remova validação TLS. Use a conexão administrativa indicada pelo Supabase e uma CA confiável; a conta precisa ler os schemas `public`, `auth` e `storage`. A chave service role é utilizada somente pelo processo administrativo para ler todos os objetos de Storage.

Com as variáveis já configuradas, execute na raiz do repositório:

```bash
node scripts/backup-supabase.mjs /caminho/privado/backups
node scripts/verificar-backup.mjs /caminho/privado/backups/backup-DATA
```

O backup inclui dump personalizado dos três schemas, objetos de todos os buckets (inclusive privados) e manifesto criptografado com metadados dos buckets. Cada arquivo usa AES-256-GCM; hashes detectam adulterações. A pasta final aparece somente após conclusão; falhas descartam a pasta `.partial`. Logs não imprimem credenciais.

Copie a pasta concluída para armazenamento externo privado, com controle de acesso, versionamento e retenção definidos pela empresa. O script não envia a cópia externa. Configure um agendador do host e alerta para saída diferente de zero, ausência do backup esperado e falha na cópia externa. Uma cópia apenas no mesmo host não atende à recuperação após perda dele. Reexecute verificação no destino externo e realize testes periódicos de recuperação.

## Recuperação em ambiente separado

1. Escolha uma cópia íntegra e obtenha a chave correta pelo gerenciador de segredos.
2. Extraia em diretório privado, sem substituir arquivos existentes:

```bash
node scripts/verificar-backup.mjs /caminho/privado/backups/backup-DATA --extrair /caminho/privado/restauracao-teste
pg_restore --list /caminho/privado/restauracao-teste/banco.dump
```

3. Restaure **em projeto isolado de teste**, com versão compatível do PostgreSQL/Supabase, extensões e papéis previamente preparados. O dump não inclui senhas/definições dos papéis globais, configurações de Auth do projeto, Edge Functions, segredos de integração ou infraestrutura. Guarde essas configurações no processo separado de recuperação. O responsável pelo banco deve revisar a lista e escolher o comando de restauração adequado; não execute `--clean` contra produção.
4. Reponha os objetos extraídos de `storage/BUCKET/CAMINHO` nos mesmos buckets/caminhos, preservando acesso privado. A estrutura e os metadados constam do dump/manifesto. Valide compatibilidade do schema interno `auth/storage` antes da importação em outro projeto Supabase; não substitua esses schemas cegamente.
5. Confira autenticação de teste, políticas RLS, carteiras, saldos e depósitos, pedidos, recebíveis/baixas, sequenciais Sicredi e abertura de comprovantes privados. Não dispare cobrança bancária ao restaurar dados em teste.
6. Documente duração e resultados antes de considerar o processo de recuperação homologado.

O dump e a leitura de Storage não são uma única fotografia atômica. Programe janela controlada ou coordene gravações para obter um ponto consistente. A verificação de criptografia não substitui um teste real de restauração. Agendamentos, alertas externos e recuperação de produção não foram executados automaticamente.
