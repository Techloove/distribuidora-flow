type ArquivoBackup = { url: string; nome: string; bytes: number; sha256: string };
type SalvarJanela = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};

/** O seletor é aberto no clique, antes das chamadas assíncronas que perdem a ativação do usuário. */
export async function salvarBackupNoComputador(obter: () => Promise<ArquivoBackup>) {
  let handle: FileSystemFileHandle | undefined;
  const picker = (window as SalvarJanela).showSaveFilePicker;
  if (picker) {
    try {
      handle = await picker.call(window, {
        suggestedName: `backup-caparao-${new Date().toISOString().slice(0, 10)}.tar`,
        types: [
          {
            description: "Backup criptografado do Caparaó System",
            accept: { "application/x-tar": [".tar"] },
          },
        ],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelado";
      // Alguns navegadores expõem a API, mas bloqueiam seu uso em páginas incorporadas.
      if (
        !(error instanceof DOMException) ||
        !["SecurityError", "NotSupportedError"].includes(error.name)
      )
        throw error;
    }
  }
  const arquivo = await obter();
  if (handle) {
    const response = await fetch(arquivo.url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new Error("Não foi possível baixar o arquivo do backup. Tente novamente.");
    const writer = await handle.createWritable();
    let bytes = 0;
    const medir = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        if (bytes !== arquivo.bytes)
          throw new Error("Download incompleto. O arquivo não foi salvo.");
      },
    });
    await response.body.pipeThrough(medir).pipeTo(writer);
    return "salvo";
  }
  const link = document.createElement("a");
  link.href = arquivo.url;
  link.download = arquivo.nome;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return "iniciado";
}
