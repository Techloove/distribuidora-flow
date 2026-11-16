// Somente dados sintéticos. Mede CPU local, não latência do sistema em produção.
import { performance } from "node:perf_hooks";
import {
  prepararTextoBusca,
  prepararTermoBusca,
  correspondeBuscaPreparada,
} from "../src/lib/busca-selecao";
import { indexarPrimeiro } from "../src/lib/indices-listas";
import { indexarBoletosAtuais, type BoletoDocumento } from "../src/lib/boletos-documento";
const medir = (fn: () => number) => {
  const inicio = performance.now();
  const resultado = fn();
  return { ms: Number((performance.now() - inicio).toFixed(2)), resultado };
};
const textos = Array.from(
  { length: 12000 },
  (_, i) => `Cliente ${i} · João Construções · 61.575.${String(i).padStart(3, "0")}/0001-76`,
);
const buscas = [
  "joao",
  "construcoes joao",
  "0001-76",
  "inexistente",
  "cliente 12",
  "61575",
  "joão",
  "constru",
  "000145",
  "joao cliente",
];
const antiga = (texto: string, busca: string) => {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const base = norm(texto),
    termo = norm(busca);
  if (!termo) return true;
  if (termo.split(/\s+/).every((p) => base.includes(p))) return true;
  const digitos = termo.replace(/\D/g, "");
  return /^[\d\s./-]+$/.test(termo) && !!digitos && base.replace(/\D/g, "").includes(digitos);
};
const buscaAntes = medir(() =>
  buscas.reduce((n, b) => n + textos.filter((t) => antiga(t, b)).length, 0),
);
const buscaDepois = medir(() => {
  const indice = textos.map(prepararTextoBusca);
  return buscas.reduce((n, b) => {
    const termo = prepararTermoBusca(b);
    return n + indice.filter((t) => correspondeBuscaPreparada(t, termo)).length;
  }, 0);
});
const clientes = Array.from({ length: 6000 }, (_, i) => ({ id: `cliente${i}`, nome: `Nome ${i}` }));
const titulos = Array.from({ length: 12000 }, (_, i) => ({ cliente_id: `cliente${i % 6000}` }));
const nomesAntes = medir(() =>
  titulos.reduce((n, t) => n + (clientes.find((c) => c.id === t.cliente_id)?.nome.length ?? 0), 0),
);
const nomesDepois = medir(() => {
  const indice = indexarPrimeiro(clientes, (c) => c.id);
  return titulos.reduce((n, t) => n + (indice.get(t.cliente_id)?.nome.length ?? 0), 0);
});
const boletos: BoletoDocumento[] = Array.from({ length: 6000 }, (_, i) => ({
  id: String(i),
  conta_receber_id: `conta${i % 2000}`,
  status: i % 3 ? "registrado" : "cancelado",
  created_at: `2026-11-${String((i % 16) + 1).padStart(2, "0")}`,
  valor: 100,
  banco: "sicredi",
  canal: "api",
  linha_digitavel: null,
  ambiente: "producao",
}));
const ativos = new Set(["pendente", "em_processamento", "registrado", "liquidado"]);
const ativo = (s: string) => ativos.has(s);
const ciclosAntes = medir(
  () =>
    boletos.filter(
      (b) =>
        boletos
          .filter((r) => r.conta_receber_id === b.conta_receber_id)
          .sort(
            (a, b) =>
              Number(ativo(b.status)) - Number(ativo(a.status)) ||
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          )[0]?.id === b.id,
    ).length,
);
const ciclosDepois = medir(() => {
  const indice = indexarBoletosAtuais(boletos);
  return boletos.filter((b) => indice.get(b.conta_receber_id)?.id === b.id).length;
});
for (const [a, b] of [
  [buscaAntes, buscaDepois],
  [nomesAntes, nomesDepois],
  [ciclosAntes, ciclosDepois],
])
  if (a!.resultado !== b!.resultado) throw Error("A otimização alterou os resultados.");
console.log(
  JSON.stringify(
    {
      tipo: "CPU local com dados sintéticos; inclui construção dos índices",
      busca: {
        opcoes: textos.length,
        termos: buscas.length,
        antes: buscaAntes,
        depois: buscaDepois,
      },
      nomes: {
        clientes: clientes.length,
        titulos: titulos.length,
        antes: nomesAntes,
        depois: nomesDepois,
      },
      ciclos: { boletos: boletos.length, antes: ciclosAntes, depois: ciclosDepois },
    },
    null,
    2,
  ),
);
