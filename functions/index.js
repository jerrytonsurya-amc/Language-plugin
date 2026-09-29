const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { parseRequest, translateTexts } = require("./translate-core");

admin.initializeApp();

function docId(text, language) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32) + "_" + language;
}

async function readCache(db, language, texts) {
  const found = new Map();
  try {
    const refs = texts.map((t) => db.collection("translations").doc(docId(t, language)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, i) => {
      const translated = snap.exists ? snap.get("translated") : null;
      if (translated) found.set(texts[i], translated);
    });
  } catch (e) {
    console.warn("Firestore cache read failed, continuing without cache:", e.message);
  }
  return found;
}

async function writeCache(db, language, pairs) {
  try {
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const [original, translated] of pairs) {
      batch.set(db.collection("translations").doc(docId(original, language)), {
        original,
        translated,
        language,
        updatedAt: now,
      });
    }
    await batch.commit();
  } catch (e) {
    console.warn("Firestore cache write failed:", e.message);
  }
}

exports.translate = onRequest(
  {
    secrets: ["GEMINI_API_KEY"],
    cors: true,
    maxInstances: 20,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const request = parseRequest(req.body);
    if (request.error) {
      res.status(400).json({ error: request.error });
      return;
    }
    const { language, texts } = request;

    try {
      const db = admin.firestore();
      const translations = Object.fromEntries(await readCache(db, language, texts));
      const missing = texts.filter((t) => !Object.prototype.hasOwnProperty.call(translations, t));

      if (missing.length > 0) {
        const fresh = await translateTexts(language, missing);
        const pairs = missing.map((original, i) => [original, fresh[i]]);
        pairs.forEach(([original, translated]) => {
          translations[original] = translated;
        });
        await writeCache(db, language, pairs);
      }

      res.status(200).json({ language, translations });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Translation failed", message: e.message });
    }
  }
);
