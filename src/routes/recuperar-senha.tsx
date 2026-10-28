import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { mensagemTrocaSenha, validarNovaSenha } from "@/lib/auth-senhas";

export const Route = createFileRoute("/recuperar-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recuperar senha — Caparaó System" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: RecuperarSenha,
});

function RecuperarSenha() {
  const { client, session, loading, passwordRecovery, signOut } = useSupabase();
  const navigate = useNavigate();
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salva, setSalva] = useState(false);

  async function sair() {
    try {
      await signOut();
      toast.success("Senha definida. Entre com seu e-mail e a nova senha.");
      await navigate({ to: "/auth", replace: true });
    } catch {
      setErro(
        "A senha foi salva. Não foi possível encerrar a sessão; tente Voltar para entrar novamente.",
      );
    }
  }
  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !client || !session || !passwordRecovery || salva) return;
    const invalid = validarNovaSenha(nova, confirmacao);
    if (invalid) return setErro(invalid);
    setErro(null);
    setBusy(true);
    try {
      // Não basta abrir a URL ou adicionar ?type=recovery. O SDK precisa validar
      // o link e emitir PASSWORD_RECOVERY; getUser revalida a sessão no Auth.
      const checked = await client.auth.getUser();
      if (checked.error || checked.data.user?.id !== session.user.id)
        throw new Error(
          "Link expirado ou sessão inválida. Solicite um novo link na tela de entrada.",
        );
      const result = await client.auth.updateUser({ password: nova });
      if (result.error) throw new Error(mensagemTrocaSenha(result.error.code));
      setNova("");
      setConfirmacao("");
      setSalva(true);
      await sair();
    } catch (error) {
      setErro(
        error instanceof Error ? error.message : "Não foi possível conectar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6">
        <h1 className="text-2xl font-semibold">Definir nova senha</h1>
        {loading ? (
          <p role="status">Verificando link de recuperação…</p>
        ) : salva ? (
          <>
            <p role="status">Sua nova senha foi salva.</p>
            <Button disabled={busy} onClick={() => void sair()}>
              Voltar para entrar
            </Button>
          </>
        ) : !passwordRecovery || !session ? (
          <>
            <p>
              Abra o link enviado ao seu e-mail. Se o link expirou ou já foi usado, solicite outro
              em Esqueci minha senha.
            </p>
            <Button asChild variant="outline">
              <Link to="/auth">Voltar para entrar</Link>
            </Button>
          </>
        ) : (
          <form className="space-y-4" onSubmit={salvar}>
            <p className="text-sm text-muted-foreground">
              Use pelo menos 8 caracteres. Esta ação altera somente a senha; a aprovação e as
              permissões continuam sob controle do administrador.
            </p>
            <fieldset className="space-y-4" disabled={busy}>
              <div className="space-y-2">
                <Label htmlFor="nova-senha">Nova senha</Label>
                <Input
                  id="nova-senha"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={nova}
                  onChange={(e) => setNova(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmar-senha">Confirme a nova senha</Label>
                <Input
                  id="confirmar-senha"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full">
                {busy ? "Salvando…" : "Salvar nova senha"}
              </Button>
            </fieldset>
          </form>
        )}
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
      </section>
    </main>
  );
}
