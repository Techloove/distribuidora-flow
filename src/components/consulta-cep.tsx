import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { consultarCep } from "@/lib/consulta-cadastral.functions";
import { normalizarCep } from "@/lib/consulta-endereco";
import { useSupabase } from "@/lib/supabase-provider";

const campos = [
  ["logradouro", "Logradouro"],
  ["bairro", "Bairro"],
  ["cidade", "Município"],
  ["uf", "UF"],
  ["codigo_ibge", "Código IBGE"],
] as const;
export function ConsultaCep({
  form,
  patch,
}: {
  form: Record<string, string | boolean>;
  patch: (v: Record<string, string>) => void;
}) {
  const { session, canManage } = useSupabase();
  const consultar = useServerFn(consultarCep);
  const cep = normalizarCep(String(form["cep"] ?? ""));
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const busca = useMutation({
    mutationFn: async (consultado: string) => {
      const r = await consultar({
        data: { cep: consultado, accessToken: session?.access_token ?? "" },
      });
      if (!r.ok) throw new Error(r.mensagem);
      return { ...r, cep: consultado };
    },
    onSuccess: (r) =>
      setSelecionados(
        new Set(
          campos
            .filter(([k]) => r.dados[k] && r.dados[k] !== String(form[k] ?? ""))
            .map(([k]) => k),
        ),
      ),
  });
  const resultado = busca.data?.cep === cep ? busca.data : null;
  function aplicar() {
    if (!resultado || !canManage) return;
    const novos: Record<string, string> = {};
    for (const [k] of campos)
      if (selecionados.has(k) && resultado.dados[k]) novos[k] = resultado.dados[k]!;
    if (!Object.keys(novos).length) return;
    patch(novos);
    busca.reset();
    toast.success("Endereço preenchido. Confira o número do imóvel e salve o cadastro.");
  }
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Endereço pelo CEP</h3>
          <p className="text-xs text-muted-foreground">
            Informe o CEP no campo abaixo e consulte. Número e complemento são preenchidos
            manualmente.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canManage || cep.length !== 8 || busca.isPending}
          onClick={() => {
            busca.reset();
            busca.mutate(cep);
          }}
        >
          {busca.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Consultar CEP
        </Button>
      </div>
      {busca.isError && (
        <p role="alert" className="text-sm text-destructive">
          {busca.error.message}
        </p>
      )}
      {resultado && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Fonte: {resultado.provedor}. Selecione os campos que deseja preencher ou substituir.
          </p>
          {campos
            .filter(([k]) => resultado.dados[k])
            .map(([k, label]) => (
              <label key={k} className="flex min-w-0 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  checked={selecionados.has(k)}
                  onChange={(e) =>
                    setSelecionados((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(k);
                      else n.delete(k);
                      return n;
                    })
                  }
                />
                <span className="min-w-0 break-words">
                  <strong>{label}: </strong>
                  {resultado.dados[k]}
                  {form[k] && form[k] !== resultado.dados[k] ? (
                    <span className="block text-xs text-muted-foreground">
                      Atual: {String(form[k])}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          {!resultado.dados.logradouro && (
            <p className="text-sm">
              Este CEP é geral da localidade e não informa a rua. Preencha o logradouro e o número
              manualmente.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => busca.reset()}>
              Descartar consulta
            </Button>
            <Button size="sm" disabled={!canManage || !selecionados.size} onClick={aplicar}>
              Usar endereço do CEP
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
