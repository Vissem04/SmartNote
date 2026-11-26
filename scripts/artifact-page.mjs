// dist/index.html → dist/artifact.html (claude.ai 아티팩트 게시용)
// 아티팩트는 게시할 때 doctype/head/body 골격을 씌우므로 그 안에 들어갈 내용만 남긴다.
import fs from "node:fs";

const html = fs.readFileSync("dist/index.html", "utf8");
const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1];
const body = /<body>([\s\S]*?)<\/body>/i.exec(html)[1];
const keepHead = head
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !/<meta (charset|name="viewport")/i.test(l));
const title = keepHead.filter((l) => l.startsWith("<title"));
const rest = keepHead.filter((l) => !l.startsWith("<title"));
fs.writeFileSync("dist/artifact.html", [...title, ...rest, body.trim()].join("\n") + "\n");

// 게시 도구는 텍스트 파일 속 원시 제어문자(ESC 등)를 거부한다.
// JS 문자열·정규식 리터럴 안의 원시 바이트를 같은 뜻의 \xNN 이스케이프로 바꾼다.
for (const f of fs.readdirSync("dist/assets")) {
  if (!/\.(m?js|css)$/.test(f)) continue;
  const path = `dist/assets/${f}`;
  const src = fs.readFileSync(path, "utf8");
  const out = src
    .replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"))
    .replace(/\uFFFD/g, "\\uFFFD");
  if (out !== src) {
    fs.writeFileSync(path, out);
    console.log(`escaped control chars in ${f}`);
  }
}

const files = fs.readdirSync("dist/assets").map((f) => `assets/${f}`);
fs.writeFileSync("dist/artifact-files.json", JSON.stringify(files, null, 2));
console.log(`dist/artifact.html + ${files.length} files`);
