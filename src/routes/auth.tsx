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
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    try {
      const { error: err } = await client.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });
      if (err) throw new Error("Não foi possível entrar. Confira suas credenciais ou solicite acesso ao administrador.");
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
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">Entrar no sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use seu e-mail e senha corporativos. Novos acessos devem ser liberados por um administrador.
        </p>

        {error ? (
          <p className="mt-4 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</p>
        ) : null}


        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || loading || !client}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Entrar
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Precisa de acesso? Solicite ao administrador do sistema.
        </p>
      </div>
    </div>
  );
}
