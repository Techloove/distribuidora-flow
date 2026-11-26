# Backup externo e recuperação

Para o botão administrativo, fila, histórico e agendamento diário, veja [Implantação da fase268](backup-implantacao-268.md).

Os scripts fazem leitura do PostgreSQL e do Supabase Storage. A implantação do executor GitHub está registrada em `backup-github.md`. O sucesso do agendamento com fila vazia não comprova uma cópia: confira as etapas de geração, armazenamento externo, recuperação e conclusão. A importação técnica está descrita abaixo; a conferência administrativa de recuperação pela interface exige a fase378 descrita abaixo.

## Configuração da infraestrutura

Use um host de administração com Node 24 e `pg_dump` compatível com a versão do PostgreSQL do projeto. Configure por gerenciador de segredos: `PGHOST`, `PGPORT` quando necessário, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLROOTCERT`, `EXT_SUPABASE_URL`, `EXT_SUPABASE_SERVICE_ROLE_KEY`, `ERP_BACKUP_KEY`. A chave de criptografia deve ter 32 bytes em hexadecimal, gerada de forma segura e guardada separadamente dos backups. Não envie valores por chat nem grave em GitHub, frontend ou arquivo versionado.

A conexão usa `PGSSLMODE=verify-full` e HTTPS. Não remova validação TLS. Use a conexão administrativa indicada pelo Supabase e uma CA confiável; a conta precisa ler todos os schemas e dados que o `pg_dump` completo exporta. Schemas sem privilégio causam falha; não reduza o escopo para obter um falso backup completo. A chave service role é utilizada somente pelo processo administrativo para ler todos os objetos de Storage.

Com as variáveis já configuradas, execute na raiz do repositório:

```bash
node scripts/backup-supabase.mjs /caminho/privado/backups
node scripts/verificar-backup.mjs /caminho/privado/backups/backup-DATA
```

O backup atual inclui dump personalizado de todos os schemas exportáveis do banco, incluindo estruturas, dados, sequências, funções, gatilhos, políticas e grants; todos os objetos dos buckets da aplicação, inclusive privados; e um arquivo do código e migrações do commit Git do host executor. Novos schemas, tabelas, funções e buckets da aplicação entram automaticamente nas execuções seguintes. O manifesto versão 2 registra o commit e o escopo; o verificador atual também lê backups antigos versão 1. O bucket reservado `erp-backups` armazena cópias para download e seus objetos são excluídos para impedir backups recursivos. Cada arquivo usa AES-256-GCM; hashes detectam adulterações. A pasta final aparece somente após conclusão; falhas descartam a pasta `.partial`. Logs não imprimem credenciais.

Copie a pasta concluída para armazenamento externo privado, com controle de acesso, versionamento e retenção definidos pela empresa. O script não envia a cópia externa. Configure um agendador do host e alerta para saída diferente de zero, ausência do backup esperado e falha na cópia externa. Uma cópia apenas no mesmo host não atende à recuperação após perda dele. Reexecute verificação no destino externo e realize testes periódicos de recuperação.

## Recuperação em ambiente separado

1. Escolha uma cópia íntegra e obtenha a chave correta pelo gerenciador de segredos.
2. Extraia em diretório privado, sem substituir arquivos existentes:

```bash
node scripts/verificar-backup.mjs /caminho/privado/backups/backup-DATA --extrair /caminho/privado/restauracao-teste
pg_restore --list /caminho/privado/restauracao-teste/banco.dump
```

3. Restaure **em projeto isolado de teste**, com versão compatível do PostgreSQL/Supabase, extensões e papéis previamente preparados. O dump lógico não inclui definições/senhas dos papéis globais nem configurações de Auth do provedor, Edge Functions remotas, segredos de integração ou infraestrutura. A versão atual preserva referências de donos e grants: prepare os papéis correspondentes no destino e revise a restauração. O arquivo `aplicacao.tar` contém o código versionado no commit informado no manifesto, não arquivos locais não versionados, valores de ambiente ou funções remotas fora desse repositório. Guarde essas configurações no processo separado de recuperação. O responsável pelo banco deve revisar a lista e escolher o comando de restauração adequado; não execute `--clean` contra produção.
4. Reponha os objetos extraídos de `storage/BUCKET/CAMINHO` nos mesmos buckets/caminhos, preservando acesso privado. A estrutura e os metadados constam do dump/manifesto. Valide compatibilidade do schema interno `auth/storage` antes da importação em outro projeto Supabase; não substitua esses schemas cegamente.
5. Confira autenticação de teste, políticas RLS, carteiras, saldos e depósitos, pedidos, recebíveis/baixas, sequenciais Sicredi e abertura de comprovantes privados. Não dispare cobrança bancária ao restaurar dados em teste.
6. Documente duração e resultados antes de considerar o processo de recuperação homologado.

O dump e a leitura de Storage não são uma única fotografia atômica. O script pagina buckets e objetos, verifica tamanhos quando informados e compara os inventários antes e depois da coleta; alterações detectadas abortam a cópia, em vez de anunciar sucesso parcial. Esse controle não substitui uma janela controlada nem garante uma transação única entre os serviços. Programe janela controlada ou coordene gravações para obter um ponto consistente. A verificação de criptografia não substitui um teste real de restauração. Agendamentos, alertas externos e recuperação de produção não foram executados automaticamente.


## Salvar no computador

Aplique `db/fase283_backup_download_privado.sql` depois da fase268 e ative `ERP_BACKUP_PUBLICAR_DOWNLOAD=true` **no host executor**, reiniciando o serviço conforme sua operação. O host também precisa de Git e tar e de um checkout atualizado. Revise o limite de upload por objeto e o espaço/custo do Storage antes de habilitar: um banco maior pode exceder limites do plano; a falha é reportada e não produz sucesso falso. Não remova arquivos do backup para caber no limite.

O executor gera e verifica as cópias local e externa, empacota somente arquivos criptografados em `.tar`, publica no bucket privado `erp-backups` e lê o upload de volta para comparar tamanho e SHA-256. Só depois registra a disponibilidade e finaliza a execução. Uma falha nessa publicação marca a execução como incompleta mesmo que a cópia externa tenha sido gerada; preserve-a e confira o status privado no host. A opção desligada mantém o fluxo anterior, sem download pela aplicação. Cópias antigas não se tornam baixáveis automaticamente.

No sistema, o administrador solicita **Fazer backup manual**, aguarda a conclusão e usa **Salvar no computador**. Chromium em contexto HTTPS permite escolher nome e pasta. Navegadores sem File System Access API usam sua própria configuração de downloads. O aplicativo não consegue impor uma pasta nesses navegadores nem confirmar que o download nativo terminou. No seletor suportado, o fluxo aborta se o tamanho recebido divergir do registrado. Links são autenticados na emissão e expiram em dois minutos; não os compartilhe.

Para recuperar, extraia o `.tar` em pasta privada, configure `ERP_BACKUP_KEY` com a chave guardada separadamente e execute o verificador atual com `--extrair`; ele produz `banco.dump`, `aplicacao.tar` e `storage/`. O download no computador complementa, não substitui, a cópia externa independente. Faça um ensaio de restauração isolado: não há garantia de recuperação completa da plataforma sem suas configurações e segredos externos guardados separadamente.

## Conferência de 26/11/2026

As execuções 45449863782 e 45661042448 geraram e enviaram os arquivos externos, mas não concluíram a recuperação independente. A execução 45661042448 registrou `Artifact not found for name`, apesar de o artefato existir no catálogo. O workflow passa a recuperar pelo ID exato devolvido pelo upload, eliminando a descoberta pelo nome nesta etapa. Continua obrigatório ler e verificar a cópia externa antes de anunciar sucesso. Isso não dispensa executar e confirmar uma nova cópia real e um ensaio de restauração.

A recuperação periódica alcança a última fotografia concluída, não os lançamentos posteriores. Recuperação até instantes antes da falha exige retenção de WAL/PITR no provedor e verificação própria dessa infraestrutura. A importação de um pacote não pode depender exclusivamente de o aplicativo de produção estar disponível.

## Conferência de recuperação pela administração (fase378)

Aplique `db/fase378_backup_restauracao_isolada.sql` depois das fases268/283. Em Manutenção → Backup dos dados, escolha uma cópia concluída e disponível e clique **Restaurar para conferência**. Confirme a importação em ambiente separado. O workflow `restauracao-fila.yml` consulta a fila a cada hora, usando os segredos já configurados no executor; pode ser iniciado manualmente pelo responsável técnico para antecipar a consulta. Não requer credenciais de acesso direto ao PostgreSQL de produção.

O executor lê o `.tar` criptografado já armazenado pelo sistema, compara tamanho e SHA-256, recusa links/caminhos/arquivos inesperados, autentica a criptografia e importa o dump em PostgreSQL descartável sem rede. O relatório compara conteúdo e quantidade de registros, código e anexos extraídos. A tela mostra os resultados agregados. O ambiente e os dados extraídos são descartados ao final; nenhum dado de produção é substituído. A fila só permite uma recuperação ativa, usa lease com expiração e restringe solicitações a administradores ativos. Uma falha não produz sucesso falso.

Esta opção importa cópias concluídas armazenadas pelo sistema; não recebe arquivos locais pelo navegador. A cópia salva no computador continua importável pelo procedimento técnico deste documento, com a chave guardada separadamente. Se o sistema estiver indisponível, o workflow independente `restauracao-teste.yml` e o procedimento técnico continuam sendo os caminhos de recuperação. Colocar um ambiente recuperado em uso exige preparar o projeto Supabase, segredos, autenticação e integrações e validar os processos; o botão não faz essa promoção automaticamente.

O ensaio real `45827712308`, executado em 26/11/2026 com a cópia externa `45827073218`, terminou com sucesso em todas as etapas de importação, restauração, comparação e descarte. Foram comparadas 197 tabelas e 69.016 registros, com 1.141 arquivos de código e índices válidos. A origem não tinha objetos de Storage; a recuperação de anexos reais não foi exercitada nessa cópia. Isso comprova o ensaio lógico daquela cópia, não uma troca de produção. A nova fila fase378 requer aplicação do SQL e teste integrado após instalação.

Ao recuperar pelo ID do artefato no workflow de backup, `merge-multiple: true` mantém os arquivos diretamente no diretório esperado pelo verificador, sem subpasta adicional do nome do artefato.
