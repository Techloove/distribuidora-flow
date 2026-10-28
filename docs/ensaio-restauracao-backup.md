# Ensaio de restauração isolada

O workflow **Testar restauração isolada do backup** (`.github/workflows/restauracao-teste.yml`) executa somente por solicitação manual. Ele recebe o ID e a tentativa de uma execução de backup bem-sucedida, baixa seu artefato criptografado do GitHub e usa a chave de recuperação já cadastrada. Não requer acesso à API de administração do Supabase nem recebe endereço de banco de produção.

O banco é criado em uma máquina temporária do GitHub com imagem oficial Supabase PostgreSQL17, `--network none`, sem portas públicas. Os jobs cron ficam desativados e o worker de rede é direcionado a um banco inexistente. O ambiente não inicia os serviços de Auth, Storage ou integrações comerciais.

A restauração ocorre em três fases transacionais: estruturas, dados e índices/restrições. O replay dos dados desativa os gatilhos apenas no banco descartável para evitar que a carga recrie ou altere registros; os gatilhos são reativados pela própria ferramenta. Papéis globais ausentes no destino são preparados como placeholders `NOLOGIN`, sem recuperação de suas senhas ou privilégios globais. Donos e ACL dos objetos são restaurados pelo dump; isso não substitui o provisionamento de papéis do provedor no destino real.

A conferência compara quantidade e SHA-256 das linhas de cada seção COPY do dump com as mesmas colunas lidas do banco restaurado, preservando duplicações e ignorando apenas a ordem física. Também verifica índices, a presença do código versionado e os objetos de Storage extraídos. O relatório contém somente contagens, versão, imagem e identificação da execução — nenhum registro de cliente, senha, token, dump ou arquivo descriptografado é publicado como artefato.

A etapa final descarta o contêiner, os volumes e os arquivos descriptografados, inclusive quando o ensaio falha. O relatório permanece como artefato por trinta dias.

## Limites

Um resultado positivo comprova a restauração lógica e a equivalência do conteúdo efetivamente presente no dump. Não homologa login via Auth, provedores fiscais/bancários, funções remotas fora do repositório, recuperação de papéis globais ou descriptografia do Vault com as chaves raiz do projeto original. Essas configurações precisam de plano separado e teste em um projeto Supabase de recuperação. O ensaio nunca transmite dados ou executa comandos no banco de produção.
