import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Boxes, ShieldCheck, Truck, Warehouse } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ERP Distribuidora — Pedidos, Vendas, Financeiro e Logística" },
      {
        name: "description",
        content:
          "ERP modular para distribuidoras: cadastros, pedidos, faturamento, estoque, financeiro e logística com controle de acesso por papel.",
      },
      { property: "og:title", content: "ERP Distribuidora — Gestão comercial completa" },
      {
        property: "og:description",
        content:
          "Do cadastro do cliente à entrega e ao contas a receber, em um sistema único, seguro e rastreável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const modulos = [
  { icon: Boxes, title: "Cadastros", desc: "Clientes, produtos, representantes e empresas." },
  { icon: BarChart3, title: "Vendas", desc: "Pedidos, aprovação, tabelas de preço e comissões." },
  { icon: Truck, title: "Logística", desc: "Separação, expedição, romaneio e entrega." },
  { icon: ShieldCheck, title: "Segurança", desc: "Papéis, RLS e trilha de auditoria." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Warehouse className="size-6 text-primary" />
          <span className="font-semibold tracking-tight">ERP Distribuidora</span>
        </div>
        <Link
          to="/auth"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20 pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-foreground">
          Fase 1 · Cadastros base
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          Toda a operação da distribuidora em um só sistema
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted-foreground">
          Do cadastro do cliente e do produto ao pedido do representante, faturamento, expedição,
          entrega, contas a receber e comissões — com dados consistentes e rastreáveis.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Acessar o sistema
          </Link>
        </div>

        <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modulos.map((m) => (
            <article key={m.title} className="rounded-lg border border-border bg-card p-5">
              <m.icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold text-foreground">{m.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
