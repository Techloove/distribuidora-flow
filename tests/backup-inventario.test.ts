import { expect, test } from "bun:test";
import { inventariarStorage, assinaturaInventario } from "../scripts/inventario-backup-storage.mjs";

test("descobre buckets novos, pagina mais de cem objetos e pastas sem incluir backups recursivos", async () => {
  const buckets = Array.from({ length: 100 }, (_, i) => ({ id: `dados-${i}`, public: false }));
  buckets.push({ id: "erp-backups", public: false });
  const chamadas: string[] = [];
  const result = await inventariarStorage(async (path: string, options?: RequestInit) => {
    chamadas.push(path);
    const url = new URL(path, "https://fixture.test");
    if (url.pathname === "/storage/v1/bucket") {
      const offset = Number(url.searchParams.get("offset"));
      return Response.json(buckets.slice(offset, offset + 100));
    }
    const body = JSON.parse(String(options?.body));
    const objects =
      path.endsWith("/dados-0") && !body.prefix
        ? [
            ...Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: `arquivo-${i}` })),
            { id: null, name: "pasta" },
          ]
        : [{ id: "obj", name: "novo-dado" }];
    return Response.json(objects.slice(body.offset, body.offset + 100));
  });
  expect(result.buckets).toHaveLength(100);
  expect(result.objects).toHaveLength(201);
  expect(result.objects.some((o: { name: string }) => o.name === "arquivo-100")).toBe(true);
  expect(result.objects.some((o: { name: string }) => o.name === "pasta/novo-dado")).toBe(true);
  expect(chamadas.some((path) => path.includes("list/erp-backups"))).toBe(false);
});

test("paginação repetida e nomes inseguros falham sem omitir dados silenciosamente", async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  await expect(inventariarStorage(async () => Response.json(page))).rejects.toThrow("repetido");
  await expect(
    inventariarStorage(async (path: string) =>
      Response.json(
        path.startsWith("/storage/v1/bucket")
          ? [{ id: "privado" }]
          : [{ id: "obj", name: "../arquivo" }],
      ),
    ),
  ).rejects.toThrow("Nome de objeto inválido");
});

test("assinatura ignora ordem de propriedades mas identifica alterações nos dados", () => {
  expect(assinaturaInventario({ objects: [{ metadata: { size: 3, mimetype: "pdf" } }] })).toBe(
    assinaturaInventario({ objects: [{ metadata: { mimetype: "pdf", size: 3 } }] }),
  );
  expect(assinaturaInventario({ objects: [{ updated_at: "antes" }] })).not.toBe(
    assinaturaInventario({ objects: [{ updated_at: "depois" }] }),
  );
});
