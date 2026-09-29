/**
 * Local dev: static files from public/ + POST /api/translate (Gemini).
 * Usage: npm run dev   (reads settings from .env, which is gitignored)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseRequest, translateTexts } = require("../functions/translate-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch (e) {
  console.error("Missing .env file. Copy .env.example to .env and fill in your keys.");
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3456);

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
        const request = parseRequest(JSON.parse(body || "{}"));
        if (request.error) {
          sendJson(res, 400, { error: request.error });
          return;
        }

        const translated = await translateTexts(request.language, request.texts);
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
  const missing = ["GEMINI_API_KEY", "GEMINI_MODEL"].filter((name) => !process.env[name]);
  console.log(`\n  Language Plugin local server`);
  console.log(`  Page:    http://localhost:${PORT}/sample-landing.html`);
  console.log(`  Snippet: http://localhost:${PORT}/embed.js`);
  console.log(`  API:     http://localhost:${PORT}/api/translate`);
  console.log(`  Gemini:  ${missing.length ? "MISSING " + missing.join(", ") + " in .env" : process.env.GEMINI_MODEL}\n`);
});
