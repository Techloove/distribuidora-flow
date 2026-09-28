# Implantação e integração — atualização de 28/09/2026

As fases 79 (segurança), 80 (dashboard) e 81 (liquidação) foram aplicadas ao projeto Supabase CaparaoSystem em 25/09/2026. O histórico foi reconfirmado em 28/09/2026. As definições anteriores foram preservadas localmente; isso não substitui backup completo de dados com restauração testada.

Na validação inicial: 50 views consultadas como administrador autenticado; dashboard funcional; acesso anônimo e de identidade sem perfil negado ao dashboard e à liquidação; identidade sem perfil não visualizou produtos nem centros. Os testes usaram transações revertidas, sem criar usuários ou pagamentos reais.

A nova conferência confirmou zero funções SECURITY DEFINER executáveis por anon, zero views executando com os privilégios do proprietário e presença de dashboard_resumo. Permanecem pendentes os pontos de produção descritos na auditoria, incluindo multi-tenancy, autorização interna dos demais RPCs e emissão bancária idempotente.

Foram incorporadas as alterações da main até eec3699e4ec93115e13730cb18d519da6f6f133c: código IBGE, ajustes do CRUD, cadastros de pessoas/clientes e remoção dos itens duplicados do menu. As colunas codigo_ibge já existem em pessoas e clientes; não foi necessário reaplicar esse DDL. O arquivo fase79_codigo_ibge.sql é independente de fase79_seguranca_acesso.sql apesar da numeração coincidente.

O frontend ainda não foi publicado. O projeto Lovable indicado no README exige login com acesso ao projeto. O PR conserva o histórico da main e as alterações recentes do usuário.

