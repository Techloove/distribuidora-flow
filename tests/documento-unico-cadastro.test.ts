import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
test("mesmo documento com ou sem máscara não duplica, inclusive em atualização", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table pessoas(id int primary key,cnpj_cpf text unique)");
    const sql = readFileSync(
      new URL("../db/fase339_documento_unico_cadastro_cliente.sql", import.meta.url),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    await db.query("insert into pessoas values(1,$1)", ["32.455.966/0003-71"]);
    await expect(db.query("insert into pessoas values(2,$1)", ["32455966000371"])).rejects.toThrow(
      "duplicate",
    );
    await db.query("insert into pessoas values(3,$1)", ["012.345.678-90"]);
    await expect(
      db.query("update pessoas set cnpj_cpf=$1 where id=3", ["32455966000371"]),
    ).rejects.toThrow("duplicate");
    await db.exec("insert into pessoas values(4,null),(5,null),(6,''),(7,'   ')");
    await db.query("insert into pessoas values(8,$1)", ["AB.123.456/0001-90"]);
    await expect(db.query("insert into pessoas values(9,$1)", ["ab123456000190"])).rejects.toThrow(
      "duplicate",
    );
    await db.query("insert into pessoas values(10,$1)", ["AC123456000190"]);
    expect((await db.query("select cnpj_cpf from pessoas where id=1")).rows[0]?.cnpj_cpf).toBe(
      "32.455.966/0003-71",
    );
  } finally {
    await db.close();
  }
});
