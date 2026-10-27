# Backup manual e diário — fase268

Esta entrega acrescenta **Manutenção do sistema → Backup dos dados**, disponível exclusivamente a administradores ativos. O botão solicita uma cópia global de todas as lojas. Outros papéis, inclusive gestores e representantes, não podem solicitar, ler o histórico nem obter os arquivos. A interface nunca recebe credenciais, chaves ou caminhos do host. Com a fase283 instalada, administradores podem baixar o pacote criptografado por link temporário.

## Instalação

1. Execute manualmente no Supabase **apenas** `db/fase268_backup_administrativo.sql`. A migração é reaplicável e cria uma fila e histórico próprios; não altera os cadastros ou políticas das lojas. Publique o código da aplicação.
2. Prepare um host administrativo Linux com Node 24, cliente `pg_dump` compatível com o PostgreSQL, certificado CA válido e o repositório em `/opt/caparao-system`. Esse processo é separado do servidor web/Cloudflare. Não instale segredos de banco no frontend.
3. Crie o usuário de serviço `caparao-backup`, com leitura do código e escrita somente nos diretórios privados necessários. Prepare `/var/lib/caparao-backups` e um destino externo privado, montado em `/mnt/caparao-backup`. Configure a montagem do volume remoto no sistema operacional; ajuste `RequiresMountsFor` e `ReadWritePaths` nas unidades se usar outro caminho. **Uma pasta no mesmo disco não é uma cópia externa.** A verificação do script não comprova a localização física do volume; o administrador deve conferir a montagem.
4. Preencha um arquivo privado `/etc/caparao-backup.env`, usando `infra/backup/backup.env.example` como modelo. Restrinja sua leitura ao responsável pela infraestrutura. Não envie valores por chat ou os versione. Guarde `ERP_BACKUP_KEY` separadamente do destino e com recuperação documentada: sem ela os backups não abrem. Veja também `docs/backup_recuperacao.md`.
5. Copie as quatro unidades `.service`/`.timer` de `infra/backup` para `/etc/systemd/system`, revise os caminhos e execute `systemctl daemon-reload`. Primeiro teste `systemctl start caparao-backup.service` e confira o histórico e o destino externo. Depois ative `systemctl enable --now caparao-backup.timer caparao-backup-fila.timer`.

O timer diário solicita backup às **03h de Brasília**, com atraso aleatório de até cinco minutos. O timer da fila verifica solicitações manuais aproximadamente a cada minuto. `Persistent=true` permite atender o diário perdido após reiniciar o host. As unidades têm limite de seis horas; a reserva no banco expira após sete horas. Ajustes para bases maiores devem manter a reserva superior ao limite do processo.

Nenhuma instalação, credencial, agendamento ou cópia de produção foi ativada nesta entrega. Sem executor configurado, o botão registra **Aguardando executor**, sem afirmar que há backup. Não é necessário executar SQL de dados reais para testar o código local.

## Execução e resultado

O executor administrativo usa `assumir_backup_268` para reservar uma única solicitação, gera um dump personalizado de todos os schemas exportáveis do banco, sem lista fixa e copia todos os objetos dos buckets, inclusive privados. Arquivos e manifesto são criptografados com AES-256-GCM. Verifica a integridade local, copia para uma pasta externa temporária, verifica novamente e só então publica a pasta final e registra sucesso no sistema. Não apaga backups antigos automaticamente.

A fila evita duplicação de solicitações e limita novas solicitações a uma a cada cinco minutos. O bloqueio local impede que uma execução direta concorra com o executor no mesmo host. Use um único host executor. Uma reserva expirada é marcada como falha quando o executor retorna, sem presumir sucesso ou repetir automaticamente a tarefa interrompida. O responsável pode solicitar uma nova execução após revisar o incidente.

As funções de execução aceitam apenas `service_role`, mantido no host administrativo. O banco confia no resultado enviado por esse executor; a verificação criptográfica ocorre no host. Se uma cópia foi concluída mas a comunicação final falhar, o histórico pode continuar em execução e depois indicar falha. Confira o `status.json` privado e a cópia externa antes de conciliar o incidente. A interface não inventa sucesso.

Para execução administrativa direta, sem registro na fila, configure as mesmas variáveis e rode `npm run backup:run`. Para execução com histórico use `node scripts/executor-backup.mjs --agendar`; sem `--agendar`, atende apenas uma solicitação pendente. Não use o comando direto como agendamento paralelo.

## Operação e recuperação

Configure monitoramento externo de saída não zero, unidades com falha, backups ausentes e espaço disponível. O histórico da aplicação não substitui alerta quando o próprio sistema está indisponível. Os modelos não enviam alertas por email nem configuram retenção. Defina retenção, versionamento e proteção contra exclusão no armazenamento externo.

Se houver interrupção abrupta, confira se nenhum processo está ativo antes de remover `.rotina.lock`. Preserve/revise pastas `.partial`; elas não são backups concluídos. Falhas controladas descartam apenas o estágio criado pela execução atual. O script não remove cópias concluídas.

O backup abrange dados sensíveis, permissões e credenciais persistidas no banco. Deve permanecer privado e criptografado. Ele não emite notas, não chama a Forecast/Sicredi, não altera estoque nem títulos. Dump e Storage são lidos separadamente: coordene gravações ou uma janela controlada para consistência entre ambos. O dump atual preserva donos e grants e inclui o código do commit Git do executor, mas não define papéis globais nem configura o provedor. Prepare os papéis e a infraestrutura no destino. Autenticação, RLS, lojas e carteiras precisam ser verificadas após a recuperação.

Siga `docs/backup_recuperacao.md` para verificação, extração e restauração **em projeto isolado**. Testes reais de restauração são necessários antes de considerar o processo homologado. Não há restauração destrutiva disponível na interface. Mantenha os executores e timers desligados no projeto restaurado de teste, para não processar a fila copiada nem acessar integrações de produção.

## Verificação local

- `npm run check:backup`: geração e extração com banco/Storage sintéticos, rejeição de chave errada e adulteração; rotina com cópia verificada, destinos inválidos, concorrência e falha durante verificação externa.
- `node scripts/check-backup-database.cjs`: exige `@electric-sql/pglite` disponível no ambiente de validação; verifica migração reaplicável, acesso administrativo, fila única, reservas, expiração e histórico sem segredos.
- Tipagem, build e verificações de segurança da aplicação.


## Atualização fase283 — download manual

Aplique também `db/fase283_backup_download_privado.sql`, mantenha o host com Git/tar e checkout atualizado e configure `ERP_BACKUP_PUBLICAR_DOWNLOAD=true` conforme `infra/backup/backup.env.example`. O bucket é privado e as políticas negam leitura a não administradores e gravação/exclusão aos usuários da aplicação, mesmo se houver políticas amplas antigas. Apenas uma execução com cópia externa e upload verificados oferece **Salvar no computador**. Consulte `docs/backup_recuperacao.md` para limites, extração e guarda da chave. Os scripts continuam sem ativar infraestrutura de produção automaticamente.
