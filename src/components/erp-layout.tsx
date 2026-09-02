import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Barcode,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  PackageCheck,
  Route,
  UserMinus,
  LayoutDashboard,
  LineChart,
  LogOut,
  Package,
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

const nav = [
  { group: "Visão geral", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Cadastros",
    items: [
      { to: "/pessoas", label: "Cadastro unificado", icon: Users },
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/tabelas-preco", label: "Promoção", icon: Tags },
      { to: "/centros", label: "Centros", icon: Building2 },
      { to: "/rotas", label: "Rotas de entrega", icon: Route },
      { to: "/formas-pagamento", label: "Formas de pagamento", icon: CreditCard },
    ],
  },
  {
    group: "Operação",
    items: [
      { to: "/pedidos", label: "Pedidos", icon: ClipboardList },
      { to: "/separacao", label: "Separação", icon: PackageCheck },
      { to: "/compras", label: "Compras / NF", icon: ShoppingCart },
      { to: "/planejamento-compras", label: "Planejamento de compras", icon: CalendarClock },
      { to: "/estoque", label: "Estoque", icon: Boxes },
      { to: "/expedicao", label: "Expedição", icon: Truck },
      { to: "/faturamento", label: "Faturamento (boletos)", icon: FileText },
      { to: "/devolucoes", label: "Devoluções", icon: Undo2 },
    ],
  },
  {
    group: "Financeiro",
    items: [
      { to: "/fluxo-caixa", label: "Fluxo de caixa", icon: LineChart },
      { to: "/receber", label: "Contas a receber", icon: Wallet },
      { to: "/boletos", label: "Boletos", icon: Barcode },
      { to: "/pagar", label: "Contas a pagar", icon: Coins },
      { to: "/comissoes", label: "Comissões", icon: UserRound },
    ],
  },
  {
    group: "Gestão",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/clientes-inativos", label: "Clientes sem comprar", icon: UserMinus },
      { to: "/metas", label: "Metas de vendas", icon: Target },
      { to: "/notificacoes", label: "Notificações", icon: Bell },
      { to: "/usuarios", label: "Usuários e papéis", icon: ShieldCheck },
      { to: "/auditoria", label: "Auditoria", icon: ScrollText },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
] as const;

function CentroFiltro() {
  const { client } = useSupabase();
  const { centro, setCentro } = useCentro();
  const centros = useQuery({
    queryKey: ["centros", "filtro"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  return (
    <Select value={centro || "todos"} onValueChange={(v) => setCentro(v === "todos" ? "" : v)}>
      <SelectTrigger className="w-full bg-background sm:w-[13rem]">
        <SelectValue placeholder="Centro de custo" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">Todos os centros</SelectItem>
        {(centros.data ?? []).map((c) => (
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
  email?: string;
  roles: string[];
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
        <Warehouse className="size-6 text-sidebar-primary" />
        <div>
          <p className="text-sm font-semibold tracking-tight">ERP Distribuidora</p>
          <p className="text-[11px] text-sidebar-foreground/60">Vendas · Estoque · Financeiro</p>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {nav.map((section) => (
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

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <SidebarContent
          pathname={pathname}
          onSignOut={handleSignOut}
          email={user?.email}
          roles={roles}
        />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="w-[17rem] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <div className="flex h-full flex-col">
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              onSignOut={handleSignOut}
              email={user?.email}
              roles={roles}
            />
          </div>
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1 overflow-x-hidden">
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
