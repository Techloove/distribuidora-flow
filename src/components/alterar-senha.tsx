import { useId, useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase-config.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { validarNovaSenha, mensagemTrocaSenha } from "@/lib/auth-senhas";

/** Permite alterar somente a senha da sessão atual, sem permissões administrativas. */
export function AlterarSenha({ compact }: { compact: boolean }) {
  const { client, user } = useSupabase();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function mudarAberto(value: boolean) {
    if (busy) return;
    setOpen(value);
    setAtual("");
    setNova("");
    setConfirmacao("");
    setErro(null);
  }

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !client || !user) return;
    setErro(null);
    const invalid = validarNovaSenha(nova, confirmacao, atual);
    if (invalid) return setErro(invalid);
    setBusy(true);
    try {
      // Confira a senha atual sem substituir a sessão do ERP.
      const config = await getSupabaseConfig();
      const verifier = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const verified = await verifier.auth.signInWithPassword({
        email: user.email ?? "",
        password: atual,
      });
      if (verified.error || verified.data.user?.id !== user.id) {
        setErro("Senha atual incorreta ou sessão inválida. Confira seus dados e tente novamente.");
        return;
      }
      const cleanup = await verifier.auth.signOut({ scope: "local" });
      if (cleanup.error) {
        setErro("Não foi possível concluir a verificação. Tente novamente.");
        return;
      }
      const { error } = await client.auth.updateUser({ password: nova, current_password: atual });
      if (error) {
        setErro(mensagemTrocaSenha(error.code));
        return;
      }
      setAtual("");
      setNova("");
      setConfirmacao("");
      setOpen(false);
      toast.success("Senha alterada com sucesso. Use a nova senha no próximo acesso.");
    } catch {
      setErro("Não foi possível conectar ao serviço. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={mudarAberto}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Alterar minha senha"
          title={compact ? "Alterar minha senha" : undefined}
          className={`mt-2 mr-1 inline-flex items-center gap-1.5 rounded-md border border-sidebar-border transition-colors hover:bg-sidebar-accent ${compact ? "justify-center p-1.5" : "px-2 py-1"}`}
        >
          <KeyRound className="size-3.5" />
          {!compact && "Alterar minha senha"}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar minha senha</DialogTitle>
          <DialogDescription>
            Atualize a senha da sua própria conta sempre que precisar. Use pelo menos 8 caracteres.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={salvar} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${id}-atual`}>Senha atual</Label>
              <Input
                id={`${id}-atual`}
                type="password"
                autoComplete="current-password"
                required
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-nova`}>Nova senha</Label>
              <Input
                id={`${id}-nova`}
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-confirmacao`}>Confirme a nova senha</Label>
              <Input
                id={`${id}-confirmacao`}
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
              />
            </div>
          </fieldset>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => mudarAberto(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !client || !user}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Salvando…" : "Salvar nova senha"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
