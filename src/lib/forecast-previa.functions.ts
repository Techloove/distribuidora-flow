import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireServerAuth, requestAccessToken, enforceRateLimit } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import { montarPreviaForecast } from "./forecast-previa";

const entrada = z.object({ accessToken: z.string().optional(), nota: z.string().uuid() });

export const forecastPreviaHomologacao = createServerFn({ method: "POST" })
  .validator((data: unknown) => entrada.parse(data))
  .handler(async ({ data }) => {
    const token = data.accessToken || requestAccessToken() || "";
    await requireServerAuth(token, ["admin", "gestor", "financeiro"]);
    await enforceRateLimit(token, "forecast_previa", 20, 60);
    const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
    const anon = process.env["EXT_SUPABASE_ANON_KEY"];
    if (!url || !anon) throw new Error("Configuração Supabase indisponível no servidor.");
    // A própria sessão consulta o contexto autorizado. Sem service role e sem
    // chamar a Forecast: este fluxo não pode transmitir nem alterar uma nota.
    const r = await fetchWithTimeout(`${url}/rest/v1/rpc/contexto_homologacao_forecast_265`, {
      method: "POST",
      redirect: "error",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _nota: data.nota }),
    });
    if (!r.ok)
      throw new Error(
        "Não foi possível conferir esta nota. Verifique suas permissões, a loja, a carteira e a aplicação da fase265 no Supabase.",
      );
    const contexto: unknown = await r.json();
    return montarPreviaForecast(contexto);
  });
