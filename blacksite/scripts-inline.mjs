// Builds dist/ with Vite, then inlines the JS and CSS into one self-contained page (dist-single/blacksite.html).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dist = "dist", assets = join(dist, "assets");
const files = readdirSync(assets);
const js = files.filter(f => f.endsWith(".js")).map(f => readFileSync(join(assets, f), "utf8")).join("\n");
const css = files.filter(f => f.endsWith(".css")).map(f => readFileSync(join(assets, f), "utf8")).join("\n");
const fontImport = css.match(/@import url\(([^)]+)\);?/);
const cssBody = css.replace(/@import url\([^)]+\);?/, "");
const page = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BLACKSITE: ZERO HOUR</title>
<meta name="description" content="A tactical stealth extraction game where the world remembers.">
${fontImport ? `<link rel="stylesheet" href=${fontImport[1]}>` : ""}
<style>${cssBody}</style>
<div id="root"></div>
<noscript>BLACKSITE: ZERO HOUR needs JavaScript.</noscript>
<script type="module">${js.replace(/<\/script/g, "<\\/script")}</script>
`;
mkdirSync("dist-single", { recursive: true });
writeFileSync("dist-single/blacksite.html", page);
console.log("dist-single/blacksite.html", (page.length / 1024).toFixed(0) + " KB");

// pack binary assets that static hosts may refuse to serve (.glb, .hdr) into one script
const pub = "public/assets", packed = {};
for (const f of readdirSync(pub)) if (/\.(glb|hdr)$/.test(f) && f !== "eotech.glb") packed[f] = readFileSync(join(pub, f)).toString("base64");
mkdirSync("dist-single/assets", { recursive: true });
writeFileSync("dist-single/assets/models.json", JSON.stringify(packed));
console.log("dist-single/assets/models.json", (JSON.stringify(packed).length / 1048576).toFixed(1) + " MB");
