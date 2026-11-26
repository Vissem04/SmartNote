import type { NoteObj, Page, Rect, TableObj, Template, TextObj } from "./types";
import { prefix, strokePath, tableGroups, tableSegments } from "./geometry";

export const FONT_FAMILY = `"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;

export const TEMPLATE_SPACING = { lined: 40, grid: 40, dot: 32 } as const;

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

function drawTemplate(ctx: CanvasRenderingContext2D, t: Template, w: number, h: number) {
  ctx.save();
  if (t === "lined") {
    ctx.strokeStyle = "#cfdcf0";
    ctx.lineWidth = 1;
    for (let y = 120; y < h; y += TEMPLATE_SPACING.lined) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#f2c4c4";
    ctx.beginPath();
    ctx.moveTo(72, 0);
    ctx.lineTo(72, h);
    ctx.stroke();
  } else if (t === "grid") {
    ctx.strokeStyle = "#e3e8f0";
    ctx.lineWidth = 1;
    const s = TEMPLATE_SPACING.grid;
    for (let x = s; x < w; x += s) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = s; y < h; y += s) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  } else if (t === "dot") {
    ctx.fillStyle = "#c5ccd8";
    const s = TEMPLATE_SPACING.dot;
    for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.restore();
}

/** 문자 단위 줄바꿈 (한글은 공백이 적으므로 글자 단위로 끊음) */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        // 가능하면 공백에서 끊기
        const sp = line.lastIndexOf(" ");
        if (sp > line.length * 0.5) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx: CanvasRenderingContext2D, t: TextObj) {
  ctx.save();
  ctx.font = `${t.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  const lh = t.fontSize * 1.5;
  const lines = wrapText(ctx, t.text, t.w - 8);
  lines.forEach((l, i) => ctx.fillText(l, t.x + 4, t.y + 4 + i * lh + (lh - t.fontSize) / 2));
  ctx.restore();
}

function drawTable(ctx: CanvasRenderingContext2D, t: TableObj) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "square";
  for (const [x0, y0, x1, y1] of tableSegments(t)) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  const xs = prefix(t.colWidths);
  const ys = prefix(t.rowHeights);
  ctx.font = `${t.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = "#1f2328";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const lh = t.fontSize * 1.4;
  for (const g of tableGroups(t)) {
    const text = t.cells[g.key];
    if (!text) continue;
    const x = xs[g.c0], y = ys[g.r0], w = xs[g.c1 + 1] - x, h = ys[g.r1 + 1] - y;
    const lines = wrapText(ctx, text, w - 12);
    const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + i * lh));
  }
  ctx.restore();
}

export async function drawObjects(ctx: CanvasRenderingContext2D, objs: NoteObj[]) {
  const images = await Promise.all(objs.map((o) => (o.type === "image" ? loadImage(o.src).catch(() => null) : null)));
  // 순서: 이미지 → 표 → 텍스트 → 형광펜 → 펜 (화면 렌더와 동일)
  objs.forEach((o, i) => {
    if (o.type === "image" && images[i]) ctx.drawImage(images[i]!, o.x, o.y, o.w, o.h);
  });
  objs.forEach((o) => o.type === "table" && drawTable(ctx, o));
  objs.forEach((o) => o.type === "text" && drawText(ctx, o));
  for (const tool of ["highlighter", "pen"] as const) {
    for (const o of objs) {
      if (o.type !== "stroke" || o.tool !== tool) continue;
      ctx.save();
      ctx.fillStyle = o.color;
      if (tool === "highlighter") {
        ctx.globalAlpha = 0.4;
        ctx.globalCompositeOperation = "multiply";
      }
      ctx.fill(new Path2D(strokePath(o)));
      ctx.restore();
    }
  }
}

/**
 * 경계(다각형) 영역을 PNG로 래스터화. AI 답안 카드는 제외.
 * 반환: base64 (data URL 접두사 없이)
 */
export async function renderRegion(page: Page, polygon: [number, number][], bbox: Rect, only?: NoteObj[]): Promise<{ base64: string; dataUrl: string }> {
  const pad = 12;
  const r = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + pad * 2, h: bbox.h + pad * 2 };
  const maxSide = 1800;
  const scale = Math.min(2, maxSide / Math.max(r.w, r.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-r.x, -r.y);
  // 다각형 안쪽만 (약간 넉넉하게: 경계선 위에 걸친 글자도 포함되도록 굵은 선으로 확장)
  const clip = new Path2D();
  polygon.forEach(([x, y], i) => (i ? clip.lineTo(x, y) : clip.moveTo(x, y)));
  clip.closePath();
  ctx.save();
  if (!only) ctx.clip(clip);
  await drawObjects(ctx, only ?? page.objects.filter((o) => o.type !== "answer"));
  ctx.restore();
  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, base64: dataUrl.split(",")[1] };
}

export async function renderPage(page: Page, scale = 1, withTemplate = true): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  if (withTemplate) drawTemplate(ctx, page.template, page.width, page.height);
  await drawObjects(ctx, page.objects.filter((o) => o.type !== "answer"));
  // 답안 카드는 내보내기에 텍스트 상자로 간단히 포함
  for (const a of page.objects) {
    if (a.type !== "answer" || a.status !== "done") continue;
    const body = a.content.replace(/^VERDICT:.*\n?/i, "").replace(/\$\$?/g, "").replace(/^#+\s*/gm, "").trim();
    ctx.save();
    ctx.font = `14px ${FONT_FAMILY}`;
    const lines = wrapText(ctx, body, a.w - 24).slice(0, 60);
    const h = 40 + lines.length * 20;
    ctx.fillStyle = "#f3f6ff";
    ctx.strokeStyle = "#7c8cf8";
    ctx.beginPath();
    ctx.roundRect(a.x, a.y, a.w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4f5bd5";
    ctx.font = `600 14px ${FONT_FAMILY}`;
    ctx.fillText("AI 풀이", a.x + 12, a.y + 24);
    ctx.fillStyle = "#1f2328";
    ctx.font = `14px ${FONT_FAMILY}`;
    lines.forEach((l, i) => ctx.fillText(l, a.x + 12, a.y + 48 + i * 20));
    ctx.restore();
  }
  return canvas;
}

/* -------- 썸네일 (메모리 캐시) -------- */
const thumbCache = new Map<string, { key: number; url: string }>();
export async function pageThumbnail(page: Page): Promise<string> {
  const hit = thumbCache.get(page.id);
  const key = page.updatedAt + page.objects.length * 7 + page.template.length;
  if (hit && hit.key === key) return hit.url;
  const c = await renderPage(page, 0.15);
  const url = c.toDataURL("image/png");
  thumbCache.set(page.id, { key, url });
  return url;
}
