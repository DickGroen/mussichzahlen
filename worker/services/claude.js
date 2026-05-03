const HAIKU_MODEL  = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

export async function callClaude(env, { model, maxTokens, prompt, fileBase64, mediaType }) {
  const headers = {
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  };

  if (mediaType === "application/pdf") {
    headers["anthropic-beta"] = "pdfs-2024-09-25";
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          mediaType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
            : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Claude API Fehler: ${JSON.stringify(data)}`);
  }

  return data?.content?.[0]?.text || "";
}

export async function runTriage(env, { fileBase64, mediaType, triagePrompt }) {
  const raw = await callClaude(env, {
    model: HAIKU_MODEL,
    maxTokens: 800,
    prompt: triagePrompt,
    fileBase64,
    mediaType
  });

  console.log("TRIAGE RAW:", raw.substring(0, 300));
  return raw;
}

export async function runAnalysis(env, { fileBase64, mediaType, route, haikuPrompt, sonnetPrompt }) {
  const useSonnet = route === "SONNET";

  const analysis = await callClaude(env, {
    model: useSonnet ? SONNET_MODEL : HAIKU_MODEL,
    maxTokens: useSonnet ? 6000 : 1800,
    prompt: useSonnet ? sonnetPrompt : haikuPrompt,
    fileBase64,
    mediaType
  }) || "";

  console.log("ANALYSE MODELL:", useSonnet ? "sonnet" : "haiku");
  console.log("ANALYSE LÄNGE:", analysis.length);

  return analysis;
}
