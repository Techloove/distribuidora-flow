import { describe, expect, test } from "bun:test";
import { atenderFaznotasAutomatico, consultarNfeAutomatica } from "../src/lib/server-faznotas-auto";

describe("consulta fiscal em segundo plano", () => {
  const job = {
    nota: "nota",
    actor: "responsavel",
    lease: "nonce",
    centro: "loja",
    cnpj: "123",
    recibo: "recibo/seguro",
  };
  function fixture(value: unknown = job, cnpj = "123", fail = false) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const paths: string[] = [];
    const io = {
      rpc: async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
        calls.push({ name, args });
        return (name === "faznotas_auto_reservar_260" ? value : null) as T;
      },
      credencial: async () => ({ cnpj, token: "sigiloso" }),
      consultar: async (_token: string, path: string) => {
        paths.push(path);
        if (fail) throw new Error("sigiloso");
        return { status: "003" };
      },
    };
    return { io, calls, paths };
  }
  test("sem reserva não acessa provedor", async () => {
    const f = fixture(null);
    expect(await consultarNfeAutomatica("secret", f.io)).toEqual({ consultadas: 0 });
    expect(f.paths).toEqual([]);
  });
  test("somente consulta recibo e persiste usando responsável e lease", async () => {
    const f = fixture();
    expect(await consultarNfeAutomatica("secret", f.io)).toEqual({ consultadas: 1 });
    expect(f.paths).toEqual(["/nfe/nota/recibo%2Fseguro/completa"]);
    expect(f.calls[1]?.args).toMatchObject({
      _acao: "consulta",
      _actor: job.actor,
      _lease: job.lease,
      _nota: job.nota,
    });
    expect(JSON.stringify(f.calls)).not.toContain("sigiloso");
  });
  test("credencial divergente e recibo ausente impedem chamada", async () => {
    for (const f of [fixture(job, "outra"), fixture({ ...job, recibo: "" })]) {
      await expect(consultarNfeAutomatica("secret", f.io)).rejects.toThrow("não concluída");
      expect(f.paths).toEqual([]);
      expect(f.calls[1]?.args._acao).toBe("falha");
    }
  });
  test("rede falha sem produzir autorização ou expor credencial", async () => {
    const f = fixture(job, "123", true);
    await expect(consultarNfeAutomatica("secret", f.io)).rejects.toThrow("não concluída");
    expect(f.calls[1]?.args._acao).toBe("falha");
    expect(JSON.stringify(f.calls)).not.toContain("sigiloso");
  });
  test("endpoint exige POST e bearer privado", async () => {
    expect((await atenderFaznotasAutomatico(new Request("https://local.test"))).status).toBe(405);
    const r = await atenderFaznotasAutomatico(
      new Request("https://local.test", { method: "POST" }),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
