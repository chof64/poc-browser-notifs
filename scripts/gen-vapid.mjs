// Generates a VAPID P-256 keypair and prints Cloudflare env setup.
// Usage: npm run gen:keys [-- --write]
//   default: prints keys. --write: writes them into .dev.vars (local only, gitignored).
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const b64u = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveBits"]
);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const jwkPriv = await crypto.subtle.exportKey("jwk", privateKey);
const pub = b64u(rawPub);
const priv = b64u(Buffer.from(jwkPriv.d, "base64url"));

console.log("VAPID_PUBLIC_KEY=" + pub);
console.log("VAPID_PRIVATE_KEY=" + priv);
console.log("\nCloudflare dashboard -> Workers -> Settings -> Variables:");
console.log("  VAPID_PUBLIC_KEY = " + pub);
console.log("  VAPID_PRIVATE_KEY = (see above, keep secret)");
console.log('  VAPID_SUBJECT = mailto:you@example.com');

if (process.argv.includes("--write")) {
  let cur = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
  const setVar = (src, k, v) =>
    src.match(new RegExp(`^${k}=.*$`, "m")) ? src.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : src + `${k}=${v}\n`;
  cur = setVar(cur, "VAPID_PUBLIC_KEY", pub);
  cur = setVar(cur, "VAPID_PRIVATE_KEY", priv);
  if (!/^VAPID_SUBJECT=/m.test(cur)) cur += "VAPID_SUBJECT=mailto:you@example.com\n";
  writeFileSync(".dev.vars", cur);
  console.log("\nWrote .dev.vars (gitignored, local dev only).");
}
