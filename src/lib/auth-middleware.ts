import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { getSupabaseClient } from "./supabase-client";
import { authenticateRequest, requireRole } from "./auth.server";

export const authenticatedMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error("Entre na sua conta para continuar.");
    return next({ headers: { Authorization: `Bearer ${data.session.access_token}` } });
  })
  .server(async ({ next }) => {
    const auth = await authenticateRequest(getRequestHeader("authorization"));
    return next({ context: { auth } });
  });

export const financialMiddleware = createMiddleware({ type: "function" })
  .middleware([authenticatedMiddleware])
  .server(async ({ next, context }) => {
    requireRole(context.auth.roles, ["admin", "gestor", "financeiro"]);
    return next();
  });

export const registrationMiddleware = createMiddleware({ type: "function" })
  .middleware([authenticatedMiddleware])
  .server(async ({ next, context }) => {
    requireRole(context.auth.roles, ["admin", "gestor", "comercial", "representante"]);
    return next();
  });
