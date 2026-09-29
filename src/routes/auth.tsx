import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  Loader2,
  Route as RouteIcon,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrar — Caparaó System" }] }),
  component: AuthPage,
});
function AuthPage() {
  const { client, session, loading, error } = useSupabase();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (session) void navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    try {
      const result = await client.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (result.error)
        throw new Error(
          "Não foi possível entrar. Confira suas credenciais e a confirmação do e-mail.",
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-32 top-24 size-[32rem] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-12 top-44 size-[22rem] rounded-full border border-white/10" />
        <div className="relative flex items-center gap-3">
          <Warehouse className="size-8 text-sidebar-primary" />
          <span className="text-xl font-semibold tracking-tight">Caparaó System</span>
        </div>
        <div className="relative max-w-lg py-20">
          <p className="text-xs font-semibold uppercase tracking-[.24em] text-sidebar-primary">
            Gestão para distribuidoras
          </p>
          <h1 className="mt-6 text-5xl font-semibold leading-[1.12] tracking-tight">
            Sua operação.
            <br />
            Toda conectada.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-sidebar-foreground/70">
            Do primeiro pedido à última entrega, acompanhe cada etapa em um só lugar.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              { icon: Boxes, name: "Estoque" },
              { icon: RouteIcon, name: "Rotas" },
              { icon: ShieldCheck, name: "Gestão" },
            ].map(({ icon: Icon, name }) => (
              <div key={name} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <Icon className="size-5 text-sidebar-primary" />
                <p className="mt-4 text-sm">{name}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-sidebar-foreground/50">
          Comercial · Operação · Financeiro
        </p>
      </section>
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 text-primary lg:hidden">
            <Warehouse className="size-7" />
            <span className="font-semibold">Caparaó System</span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Bem-vindo de volta
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Entre na sua conta</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Acesse o painel e acompanhe o dia a dia da sua distribuidora.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail corporativo</Label>
              <Input
                className="h-12 rounded-xl"
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                className="h-12 rounded-xl"
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <Button
              className="h-12 w-full rounded-xl"
              disabled={!client || loading || busy}
              type="submit"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}{" "}
              {busy ? "Entrando…" : "Acessar o sistema"}
            </Button>
          </form>
          <p className="mt-7 border-t pt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Precisa de acesso ou ajuda com sua senha?
            <br />
            Entre em contato com o administrador da sua empresa.
          </p>
        </div>
      </main>
    </div>
  );
}
