export default {
  async fetch(request, env, ctx) {
    const { cors, isAllowedOrigin } = resolveCors(request, env);

    if (request.method === "OPTIONS") {
      const status = isAllowedOrigin ? 204 : 403;
      return new Response(null, { status, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ message: "Method not allowed" }, 405, cors);
    }

    if (!isAllowedOrigin) {
      return json({ message: "Origin not allowed" }, 403, cors);
    }

    // Basic IP rate limit
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await rateLimit(ip, 20, 60)) {
      return json({ message: "Too many requests. Try again soon." }, 429, cors);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return json({ message: "Invalid JSON body" }, 400, cors); }

    // Honeypot: silently accept
    if (typeof payload.website === "string" && payload.website.trim() !== "") {
      return json({ ok: true }, 200, cors);
    }

    payload._meta = {
      ip,
      ua: request.headers.get("User-Agent") || "",
      ts: new Date().toISOString(),
      referer: request.headers.get("Referer") || "",
      origin: request.headers.get("Origin") || "",
      path: new URL(request.url).pathname,
    };

    // Forward to n8n
    const forward = await fetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!forward.ok) {
      let msg = "Submission failed upstream";
      try {
        const j = await forward.json();
        if (j && j.message) msg = j.message;
      } catch {}
      return json({ message: msg }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  }
};

function resolveCors(request, env) {
  const origin = request.headers.get("Origin");
  const allowList = (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let isAllowedOrigin = true;

  if (allowList.length && !allowList.includes("*")) {
    if (!origin || !allowList.includes(origin)) {
      isAllowedOrigin = false;
    }
  }

  const allowedOriginHeader = origin || (allowList.includes("*") ? "*" : allowList[0] || "*");

  return {
    cors: {
      "Access-Control-Allow-Origin": allowedOriginHeader,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    },
    isAllowedOrigin,
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...(headers || {}) }});
}

// naive ratelimit using caches.default (per colo)
async function rateLimit(ip, max, windowSec) {
  const key = `rl:${ip}`;
  const url = new URL("https://rl.example/" + key);
  const cached = await caches.default.match(url);
  let state = { count: 0, resetAt: Date.now() + windowSec * 1000 };

  if (cached) {
    try { state = await cached.json(); } catch {}
  }
  const now = Date.now();
  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + windowSec * 1000;
  }
  state.count += 1;

  const resp = new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" }});
  const ttl = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  resp.headers.set("Cache-Control", `max-age=${ttl}`);
  await caches.default.put(url, resp.clone());

  return state.count > max;
}
