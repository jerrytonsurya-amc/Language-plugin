/**
 * Local dev: static files from public/ + POST /api/translate (Gemini).
 * Usage: npm run dev   (reads GEMINI_API_KEY from .env.local, which is gitignored)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseRequest, translateTexts } = require("../functions/translate-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3456);

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}

loadEnvLocal();

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".png": "image/png",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    }[ext] || "application/octet-stream"
  );
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/sample-landing.html";
  let filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!path.extname(filePath) && fs.existsSync(filePath + ".html")) filePath += ".html";
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end('Not found. Open <a href="/sample-landing.html">/sample-landing.html</a>');
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS" && req.url.startsWith("/api/translate")) {
    sendJson(res, 204);
    return;
  }

  if (req.method === "POST" && req.url === "/api/translate") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          sendJson(res, 500, { error: "GEMINI_API_KEY not set. Add it to .env.local" });
          return;
        }

        const request = parseRequest(JSON.parse(body || "{}"));
        if (request.error) {
          sendJson(res, 400, { error: request.error });
          return;
        }

        const translated = await translateTexts(apiKey, request.language, request.texts);
        const translations = {};
        request.texts.forEach((t, i) => {
          translations[t] = translated[i];
        });
        sendJson(res, 200, { language: request.language, translations });
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: "Translation failed", message: e.message });
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  console.log(`\n  Language Plugin local server`);
  console.log(`  Page:    http://localhost:${PORT}/sample-landing.html`);
  console.log(`  Snippet: http://localhost:${PORT}/embed.js`);
  console.log(`  API:     http://localhost:${PORT}/api/translate`);
  console.log(`  Gemini key: ${hasKey ? "loaded" : "MISSING — set GEMINI_API_KEY in .env.local"}\n`);
});
