import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("preferências sincronizadas: usuário só lê e altera suas colunas, sem conceder acesso a anônimos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create function public.usuario_ativo() returns boolean language sql stable as $$select current_setting('app.active',true)='true'$$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`);
    const migration = readFileSync(
      new URL("../db/fase288_preferencias_colunas.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      `set role authenticated; set app.uid='00000000-0000-4000-8000-000000000001'; set app.active='true';`,
    );
    await db.exec(
      `insert into public.preferencias_colunas values(auth.uid(),'/produtos:lista','["Marca:0"]');`,
    );
    await expect(
      db.exec(
        `insert into public.preferencias_colunas values('00000000-0000-4000-8000-000000000002','/produtos:lista','[]');`,
      ),
    ).rejects.toThrow();
    await db.exec(`set app.uid='00000000-0000-4000-8000-000000000002';`);
    expect((await db.query("select * from public.preferencias_colunas")).rows).toHaveLength(0);
    await db.exec(
      `insert into public.preferencias_colunas values(auth.uid(),'/produtos:lista','[]');`,
    );
    await db.exec(`set app.uid='00000000-0000-4000-8000-000000000001';`);
    expect(
      (await db.query<{ ocultas: string[] }>("select ocultas from public.preferencias_colunas"))
        .rows[0]?.ocultas,
    ).toEqual(["Marca:0"]);
    await db.exec(`update public.preferencias_colunas set ocultas='[]';`);
    await expect(db.exec(`update public.preferencias_colunas set ocultas='{}';`)).rejects.toThrow();
    await db.exec(`set app.active='false';`);
    expect((await db.query("select * from public.preferencias_colunas")).rows).toHaveLength(0);
    await expect(
      db.exec(`insert into public.preferencias_colunas values(auth.uid(),'/clientes:lista','[]');`),
    ).rejects.toThrow();
    await db.exec("reset role; set role anon;");
    await expect(db.query("select * from public.preferencias_colunas")).rejects.toThrow();
  } finally {
    await db.close();
  }
});
