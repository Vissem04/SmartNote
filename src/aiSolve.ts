import { useStore } from "./store";
import { bboxOfPoints, objBBox, polygonArea, rectsIntersect } from "./geometry";
import { renderRegion } from "./render";
import { solve, splitVerdict } from "./api";
import type { AnswerObj } from "./types";
import { uid } from "./util";

const CARD_W = 400;
const running = new Map<string, AbortController>();

export function cancelSolve(answerId: string) {
  running.get(answerId)?.abort();
  running.delete(answerId);
}

/** 경계 다각형 영역을 AI로 풀이. answerId가 주어지면 해당 카드를 다시 풀이 */
export async function solveRegion(pageId: string, polygon: [number, number][], answerId?: string, extraInstruction?: string) {
  const st = useStore.getState();
  const page = st.pages[pageId];
  if (!page) return;
  if (polygonArea(polygon) < 600) {
    st.toast("영역이 너무 작습니다. 문제 전체를 넉넉히 둘러싸 주세요.", "info");
    return;
  }
  const bbox = bboxOfPoints(polygon);
  const hasContent = page.objects.some((o) => o.type !== "answer" && rectsIntersect(objBBox(o), bbox));
  if (!hasContent) {
    st.toast("둘러싼 영역 안에 문제가 없습니다.", "info");
    return;
  }

  const nb = st.notebooks.find((n) => n.id === page.notebookId);
  const materials = st.materials.filter((m) => m.notebookId === page.notebookId && m.enabled && m.status === "ready");

  let id = answerId;
  if (id) {
    cancelSolve(id);
    st.updateObjects(pageId, (objs) =>
      objs.map((o) => (o.id === id && o.type === "answer" ? { ...o, status: "loading", content: "", verdict: null, collapsed: false, materialNames: materials.map((m) => m.name) } : o)),
    );
  } else {
    const { x, y } = placeCard(page.objects, bbox, page.width);
    id = uid();
    const card: AnswerObj = {
      id,
      type: "answer",
      x,
      y,
      w: CARD_W,
      polygon,
      status: "loading",
      content: "",
      verdict: null,
      collapsed: false,
      createdAt: Date.now(),
      materialNames: materials.map((m) => m.name),
    };
    st.updateObjects(pageId, (objs) => [...objs, card]);
  }

  const { base64 } = await renderRegion(page, polygon, bbox);
  const answerIdFinal = id;
  let content = "";
  let frame = 0;
  const patch = (p: Partial<AnswerObj>) =>
    useStore.getState().updateObjects(pageId, (objs) => objs.map((o) => (o.id === answerIdFinal && o.type === "answer" ? { ...o, ...p } : o)), false);

  const ctrl = solve(
    { image: base64, materials, notebookTitle: nb?.title, extraInstruction },
    useStore.getState().settings,
    {
      onDelta(t) {
        content += t;
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            const { verdict } = splitVerdict(content);
            patch({ content, verdict });
          });
      },
      onDone() {
        cancelAnimationFrame(frame);
        running.delete(answerIdFinal);
        const { verdict } = splitVerdict(content);
        patch({ content, verdict, status: "done" });
      },
      onError(message) {
        cancelAnimationFrame(frame);
        running.delete(answerIdFinal);
        patch({ status: "error", content: message });
      },
    },
  );
  running.set(answerIdFinal, ctrl);
}

/** 답안 카드 위치: 영역 오른쪽 → 아래 → 왼쪽 → 위 순서로, 기존 내용과 겹치지 않는 곳 */
function placeCard(objs: import("./types").NoteObj[], b: import("./types").Rect, pageW: number) {
  const H = 280;
  const gap = 20;
  const boxes = objs.map(objBBox);
  const free = (x: number, y: number) =>
    x >= 8 && x + CARD_W <= pageW - 8 && y >= 8 && !boxes.some((o) => rectsIntersect(o, { x, y, w: CARD_W, h: H }));
  const cx = Math.min(Math.max(8, b.x), pageW - CARD_W - 8);
  const candidates: [number, number][] = [
    [b.x + b.w + gap, b.y],
    [cx, b.y + b.h + gap],
    [b.x - CARD_W - gap, b.y],
    [pageW - CARD_W - 12, b.y],
    [cx, b.y - H - gap],
  ];
  for (const [x, y] of candidates) if (free(x, y)) return { x, y };
  // 모두 겹치면 아래쪽으로 내려가며 빈 곳 탐색
  for (let y = b.y + b.h + gap; y < b.y + 3000; y += 40) if (free(cx, y)) return { x: cx, y };
  return { x: b.x + b.w + gap <= pageW - CARD_W ? b.x + b.w + gap : cx, y: b.y + b.h + gap };
}
