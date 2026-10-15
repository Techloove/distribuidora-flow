import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
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
  CreditCard,
  FileText,
  PackageCheck,
  Route,
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
  Users,
  Warehouse,
  Wallet,
  Menu,
  Search,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

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
import { AlterarSenha } from "@/components/alterar-senha";

const nav = [
  {
    group: "Visão geral",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/pendencias", label: "Central de pendências", icon: Bell },
    ],
  },
  {
    group: "Cadastros",
    items: [
      { to: "/pessoas", label: "Cadastro Unificado", icon: Users },
      { to: "/produtos", label: "Produtos", icon: Package },
      { to: "/cadastros-padrao", label: "Categorias, marcas e cidades", icon: Tags },
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
      { to: "/pedidos", label: "Pedidos", icon: ClipboardList },
      { to: "/agenda-comercial", label: "Agenda comercial", icon: CalendarClock },
      { to: "/metas", label: "Metas", icon: Target },
      { to: "/comissoes", label: "Comissões", icon: Coins },
    ],
  },
  {
    group: "Operação",
    items: [
      { to: "/separacao", label: "Separação", icon: PackageCheck },
      { to: "/cargas", label: "Cargas de entrega", icon: Truck },
      { to: "/entregas", label: "Entregas", icon: PackageCheck },
      { to: "/devolucoes", label: "Devoluções", icon: Undo2 },
      { to: "/notas", label: "Faturamento / nota fiscal", icon: FileText },
      { to: "/compras", label: "Compras", icon: ShoppingCart },
    ],
  },
  {
    group: "Financeiro",
    items: [
      { to: "/financeiro", label: "Dashboard financeiro", icon: PiggyBank },
      { to: "/dre", label: "DRE gerencial", icon: BarChart3 },
      { to: "/relatorios-financeiros", label: "Relatórios financeiros", icon: FileText },
      { to: "/receber", label: "Contas a receber", icon: Wallet },
      { to: "/pagar", label: "Contas a pagar", icon: Coins },
      { to: "/boletos", label: "Boletos", icon: Barcode },
      { to: "/rota-despesas", label: "Custos de rota", icon: Route },
      { to: "/contas", label: "Caixa e bancos", icon: Landmark },
      { to: "/categorias-financeiras", label: "Categorias de despesas", icon: Tags },
      { to: "/fluxo-caixa", label: "Fluxo de caixa", icon: LineChart },
    ],
  },
  {
    group: "Gestão",
    items: [
      { to: "/relatorio-vendas", label: "Relatórios de Vendas", icon: BarChart3 },
      { to: "/notificacoes", label: "Notificações", icon: Bell },
      { to: "/usuarios", label: "Usuários e papéis", icon: ShieldCheck },
      { to: "/auditoria", label: "Auditoria", icon: ScrollText },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
] as const;

function CentroFiltro() {
  const { setCentro } = useCentro();
  const { centro, lista, todos, isLoading, error } = useCentroValido();

  return (
    <Select
      disabled={isLoading || !!error || lista.length === 0}
      value={centro || (todos ? "todos" : "")}
      onValueChange={(v) => setCentro(v === "todos" ? "" : v)}
    >
      <SelectTrigger className="w-full bg-background sm:w-[13rem]">
        <SelectValue
          placeholder={
            error
              ? "Falha ao carregar centros"
              : isLoading
                ? "Carregando centros…"
                : "Nenhum centro disponível"
          }
        />
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
  compact,
}: {
  pathname: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  email?: string | undefined;
  roles: readonly string[];
  compact: boolean;
}) {
  const acesso = useAcesso();
  const [search, setSearch] = useState("");
  const term = search
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    <>
      <div
        className={`flex items-center gap-2 border-b border-sidebar-border ${
          compact ? "justify-center px-1 py-2.5" : "px-2.5 py-2.5"
        }`}
      >
        <Warehouse className="size-5 shrink-0 text-sidebar-primary" />
        {!compact && (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight">Caparaó System</p>
            <p className="truncate text-[10px] text-sidebar-foreground/60">
              Sistema de Gestão Completa
            </p>
          </div>
        )}
      </div>
      {!compact && (
        <div className="px-2 pt-2.5">
          <label className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-white/5 px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-sidebar-foreground/60" />
            <input
              aria-label="Buscar módulo"
              placeholder="Buscar módulo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-sidebar-foreground/50"
            />
          </label>
        </div>
      )}
      <nav
        aria-label="Navegação principal"
        className={`scrollbar-none flex-1 overflow-y-auto ${
          compact ? "px-1 py-1.5" : "px-1.5 py-2"
        }`}
      >
        {nav
          .map((section) => ({
            group: section.group,
            items: section.items.filter(
              (item) =>
                acesso.pode(item.to) &&
                item.label
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .includes(term),
            ),
          }))
          .filter((section) => section.items.length > 0)
          .map((section, i) => (
            <div key={section.group} className={i > 0 ? "mt-2" : undefined}>
              {compact ? (
                i > 0 ? (
                  <div className="mx-auto mb-1 h-px w-5 bg-sidebar-border" />
                ) : null
              ) : (
                <p className="px-2 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                  {section.group}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                  return (
                    <Link
                      key={`${item.to}-${item.label}`}
                      aria-current={active ? "page" : undefined}
                      aria-label={compact ? item.label : undefined}
                      title={item.label}
                      to={item.to}
                      onClick={onNavigate}
                      className={`flex items-center rounded-lg text-[13px] leading-tight transition-colors ${
                        compact ? "justify-center p-1.5" : "gap-2 px-2 py-1.5"
                      } ${
                        active
                          ? "bg-sidebar-primary/15 font-semibold text-sidebar-primary ring-1 ring-inset ring-sidebar-primary/20"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!compact && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
      </nav>
      <div
        className={`border-t border-sidebar-border text-[11px] ${
          compact ? "px-1 py-2" : "px-2 py-2.5"
        }`}
      >
        {!compact && (
          <>
            <p className="truncate font-medium">{email}</p>
            <p className="mt-0.5 flex items-center gap-1 text-sidebar-foreground/60">
              <Boxes className="size-3" />
              {roles.length ? roles.join(", ") : "sem papel"}
            </p>
          </>
        )}
        <AlterarSenha compact={compact} />
        <button
          onClick={onSignOut}
          aria-label="Sair"
          title={compact ? "Sair" : undefined}
          className={`mt-2 inline-flex items-center gap-1.5 rounded-md border border-sidebar-border transition-colors hover:bg-sidebar-accent ${
            compact ? "justify-center p-1.5" : "px-2 py-1"
          }`}
        >
          <LogOut className="size-3.5" />
          {!compact && "Sair"}
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
  const { centro, lista, isLoading: centroLoading, error: centroError } = useCentroValido();
  const centroNome = centroError
    ? "Centro indisponível"
    : centroLoading
      ? "Carregando centro…"
      : !lista.length
        ? "Nenhum centro disponível"
        : centro
          ? (lista.find((c) => c.id === centro)?.nome ?? "Centro selecionado")
          : "Todos os centros permitidos";
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMinimo, setMenuMinimo] = useState(false);

  useEffect(() => {
    try {
      setMenuMinimo(window.localStorage.getItem("caparao-menu-minimo") === "1");
    } catch {
      // navegador bloqueou o armazenamento local: segue com o menu completo
    }
  }, []);

  function alternarMenu() {
    setMenuMinimo((atual) => {
      const novo = !atual;
      try {
        window.localStorage.setItem("caparao-menu-minimo", novo ? "1" : "0");
      } catch {
        // navegador bloqueou o armazenamento local: só não lembra da escolha
      }
      return novo;
    });
  }

  async function handleSignOut() {
    try {
      await signOut();
      await navigate({ to: "/auth", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sair.");
    }
  }

  return (
    <div className="erp-shell flex min-h-dvh bg-background">
      <a
        href="#conteudo-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-primary focus:p-4 focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex ${
          menuMinimo ? "w-11" : "w-52"
        }`}
      >
        <SidebarContent
          pathname={pathname}
          onSignOut={handleSignOut}
          email={user?.email}
          roles={roles}
          compact={menuMinimo}
        />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="flex w-80 max-w-[90vw] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SheetDescription className="sr-only">
            Acesse os módulos disponíveis para seu perfil.
          </SheetDescription>
          <SidebarContent
            pathname={pathname}
            onNavigate={() => setMenuOpen(false)}
            onSignOut={handleSignOut}
            email={user?.email}
            roles={roles}
            compact={false}
          />
        </SheetContent>
      </Sheet>

      <main id="conteudo-principal" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 bg-card/90 px-5 py-5 sm:items-center lg:px-9 lg:py-6">
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
              aria-label={menuMinimo ? "Expandir menu" : "Deixar menu mínimo"}
              title={menuMinimo ? "Expandir menu" : "Deixar menu mínimo"}
              onClick={alternarMenu}
              className="no-print -ml-1 hidden rounded-md border border-border p-1.5 text-foreground transition-colors hover:bg-accent md:inline-flex"
            >
              {menuMinimo ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-primary">
                Área de trabalho
              </p>
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p>
              ) : null}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <span
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
              aria-label="Centro em uso"
            >
              <Building2 className="size-3.5 shrink-0" />
              <span className="truncate">{centroNome}</span>
            </span>
            <CentroFiltro />
            {actions}
          </div>
        </header>
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
