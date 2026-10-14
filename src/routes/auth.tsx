import { useQuery } from "@tanstack/react-query";
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
  head: () => ({
    meta: [
      { title: "Entrar — Caparaó System" },
      {
        name: "description",
        content: "Entre no Caparaó System para acessar sua operação comercial e financeira.",
      },
      { property: "og:title", content: "Entrar — Caparaó System" },
      {
        property: "og:description",
        content: "Acesso à operação comercial e financeira do Caparaó System.",
      },
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
  const [cadastro, setCadastro] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const disponivel = useQuery({
    queryKey: ["cadastro-publico-disponivel"],
    enabled: !!client && cadastro,
    retry: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("cadastro_representante_disponivel_221");
      if (error || data !== true)
        throw new Error("Primeiro cadastro temporariamente indisponível. Procure o administrador.");
      return true;
    },
  });
  useEffect(() => {
    if (session && !cadastro && !busy && !enviado)
      void navigate({ to: "/dashboard", replace: true });
  }, [session, navigate, cadastro, busy, enviado]);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    try {
      if (cadastro) {
        if (disponivel.data !== true)
          throw new Error(
            "Primeiro cadastro temporariamente indisponível. Procure o administrador.",
          );
        if (!nome.trim() || nome.trim().length > 120 || telefone.trim().length > 30)
          throw new Error("Confira nome e telefone.");
        if (senha.length < 8 || senha !== confirmacao)
          throw new Error("Use uma senha com pelo menos 8 caracteres e confirme a mesma senha.");
        const result = await client.auth.signUp({
          email: email.trim(),
          password: senha,
          options: {
            data: { nome: nome.trim(), telefone: telefone.trim() },
            emailRedirectTo: window.location.origin + "/auth",
          },
        });
        if (result.error) {
          const code = result.error.code;
          throw new Error(
            code === "signup_disabled"
              ? "O primeiro cadastro está desabilitado. Procure o administrador."
              : code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
                ? "Aguarde alguns minutos antes de tentar novamente."
                : code === "weak_password"
                  ? "Escolha uma senha mais forte, conforme as regras de segurança."
                  : "Não foi possível solicitar o cadastro. Confira os dados e tente novamente ou procure o administrador.",
          );
        }
        setEnviado(true);
        setSenha("");
        setConfirmacao("");
        if (result.data.session) await client.auth.signOut();
      } else {
        const result = await client.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        });
        if (result.error)
          throw new Error(
            "Não foi possível entrar. Confira suas credenciais e a confirmação do e-mail.",
          );
      }
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
            {cadastro ? "Primeiro acesso" : "Bem-vindo de volta"}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            {cadastro ? "Cadastro de representante" : "Entre na sua conta"}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {cadastro
              ? "Solicite seu acesso. Todos os novos cadastros entram como representantes e dependem da autorização de um administrador."
              : "Acesse o painel e acompanhe o dia a dia da sua distribuidora."}
          </p>
          {error && !cadastro && (
            <p
              role="alert"
              className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {cadastro && disponivel.error && (
            <p role="alert" className="mt-6 text-sm text-destructive">
              {disponivel.error.message}
            </p>
          )}
          {enviado ? (
            <div role="status" className="mt-8 rounded-xl border bg-card p-5 space-y-3">
              <p className="font-semibold">Solicitação de cadastro recebida</p>
              <p className="text-sm text-muted-foreground">
                Se receber um e-mail de confirmação, confirme seu endereço. Aguarde a autorização do
                administrador para acessar o sistema.
              </p>
              <p className="text-xs text-muted-foreground">
                Caso este e-mail já tenha uma conta, entre com seus dados ou procure o
                administrador.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {cadastro && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome completo</Label>
                    <Input
                      id="nome"
                      className="h-12 rounded-xl"
                      autoComplete="name"
                      maxLength={120}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="telefone">Telefone (opcional)</Label>
                    <Input
                      id="telefone"
                      className="h-12 rounded-xl"
                      type="tel"
                      autoComplete="tel"
                      maxLength={30}
                      value={telefone}
                      onChange={(e) => setTelefone(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
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
                  autoComplete={cadastro ? "new-password" : "current-password"}
                  minLength={cadastro ? 8 : undefined}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
              </div>
              {cadastro && (
                <div className="space-y-2">
                  <Label htmlFor="confirmacao">Confirmar senha</Label>
                  <Input
                    id="confirmacao"
                    className="h-12 rounded-xl"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Use pelo menos 8 caracteres.</p>
                </div>
              )}
              <Button
                className="h-12 w-full rounded-xl"
                disabled={
                  !client ||
                  (!cadastro && loading) ||
                  busy ||
                  (cadastro && disponivel.data !== true)
                }
                type="submit"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}{" "}
                {busy ? "Aguarde…" : cadastro ? "Solicitar cadastro" : "Acessar o sistema"}
              </Button>
            </form>
          )}
          <Button
            className="mt-4 w-full"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setCadastro(!cadastro);
              setEnviado(false);
              setSenha("");
              setConfirmacao("");
            }}
          >
            {cadastro ? "Voltar para entrar" : "Não tenho cadastro · Primeiro acesso"}
          </Button>
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
