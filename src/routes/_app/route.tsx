import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moduloDaRota, useAcesso } from "@/lib/permissoes";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app")({ ssr: false, component: AppLayout });
function AppLayout() {
  const { session, loading, error, signOut } = useSupabase();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const acesso = useAcesso();
  const modulo = moduloDaRota(pathname);
  const bloqueado = !!session && !acesso.carregando && (!modulo || !acesso.pode(modulo));
  const destino = acesso.permitidos.has("/dashboard") ? "/dashboard" : [...acesso.permitidos][0];
  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);
  useEffect(() => {
    if (bloqueado && destino && !error && !acesso.erro && destino !== pathname)
      void navigate({ to: destino, replace: true });
  }, [bloqueado, destino, error, acesso.erro, pathname, navigate]);
  if (loading || (!error && session && acesso.carregando))
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted-foreground"
      >
        <Loader2 className="size-5 animate-spin" /> Verificando seu acesso…
      </div>
    );
  if (!session) return null;
  if (error || acesso.erro || bloqueado)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto size-9 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Acesso ao sistema</h1>
          <p role="alert" className="mt-3 text-sm text-muted-foreground">
            {error ??
              acesso.erro ??
              "Seu acesso aguarda liberação. Peça ao administrador para atribuir um perfil com os módulos necessários."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
            <Button
              variant="outline"
              onClick={() => {
                void signOut().catch((e: Error) => toast.error(e.message));
              }}
            >
              Sair
            </Button>
          </div>
        </section>
      </div>
    );
  return <Outlet />;
}
