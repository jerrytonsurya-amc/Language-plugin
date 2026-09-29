const GEMINI_MODEL = "gemini-3.1-flash-lite";
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

async function callGemini(apiKey, language, texts) {
  const prompt = `You translate website text from English to ${LANG_NAMES[language]}.
Translate every string in the JSON array below and return a JSON array of the same length, in the same order.
Keep URLs, email addresses, numbers, currency amounts and placeholders such as {name} or %s unchanged.
Return only the translations.

${JSON.stringify(texts)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

async function translateTexts(apiKey, language, texts) {
  const result = await callGemini(apiKey, language, texts);

  if (result.length !== texts.length) {
    if (texts.length === 1) return texts;
    const mid = Math.ceil(texts.length / 2);
    const [left, right] = await Promise.all([
      translateTexts(apiKey, language, texts.slice(0, mid)),
      translateTexts(apiKey, language, texts.slice(mid)),
    ]);
    return left.concat(right);
  }

  return texts.map((t, i) => (typeof result[i] === "string" && result[i].trim() ? result[i].trim() : t));
}

module.exports = { GEMINI_MODEL, LANG_NAMES, parseRequest, translateTexts };
