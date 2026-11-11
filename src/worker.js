/* Push POC Worker: static assets + Web Push API. Zero deps (WebCrypto + fetch + KV).
 * KV binding: env.PUSH_SUBS.
 * Routes:
 *   GET    /api/health
 *   GET    /api/vapid-public-key
 *   POST   /api/subscriptions   { subscription, meta }
 *   DELETE /api/subscriptions?endpoint=
 *   GET    /api/subscriptions/count
 *   POST   /api/send            { target: 'self'|'all', subscription?, title, body, url }
 */
const te = new TextEncoder();

function b64uEncodeBuf(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// --- VAPID JWT (ES256) ---
async function vapidJwt(audience, subject, pubB64u, privRaw) {
  const pub = b64uDecode(pubB64u);
  const header = b64uEncodeBuf(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64uEncodeBuf(te.encode(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject,
  })));
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64uEncodeBuf(pub.slice(1, 33)), y: b64uEncodeBuf(pub.slice(33, 65)),
    d: b64uEncodeBuf(privRaw), ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64uEncodeBuf(sig)}`;
}

// --- RFC 8291 aes128gcm payload encryption ---
async function encryptPayload(subscription, payloadObj) {
  const clientPub = b64uDecode(subscription.keys.p256dh);
  const auth = b64uDecode(subscription.keys.auth);
  if (clientPub.length !== 65 || clientPub[0] !== 0x04) throw new Error("bad p256dh key");
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const clientKey = await crypto.subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, eph.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(te.encode("WebPush: info\0"), clientPub, serverPub);
  const prk = await hkdf(auth, shared, keyInfo, 32);
  const cek = await hkdf(salt, prk, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, te.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concat(te.encode(JSON.stringify(payloadObj)), new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, plaintext));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return { body: concat(salt, rs, new Uint8Array([serverPub.length]), serverPub, ct) };
}

async function pushTo(subscription, payload, env) {
  const pub = env.VAPID_PUBLIC_KEY, privB64 = env.VAPID_PRIVATE_KEY;
  if (!pub || !privB64) throw new Error("server missing VAPID keys");
  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJwt(aud, env.VAPID_SUBJECT || "mailto:you@example.com", pub, b64uDecode(privB64));
  const { body } = await encryptPayload(subscription, payload);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-encoding": "aes128gcm",
      "ttl": "86400",
      "urgency": "normal",
      "authorization": `vapid t=${jwt}, k=${pub}`,
    },
    body,
  });
  return res;
}

const kv = (env) => {
  if (!env.PUSH_SUBS) throw new Error("KV binding PUSH_SUBS is missing (dashboard: KV namespace Name=PUSH_SUBS Value=poc_browser_notifs)");
  return env.PUSH_SUBS;
};

const getSubs = async (env) => {
  const store = kv(env);
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const v = await store.get(k.name, "json");
      if (v?.subscription?.endpoint) out.push({ id: k.name, ...v });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") {
      return json({ ok: true, hasKv: !!env.PUSH_SUBS, hasVapidPublic: !!env.VAPID_PUBLIC_KEY, hasVapidPrivate: !!env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || null });
    }
    if (pathname === "/api/vapid-public-key") {
      if (!env.VAPID_PUBLIC_KEY) return json({ error: "VAPID_PUBLIC_KEY not set" }, 500);
      return json({ publicKey: env.VAPID_PUBLIC_KEY });
    }
    if (pathname === "/api/subscriptions" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const sub = body?.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: "bad subscription" }, 400);
      const id = "sub:" + (await sha256hex(sub.endpoint));
      await kv(env).put(id, JSON.stringify({ subscription: sub, meta: body.meta || null, updatedAt: new Date().toISOString() }));
      return json({ ok: true, id });
    }
    if (pathname === "/api/subscriptions" && request.method === "DELETE") {
      const endpoint = url.searchParams.get("endpoint");
      if (!endpoint) return json({ error: "missing endpoint" }, 400);
      await kv(env).delete("sub:" + (await sha256hex(endpoint)));
      return json({ ok: true });
    }
    if (pathname === "/api/subscriptions/count") {
      const subs = await getSubs(env);
      return json({ count: subs.length });
    }
    if (pathname === "/api/send" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const payload = { title: body.title || "Push POC", body: body.body || "", url: body.url || "/" };
      let targets;
      if (body.target === "self") {
        if (!body.subscription?.endpoint) return json({ error: "missing subscription for self-send" }, 400);
        targets = [{ subscription: body.subscription, id: "self" }];
      } else {
        targets = await getSubs(env);
        if (!targets.length) return json({ error: "no subscriptions saved" }, 404);
      }
      const results = [];
      let pruned = 0;
      for (const t of targets) {
        try {
          const res = await pushTo(t.subscription, payload, env);
          const ok = res.status === 201 || res.status === 200 || res.status === 202;
          if (res.status === 404 || res.status === 410) {
            await kv(env).delete(t.id).catch(() => {});
            pruned++;
          }
          results.push({ endpoint: t.subscription.endpoint.slice(0, 60) + "…", ok, status: res.status });
        } catch (e) {
          results.push({ endpoint: String(t.subscription?.endpoint || "?").slice(0, 60) + "…", ok: false, error: e.message });
        }
      }
      return json({ ok: results.some((r) => r.ok), results, pruned });
    }

    // Static PWA assets (Workers + Assets binding)
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("assets binding missing", { status: 500 });
  },
};
