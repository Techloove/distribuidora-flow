import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { moduloDaRota, useAcesso } from "@/lib/permissoes";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useSupabase();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const acesso = useAcesso();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  const modulo = moduloDaRota(pathname);
  const bloqueado =
    !!session && !acesso.carregando && !acesso.total && !!modulo && !acesso.pode(modulo);

  useEffect(() => {
    if (!bloqueado) return;
    const destino = acesso.permitidos.has("/dashboard")
      ? "/dashboard"
      : ([...acesso.permitidos][0] ?? "/dashboard");
    navigate({ to: destino, replace: true });
  }, [bloqueado, acesso.permitidos, navigate]);

  if (loading || !session || acesso.carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando sessão...
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso a este módulo. Redirecionando...
      </div>
    );
  }

  return <Outlet />;
}
