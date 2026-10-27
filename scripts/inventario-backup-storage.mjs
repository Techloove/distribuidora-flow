/** Descoberta paginada; não mantém uma lista fixa de buckets ou objetos da aplicação. */
export async function inventariarStorage(request) {
  const buckets = [],
    objects = [],
    ids = new Set();
  for (let offset = 0; ; offset += 100) {
    const page = await (await request(`/storage/v1/bucket?limit=100&offset=${offset}`)).json();
    if (!Array.isArray(page) || page.length > 100)
      throw new Error("Paginação de buckets inválida.");
    for (const bucket of page) {
      if (typeof bucket.id !== "string" || ids.has(bucket.id))
        throw new Error("Bucket inválido ou repetido na paginação.");
      ids.add(bucket.id);
      if (bucket.id !== "erp-backups") buckets.push(bucket);
    }
    if (page.length < 100) break;
  }
  for (const bucket of buckets) {
    const folders = [""],
      paths = new Set();
    for (let index = 0; index < folders.length; index++) {
      const prefix = folders[index];
      for (let offset = 0; ; offset += 100) {
        const entries = await (
          await request("/storage/v1/object/list/" + encodeURIComponent(bucket.id), {
            method: "POST",
            body: JSON.stringify({
              prefix,
              limit: 100,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          })
        ).json();
        if (!Array.isArray(entries) || entries.length > 100)
          throw new Error("Lista de objetos inválida.");
        for (const object of entries) {
          if (
            typeof object.name !== "string" ||
            !object.name ||
            object.name.includes("/") ||
            [".", ".."].includes(object.name)
          )
            throw new Error("Nome de objeto inválido.");
          const name = prefix ? prefix + "/" + object.name : object.name;
          if (paths.has(name))
            throw new Error(
              "Storage alterado durante paginação. Execute novamente em janela controlada.",
            );
          paths.add(name);
          if (!object.id) folders.push(name);
          else
            objects.push({
              bucket: bucket.id,
              name,
              id: object.id,
              updated_at: object.updated_at ?? null,
              metadata: object.metadata ?? null,
            });
        }
        if (entries.length < 100) break;
      }
    }
  }
  buckets.sort((a, b) => a.id.localeCompare(b.id));
  objects.sort((a, b) => (a.bucket + "/" + a.name).localeCompare(b.bucket + "/" + b.name));
  return { buckets, objects };
}

export function assinaturaInventario(inventory) {
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, stable(value[key])]),
          )
        : value;
  return JSON.stringify(stable(inventory));
}
