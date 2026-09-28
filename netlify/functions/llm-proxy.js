// Netlify Function: proxies chat-completion requests to Groq.
//
// The real API key is read from the GROQ_API_KEY environment variable, set
// in the Netlify dashboard (Site configuration > Environment variables). It
// is never sent to the browser and never committed to GitHub.
//
// The model is read from the optional GROQ_MODEL environment variable, so you
// can switch models later without editing code (Groq retires models over time
// — llama-3.3-70b-versatile was shut down on 2026-08-16). If GROQ_MODEL is not
// set, DEFAULT_MODEL below is used.
//
// The front-end (index.html) calls this function at the relative path
// /.netlify/functions/llm-proxy instead of calling api.groq.com directly, so
// no key of any kind needs to exist in the page source.

const DEFAULT_MODEL = "openai/gpt-oss-120b";

exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  const reply = (statusCode, obj) => ({
    statusCode,
    headers,
    body: JSON.stringify(obj),
  });

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return reply(500, {
      error:
        "GROQ_API_KEY is not set. Add it in Netlify: Site configuration > Environment variables.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return reply(400, { error: "Invalid JSON body" });
  }

  const { messages, jsonMode } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return reply(400, { error: "A non-empty 'messages' array is required" });
  }

  const model = (process.env.GROQ_MODEL || DEFAULT_MODEL).trim();

  const requestBody = {
    model: model,
    messages: messages,
    temperature: 0.7,
    max_completion_tokens: 4096,
  };
  if (jsonMode) {
    requestBody.response_format = { type: "json_object" };
  }
  // GPT-OSS models are reasoning models; "low" keeps replies fast.
  if (/^openai\/gpt-oss/.test(model)) {
    requestBody.reasoning_effort = "low";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });

    clearTimeout(timeout);

    const text = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* not JSON */
    }

    if (!upstream.ok) {
      // Mark this clearly as an error that came FROM Groq (not from Netlify),
      // so the game can show the real reason instead of a generic message.
      let message = "";
      if (data && data.error) {
        message =
          typeof data.error === "string" ? data.error : data.error.message || "";
      }
      return reply(upstream.status, {
        error: message || text.slice(0, 300) || "Groq returned an error",
        source: "groq",
        upstreamStatus: upstream.status,
        model: model,
      });
    }

    if (!data) {
      return reply(502, {
        error: "Groq returned a response that was not JSON",
        detail: text.slice(0, 200),
      });
    }

    return reply(200, data);
  } catch (err) {
    clearTimeout(timeout);
    return reply(502, {
      error: "Failed to reach Groq API",
      detail: String(err),
    });
  }
};
