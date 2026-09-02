import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react";
import type { ReactNode } from "react";

import { useSupabase } from "@/lib/supabase-provider";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/representantes", label: "Representantes", icon: UserRound },
] as const;

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

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
          <Warehouse className="size-6 text-sidebar-primary" />
          <div>
            <p className="text-sm font-semibold tracking-tight">ERP Distribuidora</p>
            <p className="text-[11px] text-sidebar-foreground/60">Fase 1 — Cadastros</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {nav.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-4 text-xs">
          <p className="truncate font-medium">{user?.email}</p>
          <p className="mt-0.5 flex items-center gap-1 text-sidebar-foreground/60">
            <Boxes className="size-3" />
            {roles.length ? roles.join(", ") : "sem papel"}
          </p>
          <button
            onClick={handleSignOut}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-sidebar-border px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
          >
            <LogOut className="size-3.5" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
