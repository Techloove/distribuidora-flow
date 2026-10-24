import { BackupDados } from "@/components/backup-dados";
import { DiagnosticoIntegridade } from "@/components/diagnostico-integridade";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/configuracoes")({
  head: () => ({
    meta: [
      { title: "Manutenção do sistema — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Manutenção e diagnóstico do sistema. Configurações comerciais no cadastro de Lojas.",
      },
      { property: "og:title", content: "Manutenção do sistema — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Manutenção e diagnóstico do sistema.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { roles } = useSupabase();
  return (
    <ErpLayout
      title="Manutenção do sistema"
      description="Ferramentas administrativas e diagnóstico de integridade."
    >
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Configurações por loja</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Identificação, logo, regras comerciais, comissões e cobrança são configurados
          individualmente em Lojas.
        </p>
        <Link to="/centros" className="mt-3 inline-block font-medium underline">
          Abrir configurações das lojas
        </Link>
      </section>
      {roles.includes("admin") && <BackupDados />}
      {roles.includes("admin") && <LimparDados />}
      <DiagnosticoIntegridade />
    </ErpLayout>
  );
}

function LimparDados() {
  const { client } = useSupabase();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const limpar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("admin_limpar_dados", { _confirmacao: texto });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dados apagados. O sistema está pronto para um novo cadastro.");
      setTexto("");
      queryClient.clear();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="mt-6 rounded-lg border border-destructive/50 bg-card p-5">
      <h2 className="text-sm font-semibold text-destructive">Limpar dados do sistema</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Apaga todos os cadastros e movimentações: clientes, pessoas, fornecedores, produtos, rotas,
        pedidos, compras, notas, cargas, estoque, financeiro e comissões. Mantém usuários, papéis,
        centros de custo, dados da empresa, parâmetros, Sicredi, plano de contas, formas de
        pagamento e faixas de desconto. Esta ação não pode ser desfeita.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="confirmar-limpeza">Digite LIMPAR para confirmar</Label>
          <Input
            id="confirmar-limpeza"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="LIMPAR"
          />
        </div>
        <Button
          variant="destructive"
          disabled={texto !== "LIMPAR" || limpar.isPending}
          onClick={() => {
            if (confirm("Tem certeza? Todos os dados serão apagados definitivamente."))
              limpar.mutate();
          }}
        >
          {limpar.isPending && <Loader2 className="size-4 animate-spin" />} Apagar todos os dados
        </Button>
      </div>
    </section>
  );
}
