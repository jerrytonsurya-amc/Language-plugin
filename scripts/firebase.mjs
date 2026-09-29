/**
 * Runs the Firebase CLI with settings from .env:
 *   npm run deploy          -> firebase deploy
 *   npm run deploy:hosting  -> firebase deploy --only hosting
 *   npm run serve           -> firebase emulators:start
 *
 * The project comes from FIREBASE_PROJECT_ID. GEMINI_MODEL is written to functions/.env, and
 * GEMINI_API_KEY is stored in Secret Manager (deploy) or functions/.secret.local (emulators).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(ROOT, "functions");

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch (e) {
  fail("Missing .env file. Copy .env.example to .env and fill in your keys.");
}

for (const name of ["FIREBASE_PROJECT_ID", "GEMINI_API_KEY", "GEMINI_MODEL"]) {
  if (!process.env[name]) fail(`${name} is not set in .env`);
}

const args = process.argv.slice(2);

function firebase(cliArgs, { input, capture } = {}) {
  const result = spawnSync("firebase", [...cliArgs, "--project", process.env.FIREBASE_PROJECT_ID], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
  });
  if (result.error) fail(`Could not run the Firebase CLI: ${result.error.message}`);
  return result;
}

function deploysFunctions(cliArgs) {
  if (cliArgs[0] !== "deploy") return false;
  const i = cliArgs.findIndex((arg) => arg === "--only" || arg.startsWith("--only="));
  if (i === -1) return true;
  const targets = cliArgs[i].includes("=") ? cliArgs[i].split("=")[1] : cliArgs[i + 1] || "";
  return targets.split(",").some((target) => target.trim().startsWith("functions"));
}

function syncGeminiSecret() {
  const key = process.env.GEMINI_API_KEY;
  const current = firebase(["functions:secrets:access", "GEMINI_API_KEY"], { capture: true });
  if (current.status === 0 && current.stdout.trim() === key) return;

  console.log("Saving GEMINI_API_KEY from .env to Secret Manager...");
  const result = firebase(["functions:secrets:set", "GEMINI_API_KEY", "--data-file", "-"], { input: key });
  if (result.status !== 0) process.exit(result.status || 1);
}

fs.writeFileSync(path.join(FUNCTIONS_DIR, ".env"), `GEMINI_MODEL=${process.env.GEMINI_MODEL}\n`);

if (args[0] && args[0].startsWith("emulators:")) {
  fs.writeFileSync(path.join(FUNCTIONS_DIR, ".secret.local"), `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}\n`);
}

if (deploysFunctions(args)) syncGeminiSecret();

process.exit(firebase(args).status ?? 1);
