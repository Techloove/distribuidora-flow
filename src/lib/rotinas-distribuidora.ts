export type Registro = Record<string, unknown>;

export function prioridadeComercial(r: Registro, hoje: string) {
  const ultima = String(r["ultima_compra"] ?? "");
  if (!ultima) return "Nunca comprou";
  const dias =
    (Date.parse(hoje + "T12:00:00Z") - Date.parse(ultima.slice(0, 10) + "T12:00:00Z")) / 86400000;
  if (dias >= 30) return "Reativar";
  if (Number(r["vendas_30"]) < Number(r["vendas_anteriores_30"]) * 0.8) return "Compra em queda";
  return "Acompanhar";
}

export type LinhaExtrato = { referencia: string; data: string; valor: number; descricao: string };
/** CSV explícito: referência estável do banco evita duplicar lançamentos no retry. */
export function lerExtratoCsv(texto: string): LinhaExtrato[] {
  const linhas: string[][] = [];
  let campos: string[] = [],
    campo = "",
    aspas = false,
    fechado = false;
  const fonte = texto.replace(/^\uFEFF/, "");
  if (fonte.length > 2_000_000) throw new Error("Arquivo excede o limite de importação.");
  for (let i = 0; i <= fonte.length; i++) {
    const c = fonte[i];
    if (aspas) {
      if (c === undefined) throw new Error("CSV com aspas não fechadas.");
      if (c === '"') {
        if (fonte[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          aspas = false;
          fechado = true;
        }
      } else campo += c;
      continue;
    }
    if (c === '"') {
      if (campo || fechado) throw new Error("Aspas em posição inválida no CSV.");
      aspas = true;
      continue;
    }
    if (c === ";" || c === "\n" || c === undefined) {
      campos.push(campo);
      campo = "";
      fechado = false;
      if (c !== ";") {
        if (campos.some((v) => v.trim())) linhas.push(campos);
        campos = [];
      }
    } else if (c !== "\r") {
      if (fechado && c.trim()) throw new Error("Texto após fechamento de aspas no CSV.");
      if (!fechado) campo += c;
    }
  }
  if (
    linhas
      .shift()
      ?.map((c) => c.trim().toLowerCase())
      .join(";") !== "referencia;data;valor;descricao"
  )
    throw new Error("Cabeçalho esperado: referencia;data;valor;descricao");
  if (!linhas.length || linhas.length > 1000) throw new Error("Importe de 1 a 1000 linhas.");
  const refs = new Set<string>();
  return linhas.map((campos, i) => {
    const referencia = campos[0]?.trim() ?? "";
    const data = campos[1]?.trim() ?? "";
    const textoValor = campos[2]?.trim() ?? "";
    const valor = Number(textoValor.replace(",", "."));
    const valida =
      /^\d{4}-\d{2}-\d{2}$/.test(data) &&
      !Number.isNaN(Date.parse(data)) &&
      new Date(data + "T12:00:00Z").toISOString().slice(0, 10) === data;
    if (
      campos.length !== 4 ||
      !referencia ||
      referencia.length > 200 ||
      refs.has(referencia) ||
      !valida ||
      !/^-?\d+(?:[.,]\d{1,2})?$/.test(textoValor) ||
      !Number.isFinite(valor) ||
      valor === 0 ||
      (campos[3]?.length ?? 0) > 1000
    )
      throw new Error(
        `Linha ${i + 2} inválida ou referência repetida. Use data AAAA-MM-DD e valor sem separador de milhar.`,
      );
    refs.add(referencia);
    return { referencia, data, valor, descricao: campos[3]?.trim() ?? "" };
  });
}

export function candidatosConciliacao(linha: Registro, movimentos: Registro[]) {
  return movimentos
    .filter(
      (m) =>
        m["conta_id"] === linha["conta_id"] &&
        m["status"] === "ativo" &&
        Math.round(Number(linha["valor"]) * 100) ===
          Math.round(Number(m["valor"]) * (m["tipo"] === "entrada" ? 100 : -100)),
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(String(a["data"])) - Date.parse(String(linha["data"]))) -
        Math.abs(Date.parse(String(b["data"])) - Date.parse(String(linha["data"]))),
    );
}
