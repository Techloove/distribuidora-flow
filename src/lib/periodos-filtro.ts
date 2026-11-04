import { dataBr } from "./formatacao";
import { deslocarDataISO } from "./integridade-consultas";
export function intervaloMes(mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || Number(mes.slice(0, 4)) < 1000)
    throw Error("Mês inválido");
  const [ano, numero] = mes.split("-").map(Number);
  return { de: `${mes}-01`, ate: new Date(Date.UTC(ano!, numero!, 0)).toISOString().slice(0, 10) };
}
export function atalhosPeriodo(hoje: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje) || dataBr(hoje) === "—") throw Error("Data inválida");
  const semana = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const segunda = deslocarDataISO(hoje, -((semana + 6) % 7));
  const mes = hoje.slice(0, 7),
    [ano, numero] = mes.split("-").map(Number);
  const anterior = new Date(Date.UTC(ano!, numero! - 2, 1)).toISOString().slice(0, 7);
  return [
    { id: "hoje", label: "Hoje", de: hoje, ate: hoje },
    { id: "semana", label: "Esta semana", de: segunda, ate: deslocarDataISO(segunda, 6) },
    { id: "mes", label: "Este mês", ...intervaloMes(mes) },
    { id: "mes-anterior", label: "Mês anterior", ...intervaloMes(anterior) },
    { id: "7dias", label: "Últimos 7 dias", de: deslocarDataISO(hoje, -6), ate: hoje },
    { id: "30dias", label: "Últimos 30 dias", de: deslocarDataISO(hoje, -29), ate: hoje },
    { id: "todos", label: "Todo o período", de: "", ate: "" },
  ];
}
export function mesDoIntervalo(de: string, ate: string) {
  const mes = de.slice(0, 7);
  try {
    const intervalo = intervaloMes(mes);
    return intervalo.de === de && intervalo.ate === ate ? mes : "";
  } catch {
    return "";
  }
}
export type CampoDataFiltro = { label: string; value: string; onChange: (v: string) => void };
export function paresDataFiltro(campos: CampoDataFiltro[]) {
  const grupos = new Map<string, { label: string; de?: CampoDataFiltro; ate?: CampoDataFiltro }>();
  for (const campo of campos) {
    const label = campo.label.trim();
    const match = /^(?:(.*) )?(de|até)$/iu.exec(label);
    if (!match) continue;
    const base = match[1] || "Datas";
    const key = base.toLocaleLowerCase("pt-BR");
    const grupo = grupos.get(key) ?? { label: base };
    if (match[2]!.toLocaleLowerCase("pt-BR") === "de") grupo.de = campo;
    else grupo.ate = campo;
    grupos.set(key, grupo);
  }
  return [...grupos.values()].filter(
    (g): g is { label: string; de: CampoDataFiltro; ate: CampoDataFiltro } => !!g.de && !!g.ate,
  );
}
