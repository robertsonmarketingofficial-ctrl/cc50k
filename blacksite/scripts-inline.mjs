// Builds dist/ with Vite, then inlines the JS and CSS into one self-contained page (dist-single/blacksite.html).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dist = "dist", assets = join(dist, "assets");
const files = readdirSync(assets);
const js = files.filter(f => f.endsWith(".js")).map(f => readFileSync(join(assets, f), "utf8")).join("\n");
const css = files.filter(f => f.endsWith(".css")).map(f => readFileSync(join(assets, f), "utf8")).join("\n");
const fontImport = css.match(/@import url\(([^)]+)\);?/);
const cssBody = css.replace(/@import url\([^)]+\);?/, "");
const page = `<title>BLACKSITE: ZERO HOUR</title>
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
