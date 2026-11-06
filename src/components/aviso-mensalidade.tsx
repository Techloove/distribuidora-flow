import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Wrench } from "lucide-react";
import type { SaasStatus } from "@/lib/saas";
import { avisoMensalidade } from "@/lib/avisos-saas";
import { dataBr } from "@/lib/formatacao";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function AvisoMensalidade({ status }: { status: SaasStatus | null }) {
  if (!status || !(status.master || status.proprietario)) return null;
  const aviso = avisoMensalidade(status);
  return (
    <section
      role={aviso ? "alert" : "status"}
      className={
        aviso
          ? "mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-amber-500 bg-amber-50 p-5 text-amber-950 shadow-sm"
          : "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3 text-sm"
      }
    >
      <div className="flex min-w-0 gap-3">
        {aviso && <AlertTriangle aria-hidden="true" className="mt-1 size-6 shrink-0" />}
        <div>
          <h2 className={aviso ? "text-lg font-semibold" : "font-medium"}>
            {aviso?.titulo ?? "Mensalidade da plataforma"}
          </h2>
          {aviso && <p className="mt-1 text-base font-bold">{aviso.prazo}</p>}
          {status.vencimento && (
            <p className="mt-1 text-sm">
              Vencimento: {dataBr(status.vencimento)}
              {status.data_bloqueio && ` · Bloqueio a partir de ${dataBr(status.data_bloqueio)}`}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link to="/assinatura">Minha mensalidade</Link>
        </Button>
        {status.proprietario && (
          <Link to="/plataforma" className="text-sm underline">
            Painel SaaS
          </Link>
        )}
      </div>
    </section>
  );
}

export function AvisoInicialMensalidade({
  status,
  usuarioId,
  sessaoId,
}: {
  status: SaasStatus | null;
  usuarioId?: string | undefined;
  sessaoId?: string | undefined;
}) {
  const [aberto, setAberto] = useState(false);
  const visto = useRef("");
  const aviso = avisoMensalidade(status);
  useEffect(() => {
    if (!status || !usuarioId || !(status.master || status.proprietario)) {
      setAberto(false);
      return;
    }
    const chave = `mensalidade-aviso-login:${usuarioId}:${sessaoId ?? "sessao"}`;
    if (visto.current === chave) return;
    setAberto(false);
    visto.current = chave;
    try {
      if (sessionStorage.getItem(chave)) return;
      sessionStorage.setItem(chave, "visto");
    } catch {
      /* O aviso continua funcionando quando o navegador restringe o armazenamento. */
    }
    setAberto(!!avisoMensalidade(status));
  }, [status, usuarioId, sessaoId]);
  if (!aviso || !status) return null;
  return (
    <AlertDialog open={aberto} onOpenChange={setAberto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{aviso.titulo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p className="text-base font-bold text-destructive">{aviso.prazo}</p>
              <p>
                Vencimento: {dataBr(status.vencimento)}
                {status.data_bloqueio && ` · Bloqueio a partir de ${dataBr(status.data_bloqueio)}`}
              </p>
              <p>
                Consulte as faturas e as instruções de pagamento. O proprietário da plataforma
                confirma o recebimento.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Entendi</AlertDialogCancel>
          <Button asChild>
            <Link to="/assinatura" onClick={() => setAberto(false)}>
              Abrir Minha mensalidade
            </Link>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SistemaEmManutencao({
  atualizar,
  sair,
  carregando = false,
}: {
  atualizar: () => void;
  sair: () => void;
  carregando?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <section className="w-full max-w-lg space-y-5 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <Wrench aria-hidden="true" className="mx-auto size-10 text-primary" />
        <h1 className="text-2xl font-semibold">Sistema em Manutenção</h1>
        <p className="text-sm text-muted-foreground">
          O acesso está temporariamente indisponível. Tente novamente mais tarde ou procure o
          administrador da empresa.
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={atualizar} disabled={carregando}>
            Verificar novamente
          </Button>
          <Button variant="outline" onClick={sair}>
            Sair
          </Button>
        </div>
      </section>
    </main>
  );
}
