import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — ERP Distribuidora" },
      {
        name: "description",
        content: "Acesse o ERP da distribuidora com e-mail e senha para gerenciar a operação.",
      },
      { property: "og:title", content: "Entrar — ERP Distribuidora" },
      { property: "og:description", content: "Acesso ao ERP de pedidos, vendas e logística." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { client, session, loading, error } = useSupabase();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: err } = await client.auth.signInWithPassword({ email, password: senha });
        if (err) throw new Error(err.message);
      } else {
        const { data, error: err } = await client.auth.signUp({
          email,
          password: senha,
          options: { data: { nome }, emailRedirectTo: window.location.origin + "/auth" },
        });
        if (err) throw new Error(err.message);
        if (!data.session) {
          // Sem sessão = confirmação de e-mail ativa no Supabase.
          // Tentamos entrar direto; se o projeto exigir confirmação, orientamos o usuário.
          const { error: loginErr } = await client.auth.signInWithPassword({
            email,
            password: senha,
          });
          if (loginErr) {
            setConfirmar(true);
            toast.error(
              "A confirmação de e-mail está ativada no Supabase. Desative em Authentication → Sign In / Providers → Email → Confirm email.",
            );
          }
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <Warehouse className="size-6 text-primary" />
          <span className="font-semibold tracking-tight">ERP Distribuidora</span>
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          {mode === "login" ? "Entrar no sistema" : "Criar acesso"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login"
            ? "Use seu e-mail e senha corporativos."
            : "O primeiro usuário cadastrado recebe o papel de administrador."}
        </p>

        {error ? (
          <p className="mt-4 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</p>
        ) : null}

        {confirmar ? (
          <div className="mt-4 space-y-2 rounded-md bg-accent/20 p-3 text-xs text-accent-foreground">
            <p className="font-medium">Confirmação de e-mail ainda ativada no Supabase</p>
            <p>
              O cadastro foi criado, mas o Supabase não libera o login sem confirmar o e-mail. No
              painel do projeto: <strong>Authentication</strong> → <strong>Sign In / Providers</strong>{" "}
              → <strong>Email</strong> → desmarque <strong>Confirm email</strong> e clique em{" "}
              <strong>Save</strong>. Depois volte aqui e entre com o mesmo e-mail e senha.
            </p>
            <a
              className="inline-block font-medium underline"
              href="https://supabase.com/dashboard/project/zviwittrjdwyczhutvjf/auth/providers"
              target="_blank"
              rel="noreferrer"
            >
              Abrir a configuração no Supabase
            </a>
          </div>
        ) : null}


        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "signup" ? (
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome completo</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || loading || !client}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-5 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "login" ? "Não tenho acesso — criar conta" : "Já tenho conta — entrar"}
        </button>
      </div>
    </div>
  );
}
