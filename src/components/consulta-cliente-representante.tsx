import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSupabase } from "@/lib/supabase-provider";
import { consultarDocumento } from "@/lib/consulta-cadastral.functions";
import {
  consultarInscricaoEstadual,
  type RegistroFiscal,
} from "@/lib/inscricao-estadual.functions";
import { Button } from "@/components/ui/button";
const digitos = (v: string) => v.replace(/\D/g, "");
const normalizarIe = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, "");
export function ConsultaClienteRepresentante({
  documento,
  inscricao,
  ativo,
  disabled,
  preencher,
  aplicarIe,
  ocupado,
}: {
  documento: string;
  inscricao: string;
  ativo: boolean;
  disabled: boolean;
  preencher: (documento: string, dados: object) => void;
  aplicarIe: (documento: string, inscricao: string) => void;
  ocupado: (valor: boolean) => void;
}) {
  const { session } = useSupabase();
  const consultar = useServerFn(consultarDocumento);
  const consultarIe = useServerFn(consultarInscricaoEstadual);
  const doc = digitos(documento);
  const contexto = useRef({ doc, ativo });
  contexto.current = { doc, ativo };
  const ultimaConsulta = useRef("");
  const ultimaIe = useRef("");
  const [mensagem, setMensagem] = useState("");
  const [fiscal, setFiscal] = useState<{
    doc: string;
    registros: RegistroFiscal[];
    mensagem: string;
  } | null>(null);
  const buscar = useMutation({
    mutationFn: async (cnpj: string) => {
      const r = await consultar({
        data: {
          documento: cnpj,
          cadastroRepresentante: true,
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
      if (!r.ok) throw new Error(r.mensagem);
      return r;
    },
    onSuccess: (r) => {
      if (!contexto.current.ativo || contexto.current.doc !== r.documento) return;
      preencher(r.documento, r.dados);
      setMensagem(
        "Dados encontrados. Os campos vazios foram preenchidos; confira antes de cadastrar.",
      );
    },
    onError: (e: Error, cnpj) => {
      if (contexto.current.ativo && contexto.current.doc === cnpj)
        setMensagem(`${e.message} Você pode continuar preenchendo manualmente.`);
    },
  });
  const ie = useMutation({
    mutationFn: async (cnpj: string) => {
      const r = await consultarIe({
        data: {
          documento: cnpj,
          cadastroRepresentante: true,
          ...(session?.access_token ? { accessToken: session.access_token } : {}),
        },
      });
      if (!r.ok)
        throw new Error(
          "A consulta não conseguiu obter a inscrição estadual. Preencha se souber; o administrador revisará.",
        );
      return r;
    },
    onSuccess: (r) => {
      if (!contexto.current.ativo || contexto.current.doc !== r.documento) return;
      setFiscal({
        doc: r.documento,
        registros: r.registros,
        mensagem: r.registros.length
          ? "Confira a inscrição estadual vinculada a este CNPJ."
          : r.isento
            ? "A fonte informa que este estabelecimento não é contribuinte de ICMS. O administrador revisará os dados fiscais."
            : "A fonte não retornou uma inscrição estadual. Você pode preencher manualmente.",
      });
    },
    onError: (e: Error, cnpj) => {
      if (contexto.current.ativo && contexto.current.doc === cnpj)
        setFiscal({ doc: cnpj, registros: [], mensagem: e.message });
    },
  });
  const buscarCnpj = buscar.mutate;
  const buscarIe = ie.mutate;
  useEffect(() => {
    if (!ativo || disabled || doc.length !== 14 || ultimaConsulta.current === doc) return;
    const timer = setTimeout(() => {
      if (ultimaConsulta.current === doc) return;
      ultimaConsulta.current = doc;
      setMensagem("");
      buscarCnpj(doc);
    }, 600);
    return () => clearTimeout(timer);
  }, [doc, ativo, disabled, buscarCnpj]);
  useEffect(() => {
    const chave = `${doc}:${normalizarIe(inscricao)}`;
    if (
      !ativo ||
      disabled ||
      doc.length !== 14 ||
      !normalizarIe(inscricao) ||
      ultimaIe.current === chave
    )
      return;
    const timer = setTimeout(() => {
      if (ultimaIe.current === chave) return;
      ultimaIe.current = chave;
      buscarIe(doc);
    }, 800);
    return () => clearTimeout(timer);
  }, [doc, inscricao, ativo, disabled, buscarIe]);
  useEffect(() => {
    ocupado(buscar.isPending || ie.isPending);
    return () => ocupado(false);
  }, [buscar.isPending, ie.isPending, ocupado]);
  useEffect(() => {
    contexto.current.ativo = ativo;
    return () => {
      contexto.current.ativo = false;
    };
  }, [ativo]);
  const resultado = fiscal?.doc === doc ? fiscal : null;
  return (
    <section className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm">
      <p>
        Ao completar o CNPJ, o sistema busca os dados da empresa. A inscrição estadual é consultada
        pelo CNPJ; confira o registro encontrado antes de usar.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || doc.length !== 14 || buscar.isPending}
          onClick={() => {
            ultimaConsulta.current = doc;
            setMensagem("");
            buscar.mutate(doc);
          }}
        >
          {buscar.isPending ? "Consultando CNPJ…" : "Consultar CNPJ novamente"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || doc.length !== 14 || ie.isPending}
          onClick={() => {
            ultimaIe.current = `${doc}:${normalizarIe(inscricao)}`;
            ie.mutate(doc);
          }}
        >
          {ie.isPending ? "Consultando IE…" : "Consultar inscrição estadual"}
        </Button>
      </div>
      {buscar.isPending && <p role="status">Buscando dados para preencher o cadastro…</p>}
      {mensagem && ultimaConsulta.current === doc && <p role="status">{mensagem}</p>}
      {resultado && (
        <div className="space-y-2">
          <p role="status">{resultado.mensagem}</p>
          {resultado.registros.map((r) => (
            <div
              key={`${r.uf}:${r.inscricao}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
            >
              <p>
                <strong>{r.inscricao}</strong> · {r.uf || "UF não informada"}
                {r.situacao ? ` · ${r.situacao}` : ""}
                {normalizarIe(inscricao) === normalizarIe(r.inscricao)
                  ? " · corresponde à IE informada"
                  : ""}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  ultimaIe.current = `${doc}:${normalizarIe(r.inscricao)}`;
                  aplicarIe(doc, r.inscricao);
                }}
              >
                Usar esta IE
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A consulta não libera o cliente nem altera loja, rota, limite ou aprovação. Para CPF,
        preencha os dados manualmente.
      </p>
    </section>
  );
}
