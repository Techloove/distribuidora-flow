import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Printer, Search } from "lucide-react";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODULOS, useAcesso } from "@/lib/permissoes";
import topicos from "@/content/manual.json";
import { VERSAO_SISTEMA, VERSAO_ATUAL, HISTORICO_VERSOES } from "@/lib/versao";
export const Route = createFileRoute("/_app/ajuda")({
  head: () => ({ meta: [{ title: "Manual do usuário — Caparaó System" }] }),
  component: ManualPage,
});
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function ManualPage() {
  const acesso = useAcesso();
  const [busca, setBusca] = useState(""),
    [grupo, setGrupo] = useState(""),
    [selecionado, setSelecionado] = useState("primeiros-passos");
  const grupos = [...new Set(topicos.map((t) => t.grupo))];
  const resultados = useMemo(
    () =>
      topicos.filter(
        (t) =>
          (!grupo || t.grupo === grupo) &&
          normalizar([t.titulo, t.resumo, ...t.passos, ...t.cuidados].join(" ")).includes(
            normalizar(busca).trim(),
          ),
      ),
    [grupo, busca],
  );
  const atual = resultados.find((t) => t.id === selecionado) ?? resultados[0];
  return (
    <ErpLayout
      title="Manual do usuário"
      description={`Caparaó System · Versão ${VERSAO_SISTEMA}`}
      actions={
        <Button variant="outline" className="no-print" onClick={() => window.print()}>
          <Printer className="size-4" />
          Imprimir manual / salvar PDF
        </Button>
      }
    >
      <div className="space-y-5 no-print">
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <h2 className="font-semibold">Como usar o sistema</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Busque uma dúvida ou escolha um assunto. Os atalhos aparecem apenas para os módulos
            liberados no seu perfil.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1">
              <Label htmlFor="manual-busca">Buscar no manual</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="manual-busca"
                  className="pl-9"
                  placeholder="Ex.: estoque, pedido, entrega, backup..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-grupo">Assunto</Label>
              <select
                id="manual-grupo"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
              >
                <option value="">Todos os assuntos</option>
                {grupos.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
        <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
          <nav
            aria-label="Assuntos do manual"
            className="max-h-[65vh] space-y-1 overflow-auto rounded-xl border bg-card p-2"
          >
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {resultados.length} assuntos encontrados
            </p>
            {resultados.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={atual?.id === t.id}
                onClick={() => setSelecionado(t.id)}
                className={`block w-full rounded-lg p-3 text-left text-sm transition-colors ${atual?.id === t.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
              >
                <span className="block text-[11px] text-muted-foreground">{t.grupo}</span>
                {t.titulo}
              </button>
            ))}
          </nav>
          {atual ? (
            <article className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
              <div>
                <h2 className="text-xl font-semibold">{atual.titulo}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{atual.resumo}</p>
              </div>
              <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                {atual.passos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
              <section className="space-y-2 rounded-lg bg-muted/50 p-4">
                <h3 className="text-sm font-semibold">Confira também</h3>
                <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed">
                  {atual.cuidados.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </section>
              <div className="flex flex-wrap gap-2">
                {atual.modulos
                  .filter((m) => acesso.pode(m))
                  .map((m) => (
                    <Button key={m} asChild variant="outline" size="sm">
                      <Link to={m}>Abrir {MODULOS.find((x) => x.path === m)?.label ?? m}</Link>
                    </Button>
                  ))}
              </div>
            </article>
          ) : (
            <div role="status" className="rounded-xl border p-6">
              <p>Nenhum assunto encontrado. Tente outra palavra.</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => {
                  setBusca("");
                  setGrupo("");
                }}
              >
                Limpar busca
              </Button>
            </div>
          )}
        </div>
        <section className="space-y-3 rounded-xl border bg-card p-5" id="versoes">
          <h2 className="font-semibold">Versão e novidades</h2>
          <p className="text-sm text-muted-foreground">
            Versão instalada: <strong>{VERSAO_SISTEMA}</strong> · Publicação de referência:{" "}
            {VERSAO_ATUAL.data.split("-").reverse().join("/")}. Informe a versão ao pedir suporte.
          </p>
          {HISTORICO_VERSOES.map((v) => (
            <details key={v.versao} open={v.versao === VERSAO_SISTEMA}>
              <summary className="cursor-pointer py-2 text-sm font-medium">
                v{v.versao} · {v.titulo}
              </summary>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {v.novidades.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      </div>
      <div className="hidden print:block print-area">
        <h1 className="text-2xl font-semibold">Manual do usuário — Caparaó System</h1>
        <p>
          Versão {VERSAO_SISTEMA} · {VERSAO_ATUAL.data.split("-").reverse().join("/")}
        </p>
        <p className="my-4 text-sm">
          Orientações de uso. As permissões do seu perfil continuam sendo aplicadas no sistema.
        </p>
        {topicos.map((t) => (
          <section key={t.id} className="mb-8">
            <h2 className="mb-2 text-lg font-semibold">{t.titulo}</h2>
            <p className="mb-3 text-sm">{t.resumo}</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {t.passos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            <h3 className="mt-3 font-semibold">Confira também</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {t.cuidados.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ErpLayout>
  );
}
