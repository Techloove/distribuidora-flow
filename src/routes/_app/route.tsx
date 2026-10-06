import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moduloDaRota, useAcesso } from "@/lib/permissoes";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app")({ ssr: false, component: AppLayout });
function AppLayout() {
  const { client, session, loading, error, signOut, mustChangePassword, refreshPermissions } = useSupabase();
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [alterando, setAlterando] = useState(false);
  const [senhaErro, setSenhaErro] = useState("");
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
    if (bloqueado && !mustChangePassword && destino && !error && !acesso.erro && destino !== pathname)
      void navigate({ to: destino, replace: true });
  }, [bloqueado, mustChangePassword, destino, error, acesso.erro, pathname, navigate]);
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
  if (mustChangePassword) {
    const concluir = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!client || alterando) return;
      if (novaSenha.length < 8) {
        setSenhaErro("Use uma nova senha com pelo menos 8 caracteres.");
        return;
      }
      if (novaSenha === "123456") {
        setSenhaErro("A nova senha deve ser diferente da senha inicial.");
        return;
      }
      if (novaSenha !== confirmacao) {
        setSenhaErro("As senhas não conferem.");
        return;
      }
      setAlterando(true);
      setSenhaErro("");
      try {
        const troca = await client.auth.updateUser({ password: novaSenha });
        if (troca.error) throw new Error(troca.error.message);
        const fim = await client.rpc("concluir_primeiro_acesso_representante");
        if (fim.error) throw new Error(fim.error.message);
        setNovaSenha("");
        setConfirmacao("");
        await refreshPermissions();
        toast.success("Senha atualizada. Seu acesso está liberado.");
      } catch (err) {
        setSenhaErro(err instanceof Error ? err.message : "Não foi possível alterar a senha.");
      } finally {
        setAlterando(false);
      }
    };
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <form onSubmit={(e) => void concluir(e)} className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold">Altere sua senha inicial</h1>
          <p className="text-sm text-muted-foreground">
            Para proteger sua conta, defina uma senha pessoal antes de acessar o sistema.
          </p>
          <div className="space-y-2">
            <Label htmlFor="novaSenha">Nova senha</Label>
            <Input id="novaSenha" type="password" minLength={8} autoComplete="new-password"
              required value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmacaoSenha">Confirmar nova senha</Label>
            <Input id="confirmacaoSenha" type="password" minLength={8} autoComplete="new-password"
              required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
          </div>
          {senhaErro ? <p role="alert" className="text-sm text-destructive">{senhaErro}</p> : null}
          <Button className="w-full" type="submit" disabled={alterando}>
            {alterando ? "Alterando..." : "Salvar nova senha"}
          </Button>
          <Button type="button" variant="outline" className="w-full"
            onClick={() => void signOut().catch((err: Error) => toast.error(err.message))}>
            Sair
          </Button>
        </form>
      </div>
    );
  }
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
