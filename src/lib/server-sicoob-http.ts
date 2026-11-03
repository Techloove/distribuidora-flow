// Exclusivo do servidor: mTLS com certificado A1. Nunca aceita endereço fornecido pelo cliente.
import { request } from "node:https";
import { createSecureContext } from "node:tls";
import { SICOOB_AUTH, SICOOB_BASE, SICOOB_SANDBOX, SICOOB_SCOPES } from "./sicoob-api";
export type CertificadoSicoob = { pfx?: string; senha?: string; sandbox_token?: string };
export function validarCertificadoSicoob(c: CertificadoSicoob) {
  if (
    !c.pfx ||
    c.pfx.length > 400000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(c.pfx) ||
    (c.senha?.length ?? 0) > 512
  )
    throw Error("Informe um certificado A1 .pfx válido, com até 280 KB.");
  try {
    createSecureContext({ pfx: Buffer.from(c.pfx, "base64"), passphrase: c.senha });
  } catch {
    throw Error("Não foi possível abrir o certificado A1. Confira o arquivo e a senha.");
  }
}
export type RespostaSicoob = { status: number; json: Record<string, unknown> };
export type TransporteSicoob = (
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  cert: CertificadoSicoob,
) => Promise<RespostaSicoob>;
export const transporteSicoob: TransporteSicoob = (endereco, method, headers, body, cert) =>
  new Promise((resolve, reject) => {
    const u = new URL(endereco);
    if (
      ![
        new URL(SICOOB_BASE).hostname,
        new URL(SICOOB_AUTH).hostname,
        new URL(SICOOB_SANDBOX).hostname,
      ].includes(u.hostname) ||
      u.protocol !== "https:" ||
      (u.port && u.port !== "443")
    )
      return reject(Error("Endereço Sicoob inválido."));
    const req = request(
      u,
      {
        method,
        headers,
        pfx: cert.pfx ? Buffer.from(cert.pfx, "base64") : undefined,
        passphrase: cert.senha,
        rejectUnauthorized: true,
        timeout: 15000,
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume();
          reject(Error("Redirecionamento bancário não permitido."));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (x: Buffer) => {
          bytes += x.length;
          if (bytes > 8 * 1024 * 1024) {
            req.destroy();
            reject(Error("Resposta Sicoob excedeu o limite."));
          } else chunks.push(x);
        });
        res.on("error", () =>
          reject(Error("Resposta bancária interrompida. Consulte a situação antes de repetir.")),
        );
        res.on("end", () => {
          const texto = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({
              status: res.statusCode ?? 0,
              json: texto ? (JSON.parse(texto) as Record<string, unknown>) : {},
            });
          } catch {
            reject(Error("Resposta Sicoob inválida. Consulte a situação antes de repetir."));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(Error("Tempo de resposta Sicoob esgotado. Consulte antes de repetir."));
    });
    req.on("error", () =>
      reject(
        Error(
          "Não foi possível conectar ao Sicoob com o certificado da loja. Confira a conexão e a validade do A1.",
        ),
      ),
    );
    if (body) req.write(body);
    req.end();
  });
export async function clienteSicoob(
  clientId: string,
  cert: CertificadoSicoob,
  io: TransporteSicoob = transporteSicoob,
  ambiente: "producao" | "homologacao" = "producao",
) {
  if (ambiente === "homologacao") {
    if (!cert.sandbox_token || !/^[A-Za-z0-9._~+/=:-]{8,16000}$/.test(cert.sandbox_token))
      throw Error("Informe o token fornecido pelo sandbox Sicoob.");
    return async (path: string, method = "GET", body?: Record<string, unknown>) => {
      if (
        !path.startsWith("/") ||
        path.includes("..") ||
        path.includes("\\") ||
        path.startsWith("//")
      )
        throw Error("Operação bancária inválida.");
      return io(
        SICOOB_SANDBOX + path,
        method,
        {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + cert.sandbox_token,
          client_id: clientId,
        },
        body ? JSON.stringify(body) : undefined,
        {},
      );
    };
  }
  validarCertificadoSicoob(cert);
  const token = await io(
    SICOOB_AUTH,
    "POST",
    { "Content-Type": "application/x-www-form-urlencoded" },
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      scope: SICOOB_SCOPES,
    }).toString(),
    cert,
  );
  if (
    token.status !== 200 ||
    typeof token.json["access_token"] !== "string" ||
    !token.json["access_token"]
  )
    throw Error(
      "Sicoob não autorizou a autenticação. Confira aplicativo, certificado e permissões de Cobrança Bancária v3.",
    );
  const bearer = token.json["access_token"];
  return async (path: string, method = "GET", body?: Record<string, unknown>) => {
    if (
      !path.startsWith("/") ||
      path.includes("..") ||
      path.includes("\\") ||
      path.startsWith("//")
    )
      throw Error("Operação bancária inválida.");
    return io(
      SICOOB_BASE + path,
      method,
      {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + bearer,
        client_id: clientId,
      },
      body ? JSON.stringify(body) : undefined,
      cert,
    );
  };
}
