type Cadastro = Record<string, unknown>;
const texto = (v: unknown) => String(v ?? "").trim();
const normal = (v: unknown) =>
  texto(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
/** Somente ausência de dados; não substitui validação fiscal ou consulta cadastral. */
export function camposFaltantesCliente(r: Cadastro): string[] {
  const faltas: string[] = [];
  const pf = normal(r["tipo_pessoa"]) === "PF";
  if (!texto(r["cnpj_cpf"]).replace(/\D/g, "")) faltas.push(pf ? "CPF" : "CNPJ");
  const pessoa = r["pessoa_fiscal"];
  const fiscal =
    pessoa && typeof pessoa === "object" && !Array.isArray(pessoa) ? (pessoa as Cadastro) : r;
  const icms = normal(fiscal["indicador_contribuinte_icms"]);
  const isento =
    /^(2|9)(?:\D|$)/.test(icms) ||
    /^(ISENTO|CONTRIBUINTE ISENTO)\b/.test(icms) ||
    icms.includes("NAO CONTRIBUINTE") ||
    ["ISENTO", "ISENTA"].includes(normal(fiscal["situacao_inscricao_estadual"]));
  if (!pf && !isento && !texto(r["inscricao_estadual"])) faltas.push("Inscrição estadual");
  if (r["loja_pendente"] === true) faltas.push("Loja");
  if (!texto(r["rota_id"])) faltas.push("Rota");
  if (!texto(r["representante_id"])) faltas.push("Representante");
  const endereco = [
    ["logradouro", "logradouro"],
    ["numero", "número"],
    ["bairro", "bairro"],
    ["cidade", "cidade"],
    ["uf", "UF"],
    ["cep", "CEP"],
  ].filter(([campo]) => !texto(r[campo!]));
  if (endereco.length) faltas.push(`Endereço (${endereco.map(([, label]) => label).join(", ")})`);
  return faltas;
}

export const PENDENCIAS_COMERCIAIS_CLIENTE = [
  {
    id: "cliente-sem-loja",
    filtro: "sem_loja",
    campo: "_cadastro_loja",
    label: "Clientes sem loja",
    filtroLabel: "Loja do cliente",
    sem: "Sem loja",
    com: "Com loja",
    detalhe: "Defina uma loja ou o compartilhamento entre lojas no Cadastro unificado.",
  },
  {
    id: "cliente-sem-rota",
    filtro: "sem_rota",
    campo: "_cadastro_rota",
    label: "Clientes sem rota",
    filtroLabel: "Rota do cliente",
    sem: "Sem rota",
    com: "Com rota",
    detalhe: "Rota de entrega não cadastrada.",
  },
  {
    id: "cliente-sem-representante",
    filtro: "sem_representante",
    campo: "_cadastro_representante",
    label: "Clientes sem representante",
    filtroLabel: "Representante do cliente",
    sem: "Sem representante",
    com: "Com representante",
    detalhe: "Representante não cadastrado.",
  },
  {
    id: "cliente-sem-limite",
    filtro: "sem_limite",
    campo: "_cadastro_limite",
    label: "Clientes sem limite de crédito",
    filtroLabel: "Limite de crédito do cliente",
    sem: "Sem limite (vazio ou zero)",
    com: "Com limite cadastrado",
    detalhe:
      "Limite de crédito não informado ou igual a zero. Somente o administrador pode definir o limite.",
  },
] as const;
export type FiltroPendenciaCliente = (typeof PENDENCIAS_COMERCIAIS_CLIENTE)[number]["filtro"];
export function filtroPendenciaCliente(value: unknown): FiltroPendenciaCliente | undefined {
  return PENDENCIAS_COMERCIAIS_CLIENTE.find((p) => p.filtro === value)?.filtro;
}
/** Ausência de configuração, não saldo de crédito disponível após as compras. */
export function pendenciasComerciaisCliente(r: Cadastro) {
  const limite = Number(r["limite_credito"]);
  return {
    sem_loja: r["loja_pendente"] === true,
    sem_rota: !texto(r["rota_id"]),
    sem_representante: !texto(r["representante_id"]),
    sem_limite: !Number.isFinite(limite) || limite <= 0,
  };
}
/** Campos virtuais exclusivos dos clientes; não são persistidos no cadastro. */
export function decorarPendenciasClientes(rows: Cadastro[]) {
  return rows.map((r) => {
    const faltas = pendenciasComerciaisCliente(r);
    return {
      ...r,
      ...Object.fromEntries(
        PENDENCIAS_COMERCIAIS_CLIENTE.map((p) => [
          p.campo,
          r["is_cliente"] === true ? (faltas[p.filtro] ? "sem" : "com") : "",
        ]),
      ),
      _cadastro_loja:
        r["is_cliente"] === true
          ? r["loja_pendente"] === true
            ? "sem"
            : texto(r["centro_id"])
              ? "especifica"
              : "compartilhado"
          : "",
      _cadastro_loja_id: r["is_cliente"] === true ? texto(r["centro_id"]) : "",
    };
  });
}
