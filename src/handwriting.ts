import { useStore } from "./store";
import { bboxOfPoints, objBBox, objInLasso, polygonArea, unionRect } from "./geometry";
import { FONT_FAMILY, renderRegion } from "./render";
import { transcribe } from "./api";
import type { Rect, StrokeObj, TextObj } from "./types";
import { uid } from "./util";

let ctrl: AbortController | null = null;

export function cancelConversion() {
  ctrl?.abort();
  ctrl = null;
  useStore.getState().setConversion(null);
}

/** 경계 안의 펜 획(또는 지정한 획)을 인식해 미리보기 상태로 만든다 */
export async function convertRegion(pageId: string, polygon: [number, number][] | null, strokeIds?: string[]) {
  const st = useStore.getState();
  const page = st.pages[pageId];
  if (!page) return;
  if (polygon && polygonArea(polygon) < 300) return;

  const strokes = page.objects.filter(
    (o): o is StrokeObj =>
      o.type === "stroke" && o.tool === "pen" && (strokeIds ? strokeIds.includes(o.id) : objInLasso(o, polygon!)),
  );
  if (!strokes.length) {
    st.toast("둘러싼 영역에 손글씨(펜 획)가 없습니다.", "info");
    return;
  }

  const rect = strokes.reduce<Rect | null>((acc, s) => unionRect(acc, objBBox(s)), null)!;
  const poly: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];

  ctrl?.abort();
  ctrl = new AbortController();
  const signal = ctrl.signal;
  const base = { pageId, strokeIds: strokes.map((s) => s.id), rect, fontSize: estimateFontSize(strokes), color: dominantColor(strokes) };
  st.setConversion({ ...base, status: "loading", text: "" });

  try {
    // 선택된 획만 그려서 인식 (주변 글자·표가 섞이지 않도록)
    const { base64 } = await renderRegion(page, poly, rect, strokes);
    const text = await transcribe(base64, st.settings, signal);
    if (signal.aborted) return;
    if (!text.trim()) {
      useStore.getState().setConversion({ ...base, status: "error", text: "", error: "읽을 수 있는 손글씨를 찾지 못했습니다." });
      return;
    }
    useStore.getState().setConversion({ ...base, status: "ready", text });
  } catch (e) {
    if (signal.aborted) return;
    useStore.getState().setConversion({ ...base, status: "error", text: "", error: (e as Error).message });
  }
}

/** 미리보기 확정: replace=true면 손글씨를 지우고 그 자리에 텍스트, false면 아래에 텍스트 추가 */
export function applyConversion(text: string, replace: boolean) {
  const st = useStore.getState();
  const c = st.conversion;
  if (!c || !text.trim()) return;
  const page = st.pages[c.pageId];
  // 텍스트가 오른쪽 여백을 넘으면 상자를 왼쪽으로 옮겨 줄바꿈을 최소화
  const want = Math.min(Math.max(c.rect.w + 24, measureWidth(text, c.fontSize) + 16, 160), page.width - 16);
  const x = Math.max(8, Math.min(c.rect.x - 4, page.width - want - 8));
  const w = Math.min(want, page.width - x - 8);
  const obj: TextObj = {
    id: uid(),
    type: "text",
    x,
    y: replace ? c.rect.y - 4 : c.rect.y + c.rect.h + 12,
    w,
    text: text.trimEnd(),
    fontSize: c.fontSize,
    color: c.color,
  };
  st.updateObjects(c.pageId, (objs) => [...(replace ? objs.filter((o) => !c.strokeIds.includes(o.id)) : objs), obj]);
  st.setConversion(null);
  st.setSelection([]);
  st.toast(replace ? "손글씨를 텍스트로 바꿨습니다. 실행 취소로 되돌릴 수 있어요." : "텍스트를 추가했습니다.", "success");
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measureWidth(text: string, fontSize: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = `${fontSize}px ${FONT_FAMILY}`;
  return Math.max(...text.split("\n").map((l) => measureCtx!.measureText(l).width));
}

/** 획들의 줄 높이로 글자 크기 추정 */
function estimateFontSize(strokes: StrokeObj[]) {
  const hs = strokes
    .map((s) => bboxOfPoints(s.points).h)
    .filter((h) => h > 4)
    .sort((a, b) => a - b);
  if (!hs.length) return 20;
  // 획 높이의 75번째 백분위 ≈ 한 글자 높이
  const h = hs[Math.floor(hs.length * 0.75)];
  return Math.round(Math.min(44, Math.max(14, h * 0.85)));
}

function dominantColor(strokes: StrokeObj[]) {
  const count = new Map<string, number>();
  for (const s of strokes) count.set(s.color, (count.get(s.color) ?? 0) + s.points.length);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
