export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ message: "Method not allowed" }, 405, cors);
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

    let turnstileDetails = null;
    if (env.TURNSTILE_SECRET_KEY) {
      const token = typeof payload.turnstile_token === "string" ? payload.turnstile_token.trim() : "";
      if (!token) {
        return json({ message: "Security check failed. Refresh the page and try again." }, 400, cors);
      }

      const verification = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip);
      if (!verification.success) {
        return json({ message: "Please complete the verification challenge and try again." }, 400, cors);
      }
      turnstileDetails = verification.details;
    }

    delete payload.turnstile_token;

    const meta = {
      ip,
      ua: request.headers.get("User-Agent") || "",
      ts: new Date().toISOString(),
      referer: request.headers.get("Referer") || "",
      origin: request.headers.get("Origin") || "",
      path: new URL(request.url).pathname,
    };

    if (turnstileDetails) {
      meta.turnstile = {
        success: true,
        challengeTs: turnstileDetails.challenge_ts || "",
        hostname: turnstileDetails.hostname || "",
      };
      if (typeof turnstileDetails.score === "number") {
        meta.turnstile.score = turnstileDetails.score;
      }
      if (turnstileDetails.action) {
        meta.turnstile.action = turnstileDetails.action;
      }
      if (turnstileDetails.cdata) {
        meta.turnstile.cdata = turnstileDetails.cdata;
      }
    }

    payload._meta = meta;

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

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...(headers || {}) }});
}

async function verifyTurnstile(token, secret, ip) {
  const params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", token);
  if (ip && ip !== "unknown") {
    params.append("remoteip", ip);
  }

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!resp.ok) {
      return { success: false };
    }

    const data = await resp.json().catch(() => null);
    if (!data || !data.success) {
      return { success: false };
    }

    return { success: true, details: data };
  } catch (error) {
    return { success: false };
  }
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
