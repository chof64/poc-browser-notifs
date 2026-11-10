// Self-check for the iOS detection logic in public/app.js.
// NOTE: rules mirrored from public/app.js — change both together. Run: npm run check:ios
const cases = [
  { name: "iPhone Safari", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", platform: "iPhone", touch: 5, want: { iphone: true, ipad: false, ios: true } },
  { name: "iPad Safari", ua: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", platform: "iPad", touch: 5, want: { iphone: false, ipad: true, ios: true } },
  { name: "iPadOS desktop UA", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", platform: "MacIntel", touch: 5, want: { iphone: false, ipad: true, ios: true } },
  { name: "Mac desktop", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", platform: "MacIntel", touch: 0, want: { iphone: false, ipad: false, ios: false } },
  { name: "Android Chrome", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", platform: "Linux armv8l", touch: 5, want: { iphone: false, ipad: false, ios: false } },
];
const isIpadOSDesktop = (platform, touch) => platform === "MacIntel" && touch > 1;
const isIphone = (ua) => /iphone|ipod/i.test(ua);
const isIpad = (ua, platform, touch) => /ipad/i.test(ua) || isIpadOSDesktop(platform, touch);
const isIos = (ua, platform, touch) => isIphone(ua) || isIpad(ua, platform, touch);

let failed = 0;
for (const c of cases) {
  const got = { iphone: isIphone(c.ua), ipad: isIpad(c.ua, c.platform, c.touch), ios: isIos(c.ua, c.platform, c.touch) };
  const ok = got.iphone === c.want.iphone && got.ipad === c.want.ipad && got.ios === c.want.ios;
  console.log(`${ok ? "ok" : "FAIL"} - ${c.name}: ${JSON.stringify(got)}`);
  if (!ok) failed++;
}
if (failed) { console.error(`${failed} case(s) failed`); process.exit(1); }
console.log("ios-detect OK");
