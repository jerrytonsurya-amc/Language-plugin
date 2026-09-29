const MAX_BATCH = 40;
const MAX_TEXT_LEN = 2000;

const LANG_NAMES = {
  ta: "Tamil",
  hi: "Hindi",
  ml: "Malayalam",
  te: "Telugu",
  kn: "Kannada",
};

function parseRequest(body) {
  const language = String((body && body.language) || "").toLowerCase();
  if (!LANG_NAMES[language]) {
    return { error: "Invalid language. Use one of: " + Object.keys(LANG_NAMES).join(", ") };
  }

  const raw = Array.isArray(body.texts) ? body.texts : [];
  const texts = [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))].slice(0, MAX_BATCH);
  if (texts.length === 0) return { error: "No texts to translate" };
  if (texts.some((t) => t.length > MAX_TEXT_LEN)) {
    return { error: `Text too long (max ${MAX_TEXT_LEN} characters)` };
  }

  return { language, texts };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to .env`);
  return value;
}

async function callGemini(language, texts) {
  const model = requireEnv("GEMINI_MODEL");
  const apiKey = requireEnv("GEMINI_API_KEY");
  const prompt = `You translate website text from English to ${LANG_NAMES[language]}.
Translate every string in the JSON array below and return a JSON array of the same length, in the same order.
Keep URLs, email addresses, numbers, currency amounts and placeholders such as {name} or %s unchanged.
Return only the translations.

${JSON.stringify(texts)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "ARRAY", items: { type: "STRING" } },
        },
      }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini error ${response.status}: ${errBody.slice(0, 400)}`);
  }

  const data = await response.json();
  const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function translateTexts(language, texts) {
  const result = await callGemini(language, texts);

  if (result.length !== texts.length) {
    if (texts.length === 1) return texts;
    const mid = Math.ceil(texts.length / 2);
    const [left, right] = await Promise.all([
      translateTexts(language, texts.slice(0, mid)),
      translateTexts(language, texts.slice(mid)),
    ]);
    return left.concat(right);
  }

  return texts.map((t, i) => (typeof result[i] === "string" && result[i].trim() ? result[i].trim() : t));
}

module.exports = { LANG_NAMES, parseRequest, translateTexts };
