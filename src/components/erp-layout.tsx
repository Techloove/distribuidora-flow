import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Barcode,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  Compass,
  CreditCard,
  FileText,
  PackageCheck,
  Route,
  UserMinus,
  LayoutDashboard,
  LineChart,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Settings,
  Tags,
  Target,
  Undo2,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
  Warehouse,
  Wallet,
  Menu,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCentro } from "@/lib/centro-store";
import { useCentroValido } from "@/lib/centros-acesso";
import { useAcesso } from "@/lib/permissoes";
import { useSupabase } from "@/lib/supabase-provider";

const nav = [
  { group: "Visão geral", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Cadastros",
    items: [
      { to: "/pessoas", label: "Cadastro Unificado", icon: Users },
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/tabelas-preco", label: "Promoção", icon: Tags },
      { to: "/centros", label: "Centros", icon: Building2 },
      { to: "/rotas", label: "Rotas de entrega", icon: Route },
      { to: "/formas-pagamento", label: "Formas de pagamento", icon: CreditCard },
      { to: "/descontos-peso", label: "Descontos por peso (kg)", icon: Percent },
    ],
  },
  {
    group: "Comercial",
    items: [
      { to: "/pessoas", label: "Clientes", icon: Users },
      { to: "/pedidos", label: "Pedidos", icon: ClipboardList },
      { to: "/pessoas", label: "Vendedores", icon: UserRound },
      { to: "/lead-rota", label: "Lead Rota", icon: Compass },
      { to: "/metas", label: "Metas", icon: Target },
      { to: "/comissoes", label: "Comissões", icon: Coins },
      { to: "/gestao-comissoes", label: "Gestão de comissões", icon: Coins },

    ],
  },
  {
    group: "Operação",
    items: [
      { to: "/separacao", label: "Separação", icon: PackageCheck },
      { to: "/compras", label: "Compras / NF", icon: ShoppingCart },
      { to: "/planejamento-compras", label: "Planejamento de compras", icon: CalendarClock },
      { to: "/estoque", label: "Estoque", icon: Boxes },
      { to: "/notas", label: "Faturamento / nota fiscal", icon: FileText },
      { to: "/cargas", label: "Cargas de entrega", icon: Truck },
      { to: "/expedicao", label: "Expedição", icon: Truck },
      { to: "/faturamento", label: "Faturamento (boletos)", icon: FileText },
      { to: "/devolucoes", label: "Devoluções", icon: Undo2 },
    ],
  },
  {
    group: "Financeiro",
    items: [
      { to: "/financeiro", label: "Dashboard financeiro", icon: PiggyBank },
      { to: "/fluxo-caixa", label: "Fluxo de caixa", icon: LineChart },
      { to: "/contas", label: "Caixa e bancos", icon: Landmark },
      { to: "/categorias-financeiras", label: "Categorias de despesas", icon: Tags },
      { to: "/movimentacoes", label: "Conciliação / movimentações", icon: ArrowLeftRight },
      { to: "/dre", label: "DRE gerencial", icon: BarChart3 },
      { to: "/relatorios-financeiros", label: "Relatórios financeiros", icon: FileText },
      { to: "/rota-despesas", label: "Custos de rota", icon: Route },
      { to: "/receber", label: "Contas a receber", icon: Wallet },
      { to: "/creditos-clientes", label: "Créditos de clientes", icon: CreditCard },
      { to: "/boletos", label: "Boletos", icon: Barcode },
      { to: "/pagar", label: "Contas a pagar", icon: Coins },
    ],
  },
  {
    group: "Gestão",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/relatorio-vendas", label: "Relatório de vendas", icon: BarChart3 },

      { to: "/clientes-inativos", label: "Clientes sem comprar", icon: UserMinus },
      { to: "/notificacoes", label: "Notificações", icon: Bell },
      { to: "/usuarios", label: "Usuários e papéis", icon: ShieldCheck },
      { to: "/auditoria", label: "Auditoria", icon: ScrollText },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
] as const;

function CentroFiltro() {
  const { setCentro } = useCentro();
  const { centro, lista, todos } = useCentroValido();

  return (
    <Select
      value={centro || (todos ? "todos" : "")}
      onValueChange={(v) => setCentro(v === "todos" ? "" : v)}
    >
      <SelectTrigger className="w-full bg-background sm:w-[13rem]">
        <SelectValue placeholder="Centro de custo" />
      </SelectTrigger>
      <SelectContent>
        {todos ? <SelectItem value="todos">Todos os centros</SelectItem> : null}
        {lista.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  onSignOut,
  email,
  roles,
}: {
  pathname: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  email?: string | undefined;
  roles: readonly string[];
}) {
  const acesso = useAcesso();
  return (
    <>
      <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
        <Warehouse className="size-6 text-sidebar-primary" />
        <div>
          <p className="text-sm font-semibold tracking-tight">Caparaó System</p>
          <p className="text-[11px] text-sidebar-foreground/60">Sistema de Gestão Completa</p>
        </div>
      </div>
      <nav className="scrollbar-none flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {nav
          .map((section) => ({
            group: section.group,
            items: section.items.filter((item) => acesso.pode(item.to)),
          }))
          .filter((section) => section.items.length > 0)
          .map((section) => (
          <div key={section.group}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
              {section.group}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {

                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors md:py-2 ${
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-4 py-4 text-xs">
        <p className="truncate font-medium">{email}</p>
        <p className="mt-0.5 flex items-center gap-1 text-sidebar-foreground/60">
          <Boxes className="size-3" />
          {roles.length ? roles.join(", ") : "sem papel"}
        </p>
        <button
          onClick={onSignOut}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-sidebar-border px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
        >
          <LogOut className="size-3.5" />
          Sair
        </button>
      </div>
    </>
  );
}

export function ErpLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, roles, signOut } = useSupabase();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex ${
          sidebarCollapsed ? "w-0 overflow-hidden" : "w-64"
        }`}
      >
        <SidebarContent
          pathname={pathname}
          onSignOut={handleSignOut}
          email={user?.email}
          roles={roles}
        />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl">
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              onSignOut={handleSignOut}
              email={user?.email}
              roles={roles}
            />
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-4 py-4 sm:items-end sm:gap-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-2">
            <button
              type="button"
              aria-label="Abrir menu"
              onClick={() => setMenuOpen(true)}
              className="no-print -ml-1 rounded-md border border-border p-2 text-foreground md:hidden"
            >
              <Menu className="size-4" />
            </button>
            <button
              type="button"
              aria-label={sidebarCollapsed ? "Mostrar menu" : "Ocultar menu"}
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="no-print -ml-1 hidden rounded-md border border-border p-2 text-foreground transition-colors hover:bg-accent md:inline-flex"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p>
              ) : null}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <CentroFiltro />
            {actions}
          </div>
        </header>
        <div className="px-3 py-4 sm:px-6 sm:py-6">{children}</div>
      </main>
    </div>
  );
}
