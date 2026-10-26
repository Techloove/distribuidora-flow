import { useEffect, useState, type ReactNode } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { RefreshCw, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VERSAO_SISTEMA } from "@/lib/versao";
import {
  consultarAtualizacao,
  podeAtualizarNaEntrada,
  urlDaAtualizacao,
  type VersaoPublicada,
} from "@/lib/atualizacao-versao";
const CHAVE_TENTATIVA = "caparao-atualizacao-na-entrada";
/** Verifica antes de abrir formulários. Depois, novas publicações só exibem o aviso. */
export function AvisoAtualizacao({ children }: { children: ReactNode }) {
  const [nova, setNova] = useState<VersaoPublicada | null>(null),
    [recolhido, setRecolhido] = useState(false),
    [verificada, setVerificada] = useState(false);
  const mutacoes = useIsMutating();
  useEffect(() => {
    let ativo = true,
      consultando = false,
      ultimaConsulta = 0,
      primeira = true;
    const verificar = async () => {
      if (
        !ativo ||
        consultando ||
        document.visibilityState === "hidden" ||
        Date.now() - ultimaConsulta < 15_000
      )
        return;
      if (!navigator.onLine) {
        if (primeira) {
          primeira = false;
          setVerificada(true);
        }
        return;
      }
      consultando = true;
      ultimaConsulta = Date.now();
      const naEntrada = primeira;
      primeira = false;
      let recarregando = false;
      try {
        const v = await consultarAtualizacao(VERSAO_SISTEMA);
        if (!ativo) return;
        if (v) {
          setNova((anterior) => (!anterior || anterior.versao !== v.versao ? v : anterior));
          if (naEntrada) {
            let tentativa: string | null = null;
            try {
              tentativa = sessionStorage.getItem(CHAVE_TENTATIVA);
            } catch {
              /* URL também limita repetições. */
            }
            if (podeAtualizarNaEntrada(window.location.href, VERSAO_SISTEMA, v.versao, tentativa)) {
              try {
                try {
                  sessionStorage.setItem(CHAVE_TENTATIVA, `${VERSAO_SISTEMA}->${v.versao}`);
                } catch {
                  /* Navegador com storage restrito. */
                }
                window.location.replace(urlDaAtualizacao(window.location.href, v.versao));
                recarregando = true;
              } catch {
                /* Falha de navegação mantém o botão manual. */
              }
            }
          }
        }
      } finally {
        consultando = false;
        if (ativo && !recarregando) setVerificada(true);
      }
    };
    void verificar();
    const timer = window.setInterval(() => void verificar(), 60_000);
    const retomar = () => void verificar();
    window.addEventListener("focus", retomar);
    window.addEventListener("online", retomar);
    document.addEventListener("visibilitychange", retomar);
    return () => {
      ativo = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", retomar);
      window.removeEventListener("online", retomar);
      document.removeEventListener("visibilitychange", retomar);
    };
  }, []);
  useEffect(() => setRecolhido(false), [nova?.versao]);
  if (!verificada)
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted-foreground"
      >
        <RefreshCw className="size-5 animate-spin" />
        Verificando atualizações do sistema...
      </div>
    );
  const atualizar = () => {
    if (!nova || mutacoes > 0) return;
    if (
      window.confirm(
        "Atualizar o sistema agora? Salve os campos ainda não enviados antes de continuar. A página será recarregada; os dados já salvos permanecem no sistema.",
      )
    )
      window.location.replace(urlDaAtualizacao(window.location.href, nova.versao));
  };
  return (
    <>
      {children}
      {nova &&
        (recolhido ? (
          <Button
            className="no-print fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] shadow-lg"
            onClick={() => setRecolhido(false)}
          >
            <RefreshCw className="size-4" />
            Nova versão {nova.versao} disponível
          </Button>
        ) : (
          <aside
            aria-label="Atualização do sistema"
            role="status"
            aria-live="polite"
            className="no-print fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm space-y-3 rounded-xl border border-primary/30 bg-card p-4 text-card-foreground shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  <RefreshCw className="size-4 text-primary" />
                  Nova versão disponível
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Atual: {VERSAO_SISTEMA} · Nova: {nova.versao}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRecolhido(true)}
                aria-label="Recolher aviso de atualização"
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
            <p className="text-sm">{nova.titulo}</p>
            <p className="text-xs text-muted-foreground">
              Salve o que estiver preenchendo antes de atualizar. A atualização recarrega esta
              página.
            </p>
            {mutacoes > 0 && (
              <p className="text-xs text-muted-foreground">
                Aguarde a operação em andamento terminar.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={atualizar} disabled={mutacoes > 0}>
                Atualizar agora
              </Button>
              <Button variant="outline" onClick={() => setRecolhido(true)}>
                Depois
              </Button>
            </div>
          </aside>
        ))}
    </>
  );
}
