/* Push POC client: permission, subscribe, send, log. Zero deps.
 * iOS notes: Web Push on iPhone/iPad requires iOS 16.4+, the PWA installed
 * via Safari Share -> Add to Home Screen, and opened from the Home Screen.
 * Apple exposes no `beforeinstallprompt`, so the Install button opens a
 * manual steps sheet on iOS instead of a programmatic prompt.
 * The in-page "Share this app" button uses the Web Share API
 * (navigator.share) — a webpage can never tap Safari's own chrome Share
 * button, it can only open the system share sheet. */
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

/* --- platform detection (covers iPadOS 13+ desktop UA) ---
 * NOTE: rules mirrored in scripts/check-ios-detect.mjs — change both together. */
const ua = navigator.userAgent || "";
const isIpadOSDesktop = () =>
  navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
const isIphone = () => /iphone|ipod/i.test(ua);
const isIpad = () => /ipad/i.test(ua) || isIpadOSDesktop();
const isIos = () => isIphone() || isIpad();
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  matchMedia("(display-mode: fullscreen)").matches ||
  navigator.standalone === true;
const isBraveBrowser = async () => {
  try {
    return (await navigator.brave?.isBrave?.()) === true;
  } catch { return false; }
};
const iosVersion = () => {
  const m = ua.match(/OS (\d+)[_.](\d+)/i);
  if (m) return `${m[1]}.${m[2]}`;
  if (isIpadOSDesktop()) return "13+ (iPad desktop mode)";
  return "n/a";
};
const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const SHEET_HIDE_KEY = "poc-ios-sheet-hide";
const SHEET_SHOWN_SESSION = "poc-ios-sheet-shown";

let swReg = null, vapidKey = null, deferredPrompt = null;

function updateSheetDevice() {
  // Show the right mockup: iPhone = bottom toolbar, iPad = top toolbar.
  const ipad = isIpad();
  if ($("mock-iphone")) $("mock-iphone").hidden = ipad;
  if ($("mock-ipad")) $("mock-ipad").hidden = !ipad;
  const ctx = $("sheet-context");
  if (ctx) {
    if (isStandalone()) {
      ctx.textContent = "✓ You are in the installed app — continue below: Enable notifications → Subscribe.";
      ctx.classList.add("ok");
    } else if (isIos()) {
      ctx.textContent = `You are in a Safari tab on ${ipad ? "iPad" : "iPhone"} (not installed yet) — follow the steps below.`;
      ctx.classList.remove("ok");
    } else {
      ctx.textContent = "You are not on iOS — use the Install button / browser menu.";
      ctx.classList.remove("ok");
    }
  }
  // Share buttons always stay visible; without Web Share they fall back to copy-link.
  const canShare = !!navigator.share;
  if ($("share-note") && !canShare) {
    $("share-note").textContent = "This browser has no system share sheet, so use Copy link and paste it into Safari on your iPhone/iPad.";
  }
}

function openSheet() { updateSheetDevice(); $("sheet")?.classList.add("open"); }
function closeSheet() {
  if ($("sheet-hide")?.checked) {
    try { localStorage.setItem(SHEET_HIDE_KEY, "1"); } catch {}
  }
  $("sheet")?.classList.remove("open");
}
function sheetAutoOpenAllowed() {
  try {
    if (localStorage.getItem(SHEET_HIDE_KEY) === "1") return false;
  } catch {}
  try {
    if (sessionStorage.getItem(SHEET_SHOWN_SESSION) === "1") return false;
  } catch {}
  return true;
}
function markSheetAutoShown() {
  try { sessionStorage.setItem(SHEET_SHOWN_SESSION, "1"); } catch {}
}

async function refresh() {
  $("st-perm").textContent = "Notification" in window ? Notification.permission : "unsupported";
  $("st-sw").textContent = swReg ? "registered" : ("serviceWorker" in navigator ? "not registered" : "unsupported");
  $("st-mode").textContent = isStandalone() ? "standalone (installed)" : "browser tab";
  $("st-push").textContent = pushSupported()
    ? ("PushManager" in window ? "available" : "unsupported")
    : "unsupported (this browser)";
  $("st-device").textContent = isIos()
    ? `iOS/iPadOS ${iosVersion()}${isStandalone() ? "" : " — not installed"}`
    : "non-iOS";

  const sub = swReg ? await swReg.pushManager.getSubscription().catch(() => null) : null;
  $("st-sub").textContent = sub ? "active" : "none";
  $("btn-sub").disabled = !swReg || !vapidKey || !!sub;
  $("btn-unsub").disabled = !sub;
  $("btn-self").disabled = !sub;

  // Install button: on iOS there is never a beforeinstallprompt — make the
  // button the "Add to Home Screen" trigger that opens the steps sheet.
  const installBtn = $("btn-install");
  if (isStandalone()) {
    installBtn.disabled = true;
    installBtn.textContent = "Installed ✓";
  } else if (isIos()) {
    installBtn.disabled = false;
    installBtn.textContent = "Add to Home Screen";
  } else {
    installBtn.textContent = "Install app";
    installBtn.disabled = !deferredPrompt;
  }

  // iOS install card visible whenever on iOS and not installed.
  if ($("ios-card")) $("ios-card").hidden = !(isIos() && !isStandalone());
  return sub;
}

async function shareApp() {
  const shareData = {
    title: "Push POC",
    text: "Install Push POC (iPhone: open in Safari → Share → Add to Home Screen):",
    url: location.href,
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      log("System share opened. Note: installing still needs Safari's own Share → Add to Home Screen on the iPhone.");
    } catch (e) {
      // AbortError = user dismissed — not an error worth logging loudly.
      if (e?.name === "AbortError") { log("Share dismissed."); return; }
      log("Share failed, copying link instead:", e.message);
      await copyLink();
    }
    return;
  }
  await copyLink();
}

async function copyLink() {
  if (!navigator.clipboard?.writeText) { prompt("Copy this link into Safari on your iPhone/iPad:", location.href); return; }
  try { await navigator.clipboard.writeText(location.href); log("Link copied — paste it into Safari on your iPhone/iPad."); }
  catch { prompt("Copy this link into Safari on your iPhone/iPad:", location.href); }
}

async function init() {
  $("btn-ios-steps").onclick = openSheet;
  $("btn-ios-share").onclick = shareApp;
  $("btn-sheet-share").onclick = shareApp;
  $("btn-sheet-close").onclick = closeSheet;
  $("sheet")?.addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  $("btn-ios-copy").onclick = copyLink;
  $("btn-sheet-copy").onclick = copyLink;

  if (!("serviceWorker" in navigator)) { log("Service workers unsupported in this browser."); return; }
  if (!("PushManager" in window)) {
    log(isIos() && !isStandalone()
      ? "Push API not exposed in this Safari tab — this is expected on iOS until you install (Add to Home Screen) and open the installed app."
      : "Push API unsupported in this browser.");
  }
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
    // Chromium only — never fires on iOS Safari.
    e.preventDefault(); deferredPrompt = e;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    log("App installed. Open it from the Home Screen, then Subscribe there.");
    deferredPrompt = null;
    refresh();
  });
  await refresh();
  if (isIos() && !isStandalone()) {
    log(`iPhone/iPad detected (iOS ${iosVersion()}). Push needs: iOS 16.4+, installed via Safari Share → Add to Home Screen, opened from the Home Screen.`);
    // Auto-open once per session unless the user opted out.
    if (sheetAutoOpenAllowed()) {
      markSheetAutoShown();
      setTimeout(() => {
        if (!sheetAutoOpenAllowed() || $("sheet")?.classList.contains("open")) return;
        openSheet();
        log("Auto-opened install steps (once — tick “Don't auto-show” to stop).");
      }, 900);
    }
  } else {
    log("Ready. 1) Enable notifications 2) Subscribe 3) Send to this device.");
  }
}

$("btn-perm").onclick = async () => {
  if (!("Notification" in window)) return log("Notifications unsupported.");
  if (isIos() && !isStandalone()) {
    log("Heads up: on iOS, grant permission inside the installed app instead — tap “Add to Home Screen”, open the Home Screen icon, then Enable notifications there.");
    openSheet();
  }
  const p = await Notification.requestPermission();
  log("Permission:", p);
  if (p === "denied") log("Blocked: re-enable in Settings (iOS: Settings → Apps → Safari → Location/Notifications; or site settings) then retry inside the installed app.");
  await refresh();
};

$("btn-sub").onclick = async () => {
  try {
    if (!swReg || !vapidKey) return log("Missing SW or VAPID key.");
    // Hard gate: subscribing in an iOS Safari tab always fails — redirect to install flow.
    if (isIos() && !isStandalone()) {
      log("iOS requires the installed app: tap “Add to Home Screen”, open the Home Screen icon, then Subscribe there. (Browser-tab push does not exist on iOS.)");
      openSheet();
      return;
    }
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidKey) });
    const r = await fetch("/api/subscriptions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), meta: { ua: navigator.userAgent, url: location.origin, standalone: isStandalone() } }),
    });
    log("Subscribed + saved:", await r.json());
    if (isIos()) log("iOS check: keep the installed app closed (or lock the screen) and use Send to this device — the notification should appear as a system notification.");
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
    } else if (isIos()) {
      if (/abort|permission|not allowed/i.test(e.message)) log("iOS hint: this usually means you are in a Safari tab (not the installed app) or permission was dismissed. Install first, open from Home Screen, Enable notifications, then Subscribe.");
      else log(`iOS hint: needs iOS 16.4+ (you report ${iosVersion()}), HTTPS, installed PWA, permission granted.`);
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
    if (!sub) {
      if (isIos() && !isStandalone()) openSheet();
      return log("Subscribe first — on iOS, subscribe inside the installed app.");
    }
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
  if (j.ok === false && isIos()) log("If iOS shows success but nothing arrives: confirm the app is installed + opened from Home Screen, Notifications allowed (Settings → Notifications → Push POC), Focus/DND off, and iOS 16.4+.");
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
  if (isIos() && !isStandalone()) {
    // There is no programmatic install API on iOS — this IS the trigger: the steps sheet.
    log("Opening Add to Home Screen steps (iOS has no automatic install prompt).");
    openSheet();
    return;
  }
  if (isStandalone()) return log("Already installed — you're running inside the installed app.");
  if (!deferredPrompt) return log("Install prompt not available (already installed, or use the browser menu → Install / Add to Home Screen).");
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.then((c) => log("Install choice:", c.outcome));
  deferredPrompt = null; await refresh();
};

init();
