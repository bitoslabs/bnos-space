#!/usr/bin/env node
/**
 * Development server with the same /b/* fallback used in production.
 * Run: node serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const BUSINESS_ROUTE = /^\/b\/[^/]+\/?$/;

function resolvePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = join(root, normalize(decoded));
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function fileAt(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function findFile(pathname) {
  const target = resolvePath(pathname);
  if (!target) return null;
  return (await fileAt(target)) || (await fileAt(join(target, "index.html")));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname === "/b") {
    response.writeHead(301, { Location: `/b/${url.search}` });
    response.end();
    return;
  }

  let file = await findFile(url.pathname);
  if (!file && (url.pathname === "/b/" || BUSINESS_ROUTE.test(url.pathname))) {
    file = join(root, "b", "index.html");
  }

  if (!file) {
    const body = await readFile(join(root, "404.html")).catch(
      () => Buffer.from("Not found")
    );
    response.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  const body = await readFile(file);
  response.writeHead(200, {
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  response.end(body);
});

server.listen(port, host, () => {
  console.log(`bnos.space → http://${host}:${port}`);
  console.log(`business pages → http://${host}:${port}/b/`);
});
