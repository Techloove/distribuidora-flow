import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { salvarBackupNoComputador } from "../src/lib/backup-download";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of [
    ["window", originalWindow],
    ["document", originalDocument],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const arquivo = {
  url: "https://fixture.test/backup",
  nome: "backup-2026.tar",
  bytes: 3,
  sha256: "a".repeat(64),
};

test("seletor de destino abre antes de obter link e só conclui após gravar todos os bytes", async () => {
  const etapas: string[] = [];
  const writer = new WritableStream({
    write() {
      etapas.push("gravou");
    },
    close() {
      etapas.push("concluiu");
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      showSaveFilePicker: async () => {
        etapas.push("escolheu");
        return { createWritable: async () => writer };
      },
    },
  });
  globalThis.fetch = (async () => new Response("abc")) as typeof fetch;
  expect(
    await salvarBackupNoComputador(async () => {
      etapas.push("obteve-link");
      return arquivo;
    }),
  ).toBe("salvo");
  expect(etapas).toEqual(["escolheu", "obteve-link", "gravou", "concluiu"]);
});

test("cancelar seletor não pede link e download truncado aborta o arquivo", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      showSaveFilePicker: async () => {
        throw new DOMException("Cancelado", "AbortError");
      },
    },
  });
  let pediu = false;
  expect(
    await salvarBackupNoComputador(async () => {
      pediu = true;
      return arquivo;
    }),
  ).toBe("cancelado");
  expect(pediu).toBe(false);
  let abortou = false;
  let fechou = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      showSaveFilePicker: async () => ({
        createWritable: async () =>
          new WritableStream({
            abort() {
              abortou = true;
            },
            close() {
              fechou = true;
            },
          }),
      }),
    },
  });
  globalThis.fetch = (async () => new Response("ab")) as typeof fetch;
  await expect(salvarBackupNoComputador(async () => arquivo)).rejects.toThrow("incompleto");
  expect(abortou).toBe(true);
  expect(fechou).toBe(false);
});

test("navegador sem seletor inicia download sem anunciar gravação concluída", async () => {
  const link = {
    href: "",
    download: "",
    rel: "",
    click() {
      clicou = true;
    },
    remove() {},
  };
  let clicou = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => link, body: { appendChild() {} } },
  });
  expect(await salvarBackupNoComputador(async () => arquivo)).toBe("iniciado");
  expect(clicou).toBe(true);
  expect(link.download).toBe(arquivo.nome);
  expect(link.rel).toBe("noreferrer");
});

test("servidor suporta Cloudflare, confere administrador e não segue redirecionamentos", () => {
  const script = `
    import { mock } from 'bun:test'; import assert from 'node:assert/strict';
    mock.module('@tanstack/react-start',()=>({createServerFn:()=>{const b={validator:()=>b,handler:fn=>fn};return b;}}));
    const {listarBackups,baixarBackup}=await import('./src/lib/backup.functions.ts');
    process.env.EXT_SUPABASE_URL='https://fixture.test';process.env.EXT_SUPABASE_ANON_KEY='anon-fixture';
    let role='admin',redirect=false,storage=0;
    const id='11111111-1111-4111-8111-111111111111',nome='backup-2026-10-27T03-00-00-000Z.tar';
    globalThis.fetch=async(input,options)=>{
      if(options.redirect==='error')throw new Error('Cloudflare rejeitou redirect error');
      const p=new URL(input).pathname;
      if(p==='/auth/v1/user')return Response.json({id});
      if(p==='/rest/v1/profiles')return Response.json([{ativo:true}]);
      if(p==='/rest/v1/user_roles')return Response.json([{role}]);
      if(p.endsWith('/consumir_rate_limit'))return Response.json(true);
      if(p.endsWith('/listar_backups_268')){assert.equal(options.redirect,'manual');return redirect?new Response(null,{status:302}):Response.json([]);}
      if(p.endsWith('/obter_download_backup_283'))return Response.json({objeto:id+'/'+nome,nome,sha256:'a'.repeat(64),bytes:123});
      if(p.startsWith('/storage/v1/object/sign/erp-backups/')){storage++;assert.equal(options.redirect,'manual');assert.equal(JSON.parse(options.body).expiresIn,120);return Response.json({signedURL:'/object/sign/erp-backups/'+id+'/'+nome+'?token=fixture'});}
      throw new Error('endpoint inesperado');
    };
    const data={accessToken:'user-fixture',id};
    assert.deepEqual(await listarBackups({data}),[]);
    const result=await baixarBackup({data});assert.equal(result.nome,nome);assert.equal(new URL(result.url).origin,'https://fixture.test');
    role='gestor';await assert.rejects(baixarBackup({data}),/permissão/);assert.equal(storage,1);
    role='admin';redirect=true;await assert.rejects(listarBackups({data}),/Redirecionamento/);
    console.log('OK');
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("OK");
});
