import { useQuery } from "@tanstack/react-query";

import { useSupabase, type AppRole } from "@/lib/supabase-provider";

export function normalizarModulo(path: string) {
  if (path === "/expedicao") return "/entregas";
  if (path === "/planejamento-compras") return "/compras";
  if (path === "/relatorios") return "/relatorio-vendas";
  return path === "/faturamento"
    ? "/boletos"
    : path === "/cobranca" || path === "/clientes-inativos" || path === "/lead-rota"
      ? "/agenda-comercial"
      : path;
}

/** Todos os módulos do sistema, na ordem do menu. */
export const MODULOS: { path: string; label: string; grupo: string }[] = [
  { path: "/dashboard", label: "Dashboard", grupo: "Visão geral" },
  { path: "/pendencias", label: "Central de pendências", grupo: "Visão geral" },
  { path: "/pessoas", label: "Cadastro unificado / Clientes", grupo: "Cadastros" },
  { path: "/produtos", label: "Produtos", grupo: "Cadastros" },
  { path: "/tabelas-preco", label: "Promoção", grupo: "Cadastros" },
  { path: "/centros", label: "Lojas", grupo: "Cadastros" },
  { path: "/rotas", label: "Rotas de entrega", grupo: "Cadastros" },
  { path: "/formas-pagamento", label: "Formas de pagamento", grupo: "Cadastros" },
  { path: "/cadastros-padrao", label: "Categorias, marcas e cidades", grupo: "Cadastros" },
  { path: "/descontos-peso", label: "Descontos por peso (kg)", grupo: "Cadastros" },
  { path: "/pedidos", label: "Pedidos", grupo: "Comercial" },
  { path: "/representantes", label: "Vendedores", grupo: "Comercial" },
  { path: "/agenda-comercial", label: "Agenda comercial", grupo: "Comercial" },
  { path: "/metas", label: "Metas", grupo: "Comercial" },
  { path: "/comissoes", label: "Comissões", grupo: "Comercial" },

  { path: "/separacao", label: "Separação", grupo: "Operação" },
  { path: "/cargas", label: "Cargas de entrega", grupo: "Operação" },
  { path: "/entregas", label: "Entregas", grupo: "Operação" },
  { path: "/devolucoes", label: "Devoluções", grupo: "Operação" },
  { path: "/notas", label: "Faturamento / nota fiscal", grupo: "Operação" },
  { path: "/compras", label: "Compras", grupo: "Operação" },
  { path: "/estoque", label: "Estoque", grupo: "Operação" },

  { path: "/financeiro", label: "Dashboard financeiro", grupo: "Financeiro" },
  { path: "/dre", label: "DRE gerencial", grupo: "Financeiro" },
  { path: "/relatorios-financeiros", label: "Relatórios financeiros", grupo: "Financeiro" },
  { path: "/receber", label: "Contas a receber", grupo: "Financeiro" },
  { path: "/pagar", label: "Contas a pagar", grupo: "Financeiro" },
  { path: "/boletos", label: "Boletos", grupo: "Financeiro" },
  { path: "/rota-despesas", label: "Custos de rota", grupo: "Financeiro" },
  { path: "/contas", label: "Caixa e bancos", grupo: "Financeiro" },
  { path: "/categorias-financeiras", label: "Categorias de despesas", grupo: "Financeiro" },
  { path: "/fluxo-caixa", label: "Fluxo de caixa", grupo: "Financeiro" },
  { path: "/movimentacoes", label: "Conciliação / movimentações", grupo: "Financeiro" },
  { path: "/conciliacao-creditos", label: "Conciliação de créditos", grupo: "Financeiro" },
  { path: "/relatorio-vendas", label: "Relatórios de Vendas", grupo: "Gestão" },

  { path: "/notificacoes", label: "Notificações", grupo: "Gestão" },
  { path: "/usuarios", label: "Usuários e papéis", grupo: "Gestão" },
  { path: "/auditoria", label: "Auditoria", grupo: "Gestão" },
  { path: "/configuracoes", label: "Manutenção do sistema", grupo: "Gestão" },
];

/** Papéis com acesso total ao sistema. */
export const PAPEIS_TOTAIS: AppRole[] = ["admin", "gestor"];

/** Padrão usado quando o banco ainda não tem a Fase 26 aplicada. */
export const MENUS_PADRAO: Record<AppRole, string[]> = {
  admin: MODULOS.map((m) => m.path),
  gestor: MODULOS.map((m) => m.path),
  financeiro: [
    "/dashboard",
    "/pendencias",
    "/financeiro",
    "/contas",
    "/categorias-financeiras",
    "/movimentacoes",
    "/dre",
    "/relatorios-financeiros",
    "/rota-despesas",
    "/pessoas",
    "/notas",
    "/boletos",
    "/conciliacao-creditos",
    "/fluxo-caixa",
    "/receber",
    "/agenda-comercial",
    "/pagar",
    "/relatorio-vendas",
    "/comissoes",
    "/notificacoes",
  ],
  comercial: [
    "/dashboard",
    "/pendencias",
    "/pessoas",
    "/produtos",
    "/tabelas-preco",
    "/rotas",
    "/formas-pagamento",
    "/cadastros-padrao",
    "/descontos-peso",
    "/pedidos",
    "/representantes",
    "/agenda-comercial",
    "/metas",
    "/comissoes",
    "/relatorio-vendas",
    "/notificacoes",
  ],
  representante: [
    "/dashboard",
    "/pendencias",
    "/pessoas",
    "/produtos",
    "/tabelas-preco",
    "/pedidos",
    "/agenda-comercial",
    "/metas",
    "/comissoes",
  ],
  estoque: ["/dashboard", "/pendencias", "/produtos", "/estoque", "/separacao", "/compras"],
  expedicao: ["/dashboard", "/pendencias", "/separacao", "/cargas", "/entregas", "/rotas"],
};

export type Acesso = {
  /** true = acesso total (admin/gestor) ou ainda carregando papéis */
  total: boolean;
  permitidos: Set<string>;
  carregando: boolean;
  erro?: string | undefined;
  pode: (path: string) => boolean;
};

/** Menus liberados para o usuário logado, conforme os papéis e a tabela role_menus. */
export function useAcesso(): Acesso {
  const { client, roles, loading, user, needsCadastro } = useSupabase();
  const total = roles.some((r) => PAPEIS_TOTAIS.includes(r));

  const q = useQuery({
    queryKey: ["role_menus", user?.id, roles.slice().sort().join(",")],
    enabled: !!client && roles.length > 0 && !total && !needsCadastro,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await client!
        .from("role_menus")
        .select("role, path")
        .in("role", roles);
      if (error) throw new Error("Não foi possível carregar as permissões.");
      return (data ?? []) as { role: AppRole; path: string }[];
    },
  });

  if (total) {
    return {
      total: true,
      permitidos: new Set(MODULOS.map((m) => m.path)),
      carregando: false,
      pode: () => true,
    };
  }

  const carregando = loading || (roles.length > 0 && q.isPending);
  const doBanco = q.data;
  const permitidos = new Set<string>(
    q.isError ? [] : (doBanco ?? []).map((r) => normalizarModulo(r.path)),
  );

  return {
    total: false,
    permitidos,
    carregando,
    erro: q.error?.message,
    // A ajuda é documentação: não libera um módulo operacional nem requer SQL novo.
    pode: (path: string) => podeModuloPermitido(path, permitidos),
  };
}

/** Rotas que não aparecem no menu, mas herdam a permissão de outro módulo. */
const ALIASES: Record<string, string> = {
  "/expedicao": "/entregas",
  "/planejamento-compras": "/compras",
  "/relatorios": "/relatorio-vendas",
  "/faturamento": "/boletos",
  "/lead-rota": "/agenda-comercial",
  "/cobranca": "/agenda-comercial",
  "/clientes-inativos": "/agenda-comercial",
  "/clientes": "/pessoas",
  "/fornecedores": "/pessoas",
  "/transportadoras": "/pessoas",
  "/gestao-comissoes": "/comissoes",
  "/regras-comissao": "/comissoes",
  "/comissao-faixas": "/comissoes",
};

/** Documentação herda o acesso ao sistema; não acrescenta rotinas operacionais. */
export function podeModuloPermitido(path: string, permitidos: ReadonlySet<string>) {
  return (path === "/ajuda" && permitidos.size > 0) || permitidos.has(ALIASES[path] ?? path);
}

/** Descobre qual módulo controla a rota atual. */
export function moduloDaRota(pathname: string): string | null {
  if (pathname === "/ajuda" || pathname.startsWith("/ajuda/")) return "/ajuda";
  for (const [alias, destino] of Object.entries(ALIASES)) {
    if (pathname === alias || pathname.startsWith(`${alias}/`)) return destino;
  }
  const achado = MODULOS.map((m) => m.path)
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return achado ?? null;
}
