const { parseRequest, translateTexts } = require("../functions/translate-core");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

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
    const translated = await translateTexts(language, texts);
    const translations = {};
    texts.forEach((t, i) => {
      translations[t] = translated[i];
    });
    res.status(200).json({ language, translations });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Translation failed", message: e.message });
  }
};
