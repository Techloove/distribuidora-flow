import { useQuery } from "@tanstack/react-query";

import { useSupabase, type AppRole } from "@/lib/supabase-provider";

/** Todos os módulos do sistema, na ordem do menu. */
export const MODULOS: { path: string; label: string; grupo: string }[] = [
  { path: "/dashboard", label: "Dashboard", grupo: "Visão geral" },
  { path: "/pessoas", label: "Cadastro unificado / Clientes", grupo: "Cadastros" },
  { path: "/produtos", label: "Produtos", grupo: "Cadastros" },
  { path: "/tabelas-preco", label: "Promoção", grupo: "Cadastros" },
  { path: "/centros", label: "Centros", grupo: "Cadastros" },
  { path: "/rotas", label: "Rotas de entrega", grupo: "Cadastros" },
  { path: "/formas-pagamento", label: "Formas de pagamento", grupo: "Cadastros" },
  { path: "/cadastros-padrao", label: "Categorias, marcas e cidades", grupo: "Cadastros" },
  { path: "/descontos-peso", label: "Descontos por peso (kg)", grupo: "Cadastros" },
  { path: "/pedidos", label: "Pedidos", grupo: "Comercial" },
  { path: "/representantes", label: "Vendedores", grupo: "Comercial" },
  { path: "/lead-rota", label: "Lead Rota", grupo: "Comercial" },
  { path: "/metas", label: "Metas", grupo: "Comercial" },
  { path: "/comissoes", label: "Comissões", grupo: "Comercial" },

  { path: "/separacao", label: "Separação", grupo: "Operação" },
  { path: "/compras", label: "Compras e NF", grupo: "Operação" },
  { path: "/planejamento-compras", label: "Planejamento de compras", grupo: "Operação" },
  { path: "/estoque", label: "Estoque", grupo: "Operação" },
  { path: "/notas", label: "Faturamento / nota fiscal", grupo: "Operação" },
  { path: "/cargas", label: "Cargas de entrega", grupo: "Operação" },
  { path: "/expedicao", label: "Expedição", grupo: "Operação" },
  { path: "/faturamento", label: "Faturamento (boletos)", grupo: "Operação" },
  { path: "/devolucoes", label: "Devoluções", grupo: "Operação" },

  { path: "/financeiro", label: "Dashboard financeiro", grupo: "Financeiro" },
  { path: "/fluxo-caixa", label: "Fluxo de caixa", grupo: "Financeiro" },
  { path: "/contas", label: "Caixa e bancos", grupo: "Financeiro" },
  { path: "/categorias-financeiras", label: "Categorias de despesas", grupo: "Financeiro" },
  { path: "/movimentacoes", label: "Conciliação / movimentações", grupo: "Financeiro" },
  { path: "/dre", label: "DRE gerencial", grupo: "Financeiro" },
  { path: "/relatorios-financeiros", label: "Relatórios financeiros", grupo: "Financeiro" },
  { path: "/rota-despesas", label: "Custos de rota", grupo: "Financeiro" },
  { path: "/receber", label: "Contas a receber", grupo: "Financeiro" },
  { path: "/boletos", label: "Boletos", grupo: "Financeiro" },
  { path: "/conciliacao-creditos", label: "Conciliação de créditos", grupo: "Financeiro" },
  { path: "/pagar", label: "Contas a pagar", grupo: "Financeiro" },
  { path: "/relatorios", label: "Relatórios", grupo: "Gestão" },
  { path: "/relatorio-vendas", label: "Relatório de vendas", grupo: "Gestão" },

  { path: "/clientes-inativos", label: "Clientes sem comprar", grupo: "Gestão" },
  { path: "/notificacoes", label: "Notificações", grupo: "Gestão" },
  { path: "/usuarios", label: "Usuários e papéis", grupo: "Gestão" },
  { path: "/auditoria", label: "Auditoria", grupo: "Gestão" },
  { path: "/configuracoes", label: "Configurações", grupo: "Gestão" },
];

/** Papéis com acesso total ao sistema. */
export const PAPEIS_TOTAIS: AppRole[] = ["admin", "gestor"];

/** Padrão usado quando o banco ainda não tem a Fase 26 aplicada. */
export const MENUS_PADRAO: Record<AppRole, string[]> = {
  admin: MODULOS.map((m) => m.path),
  gestor: MODULOS.map((m) => m.path),
  financeiro: [
    "/dashboard",
    "/financeiro",
    "/contas",
    "/categorias-financeiras",
    "/movimentacoes",
    "/dre",
    "/relatorios-financeiros",
    "/rota-despesas",
    "/pessoas",
    "/faturamento",
    "/notas",
    "/boletos",
    "/conciliacao-creditos",
    "/fluxo-caixa",
    "/receber",
    "/pagar",
    "/relatorios",
    "/relatorio-vendas",
    "/notificacoes",
  ],
  comercial: [
    "/dashboard",
    "/pessoas",
    "/produtos",
    "/tabelas-preco",
    "/rotas",
    "/formas-pagamento",
    "/descontos-peso",
    "/pedidos",
    "/representantes",
    "/lead-rota",
    "/metas",
    "/comissoes",
    "/gestao-comissoes",
    "/relatorios",
    "/relatorio-vendas",
    "/clientes-inativos",
    "/notificacoes",
  ],
  representante: [
    "/dashboard",
    "/pessoas",
    "/produtos",
    "/tabelas-preco",
    "/pedidos",
    "/lead-rota",
    "/metas",
    "/comissoes",
  ],
  estoque: ["/dashboard", "/produtos", "/estoque", "/separacao", "/compras", "/planejamento-compras"],
  expedicao: ["/dashboard", "/separacao", "/cargas", "/expedicao", "/rotas"],
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
  const { client, roles, loading, user } = useSupabase();
  const total = roles.some((r) => PAPEIS_TOTAIS.includes(r));

  const q = useQuery({
    queryKey: ["role_menus", user?.id, roles.slice().sort().join(",")],
    enabled: !!client && roles.length > 0 && !total,
    queryFn: async () => {
      const { data, error } = await client!.from("role_menus").select("role, path").in("role", roles);
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
  const permitidos = new Set<string>(q.isError ? [] : (doBanco ?? []).map((r) => r.path));

  return {
    total: false,
    permitidos,
    carregando,
    erro: q.error?.message,
    pode: (path: string) => permitidos.has(path),
  };
}

/** Rotas que não aparecem no menu, mas herdam a permissão de outro módulo. */
const ALIASES: Record<string, string> = {
  "/clientes": "/pessoas",
  "/fornecedores": "/pessoas",
  "/transportadoras": "/pessoas",
  "/gestao-comissoes": "/comissoes",
  "/regras-comissao": "/comissoes",
  "/comissao-faixas": "/comissoes",
};

/** Descobre qual módulo controla a rota atual. */
export function moduloDaRota(pathname: string): string | null {
  for (const [alias, destino] of Object.entries(ALIASES)) {
    if (pathname === alias || pathname.startsWith(`${alias}/`)) return destino;
  }
  const achado = MODULOS.map((m) => m.path)
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return achado ?? null;
}
