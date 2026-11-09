/* Push POC client: permission, subscribe, send, log. Zero deps. */
const $ = (id) => document.getElementById(id);
const logEl = $("log");
const log = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 1))).join(" ");
  logEl.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log("[poc]", ...a);
};
const b64ToU8 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isBraveBrowser = async () => {
  try {
    return (await navigator.brave?.isBrave?.()) === true;
  } catch { return false; }
};

let swReg = null, vapidKey = null, deferredPrompt = null;

async function refresh() {
  $("st-perm").textContent = "Notification" in window ? Notification.permission : "unsupported";
  $("st-sw").textContent = swReg ? "registered" : ("serviceWorker" in navigator ? "not registered" : "unsupported");
  $("st-mode").textContent = isStandalone() ? "standalone (installed)" : "browser tab";
  const sub = swReg ? await swReg.pushManager.getSubscription().catch(() => null) : null;
  $("st-sub").textContent = sub ? "active" : "none";
  $("btn-sub").disabled = !swReg || !vapidKey || !!sub;
  $("btn-unsub").disabled = !sub;
  $("btn-self").disabled = !sub;
  $("ios-hint").hidden = !(isIos() && !isStandalone());
  return sub;
}

async function init() {
  if (!("serviceWorker" in navigator)) { log("Service workers unsupported in this browser."); return; }
  if (!("PushManager" in window)) { log("Push API unsupported in this browser."); }
  try {
    swReg = await navigator.serviceWorker.register("/sw.js");
    $("st-sw").textContent = "registered";
  } catch (e) { log("SW registration failed:", e.message); return; }
  try {
    const r = await fetch("/api/vapid-public-key");
    const j = await r.json();
    vapidKey = j.publicKey || null;
    if (!vapidKey) log("No VAPID public key from server. Set VAPID_PUBLIC_KEY env.", j);
  } catch (e) { log("VAPID key fetch failed:", e.message); }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredPrompt = e; $("btn-install").disabled = false;
  });
  await refresh();
  log("Ready. 1) Enable notifications 2) Subscribe 3) Send to this device.");
}

$("btn-perm").onclick = async () => {
  if (!("Notification" in window)) return log("Notifications unsupported.");
  const p = await Notification.requestPermission();
  log("Permission:", p);
  await refresh();
};

$("btn-sub").onclick = async () => {
  try {
    if (!swReg || !vapidKey) return log("Missing SW or VAPID key.");
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidKey) });
    const r = await fetch("/api/subscriptions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), meta: { ua: navigator.userAgent, url: location.origin } }),
    });
    log("Subscribed + saved:", await r.json());
  } catch (e) {
    const detail = `${e?.name ? e.name + ": " : ""}${e?.message || e}`;
    log("Subscribe failed:", detail);
    // "Registration failed - push service error" is thrown by the browser's
    // push service (e.g. FCM) *before* our VAPID/server code is involved.
    // In Brave this almost always means Google push messaging is disabled.
    if (/push service/i.test(String(e?.message || ""))) {
      const brave = await isBraveBrowser();
      if (brave) {
        log("Brave blocks push by default. Fix: open brave://settings/privacy → turn ON “Use Google services for push messaging” → Relaunch Brave → Subscribe again. (Chrome/Edge work without this step.)");
      } else {
        log("Hint: push-service registration failed. Check network/VPN/firewall to the push service (e.g. fcm.googleapis.com), then retry. On desktop this works from a normal browser tab — installing the PWA is not required (unlike iOS).");
      }
    }
  }
  await refresh();
};

$("btn-unsub").onclick = async () => {
  const sub = await swReg.pushManager.getSubscription().catch(() => null);
  if (!sub) return log("No subscription.");
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch("/api/subscriptions?endpoint=" + encodeURIComponent(endpoint), { method: "DELETE" }).catch(() => {});
  log("Unsubscribed.");
  await refresh();
};

async function send(target) {
  const title = $("in-title").value || "Push POC";
  const body = $("in-body").value || "";
  const url = $("in-url").value || "/";
  let subscription = null;
  if (target === "self") {
    const sub = await swReg.pushManager.getSubscription();
    if (!sub) return log("Subscribe first.");
    subscription = sub.toJSON();
  }
  log(`Sending (${target})…`);
  const r = await fetch("/api/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, subscription, title, body, url }),
  });
  const j = await r.json().catch(() => ({}));
  log("Send result:", j);
  if (target === "all" && j.pruned) log(`Pruned ${j.pruned} expired endpoint(s).`);
}
$("btn-self").onclick = () => send("self").catch((e) => log("Send failed:", e.message));
$("btn-all").onclick = () => send("all").catch((e) => log("Send failed:", e.message));

$("btn-copy").onclick = async () => {
  const sub = await swReg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return log("No subscription to copy.");
  await navigator.clipboard?.writeText(sub.endpoint).catch(() => {});
  log("Endpoint copied:", sub.endpoint.slice(0, 80) + "…");
};
$("btn-health").onclick = async () => {
  try { log("Health:", await (await fetch("/api/health")).json()); }
  catch (e) { log("Health check failed:", e.message); }
};
$("btn-install").onclick = async () => {
  if (!deferredPrompt) return log("Install prompt not available (already installed or browser blocked it).");
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.then((c) => log("Install choice:", c.outcome));
  deferredPrompt = null; $("btn-install").disabled = true;
};

init();
