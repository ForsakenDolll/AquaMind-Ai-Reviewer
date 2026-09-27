// Netlify Function: proxies chat-completion requests to Groq.
//
// The real API key is read from the GROQ_API_KEY environment variable, set
// in the Netlify dashboard (Site configuration > Environment variables). It
// is never sent to the browser and never committed to GitHub.
//
// The front-end (index.html) calls this function at the relative path
// /.netlify/functions/llm-proxy instead of calling api.groq.com directly, so
// no key of any kind needs to exist in the page source.

exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error:
          "GROQ_API_KEY is not set. Add it in Netlify: Site configuration > Environment variables.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { messages, jsonMode } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "A non-empty 'messages' array is required" }),
    };
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
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.7,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    clearTimeout(timeout);
    const data = await upstream.json();

    return {
      statusCode: upstream.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Failed to reach Groq API",
        detail: String(err),
      }),
    };
  }
};
