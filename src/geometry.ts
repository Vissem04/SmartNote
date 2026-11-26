import { getStroke } from "perfect-freehand";
import type { NoteObj, Point, Rect, StrokeObj, TableObj } from "./types";

/* ---------------- 스트로크 ---------------- */

const pathCache = new WeakMap<Point[], string>();

export function strokeOptions(tool: StrokeObj["tool"], size: number, simulate: boolean) {
  return tool === "highlighter"
    ? { size, thinning: 0, smoothing: 0.6, streamline: 0.6, simulatePressure: false, last: true }
    : { size, thinning: 0.55, smoothing: 0.55, streamline: 0.45, simulatePressure: simulate, last: true };
}

export function outlineToPath(outline: number[][]): string {
  if (outline.length < 2) return "";
  const d: (string | number)[] = ["M", outline[0][0].toFixed(2), outline[0][1].toFixed(2), "Q"];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
  }
  d.push("Z");
  return d.join(" ");
}

export function strokePath(s: StrokeObj): string {
  let p = pathCache.get(s.points);
  if (p === undefined) {
    const simulate = s.points.every((pt) => pt[2] === 0.5);
    p = outlineToPath(getStroke(s.points, strokeOptions(s.tool, s.size, simulate)));
    pathCache.set(s.points, p);
  }
  return p;
}

/* ---------------- 기본 기하 ---------------- */

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: [number, number][]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function bboxOfPoints(pts: ArrayLike<{ 0: number; 1: number }>): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* ---------------- 표 ---------------- */

export const tableWidth = (t: TableObj) => t.colWidths.reduce((a, b) => a + b, 0);
export const tableHeight = (t: TableObj) => t.rowHeights.reduce((a, b) => a + b, 0);

export function prefix(arr: number[]) {
  const out = [0];
  for (const v of arr) out.push(out[out.length - 1] + v);
  return out;
}

export interface CellGroup {
  key: string; // 대표 셀 "r,c"
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 지워진 선분으로 연결된 셀을 하나의 병합 그룹으로 묶음 (union-find) */
export function tableGroups(t: TableObj): CellGroup[] {
  const R = t.rowHeights.length;
  const C = t.colWidths.length;
  const parent = Array.from({ length: R * C }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (const k of t.vRemoved) {
    const [r, c] = k.split(",").map(Number);
    if (r < R && c + 1 < C) join(r * C + c, r * C + c + 1);
  }
  for (const k of t.hRemoved) {
    const [r, c] = k.split(",").map(Number);
    if (r + 1 < R && c < C) join(r * C + c, (r + 1) * C + c);
  }
  const groups = new Map<number, CellGroup>();
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const root = find(r * C + c);
      const g = groups.get(root);
      if (!g) groups.set(root, { key: `${r},${c}`, r0: r, c0: c, r1: r, c1: c });
      else {
        g.r1 = Math.max(g.r1, r);
        g.c0 = Math.min(g.c0, c);
        g.c1 = Math.max(g.c1, c);
      }
    }
  return [...groups.values()];
}

/** 표의 그려질 선분 목록 (로컬 좌표). 외곽선 + 지워지지 않은 내부 선분 */
export function tableSegments(t: TableObj): [number, number, number, number][] {
  const xs = prefix(t.colWidths);
  const ys = prefix(t.rowHeights);
  const W = xs[xs.length - 1];
  const H = ys[ys.length - 1];
  const vr = new Set(t.vRemoved);
  const hr = new Set(t.hRemoved);
  const segs: [number, number, number, number][] = [
    [0, 0, W, 0],
    [0, H, W, H],
    [0, 0, 0, H],
    [W, 0, W, H],
  ];
  for (let c = 0; c < t.colWidths.length - 1; c++)
    for (let r = 0; r < t.rowHeights.length; r++)
      if (!vr.has(`${r},${c}`)) segs.push([xs[c + 1], ys[r], xs[c + 1], ys[r + 1]]);
  for (let r = 0; r < t.rowHeights.length - 1; r++)
    for (let c = 0; c < t.colWidths.length; c++)
      if (!hr.has(`${r},${c}`)) segs.push([xs[c], ys[r + 1], xs[c + 1], ys[r + 1]]);
  return segs;
}

/** 지우개 경로(a→b, 반경 rad)가 지나간 내부 선분을 찾아 반환 */
export function tableSegmentsHit(t: TableObj, ax: number, ay: number, bx: number, by: number, rad: number) {
  const xs = prefix(t.colWidths);
  const ys = prefix(t.rowHeights);
  const v: string[] = [];
  const h: string[] = [];
  const lax = ax - t.x, lay = ay - t.y, lbx = bx - t.x, lby = by - t.y;
  // 선분 중간 부분만 판정 (교차점 근처를 스치는 것으로 인접 선까지 지우지 않도록)
  for (let c = 0; c < t.colWidths.length - 1; c++)
    for (let r = 0; r < t.rowHeights.length; r++) {
      const x = xs[c + 1];
      const inset = Math.min(8, (ys[r + 1] - ys[r]) / 4);
      if (segSegDist(lax, lay, lbx, lby, x, ys[r] + inset, x, ys[r + 1] - inset) < rad) v.push(`${r},${c}`);
    }
  for (let r = 0; r < t.rowHeights.length - 1; r++)
    for (let c = 0; c < t.colWidths.length; c++) {
      const y = ys[r + 1];
      const inset = Math.min(8, (xs[c + 1] - xs[c]) / 4);
      if (segSegDist(lax, lay, lbx, lby, xs[c] + inset, y, xs[c + 1] - inset, y) < rad) h.push(`${r},${c}`);
    }
  return { v, h };
}

function segSegDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegment(ax, ay, cx, cy, dx, dy),
    distToSegment(bx, by, cx, cy, dx, dy),
    distToSegment(cx, cy, ax, ay, bx, by),
    distToSegment(dx, dy, ax, ay, bx, by),
  );
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/* ---------------- 객체 공통 ---------------- */

export function textHeight(t: { text: string; fontSize: number; w: number }) {
  // 대략적인 높이 추정 (선택 박스 용). 실제 DOM 높이는 렌더 시 결정됨
  const charsPerLine = Math.max(1, Math.floor(t.w / (t.fontSize * 0.62)));
  const lines = t.text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine)), 0);
  return Math.max(1, lines) * t.fontSize * 1.5 + 8;
}

export function objBBox(o: NoteObj): Rect {
  switch (o.type) {
    case "stroke": {
      const b = bboxOfPoints(o.points);
      const pad = o.size / 2 + 1;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case "text":
      return { x: o.x, y: o.y, w: o.w, h: textHeight(o) };
    case "image":
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    case "table":
      return { x: o.x, y: o.y, w: tableWidth(o), h: tableHeight(o) };
    case "answer":
      return { x: o.x, y: o.y, w: o.w, h: o.collapsed ? 44 : 200 };
  }
}

export function translateObj<T extends NoteObj>(o: T, dx: number, dy: number): T {
  if (o.type === "stroke") return { ...o, points: o.points.map(([x, y, p]) => [x + dx, y + dy, p] as Point) };
  if (o.type === "answer")
    return { ...o, x: o.x + dx, y: o.y + dy, polygon: o.polygon.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  return { ...o, x: (o as { x: number }).x + dx, y: (o as { y: number }).y + dy };
}

/** 기준점(ox,oy)을 중심으로 s배 확대/축소 */
export function scaleObj<T extends NoteObj>(o: T, ox: number, oy: number, s: number): T {
  const sx = (x: number) => ox + (x - ox) * s;
  const sy = (y: number) => oy + (y - oy) * s;
  switch (o.type) {
    case "stroke":
      return { ...o, size: Math.max(0.5, o.size * s), points: o.points.map(([x, y, p]) => [sx(x), sy(y), p] as Point) };
    case "image":
      return { ...o, x: sx(o.x), y: sy(o.y), w: o.w * s, h: o.h * s };
    case "text":
      return { ...o, x: sx(o.x), y: sy(o.y), w: o.w * s, fontSize: Math.max(6, o.fontSize * s) };
    case "table":
      return {
        ...o,
        x: sx(o.x),
        y: sy(o.y),
        colWidths: o.colWidths.map((w) => w * s),
        rowHeights: o.rowHeights.map((h) => h * s),
        fontSize: Math.max(6, o.fontSize * s),
      };
    default:
      return translateObj(o, sx((o as { x: number }).x) - (o as { x: number }).x, sy((o as { y: number }).y) - (o as { y: number }).y);
  }
}

/** 지우개: 스트로크가 점(px,py) 반경 rad 안에 닿는지 */
export function strokeHit(s: StrokeObj, ax: number, ay: number, bx: number, by: number, rad: number) {
  const r = rad + s.size / 2;
  const pts = s.points;
  if (pts.length === 1) return distToSegment(pts[0][0], pts[0][1], ax, ay, bx, by) < r;
  for (let i = 1; i < pts.length; i++) {
    if (segSegDist(ax, ay, bx, by, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < r) return true;
  }
  return false;
}

/** 올가미 선택: 객체가 다각형 안에 (대부분) 들어오는지 */
export function objInLasso(o: NoteObj, poly: [number, number][]) {
  if (o.type === "stroke") {
    const step = Math.max(1, Math.floor(o.points.length / 24));
    let inside = 0, total = 0;
    for (let i = 0; i < o.points.length; i += step) {
      total++;
      if (pointInPolygon(o.points[i][0], o.points[i][1], poly)) inside++;
    }
    return total > 0 && inside / total >= 0.6;
  }
  const b = objBBox(o);
  const corners: [number, number][] = [
    [b.x + b.w / 2, b.y + b.h / 2],
    [b.x + b.w * 0.15, b.y + b.h * 0.15],
    [b.x + b.w * 0.85, b.y + b.h * 0.85],
  ];
  return corners.filter(([x, y]) => pointInPolygon(x, y, poly)).length >= 2;
}
