import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { Copy, Pencil, ScanText, AArrowDown, AArrowUp, Grid3x3, Minus, Plus, Rows3, Columns3, Sparkles, Trash2, Ungroup, FilePlus2 } from "lucide-react";
import { useStore, activePage, PEN_COLORS, PAGE_H } from "../store";
import type { ImageObj, NoteObj, Page, Point, StrokeObj, TableObj, TextObj } from "../types";
import {
  objBBox,
  objInLasso,
  outlineToPath,
  scaleObj,
  strokeHit,
  strokeOptions,
  strokePath,
  tableHeight,
  tableSegmentsHit,
  tableWidth,
  translateObj,
  unionRect,
  rectsIntersect,
} from "../geometry";
import { TableView } from "./TableView";
import { AnswerCard } from "./AnswerCard";
import { useView, viewApi } from "../viewport";
import { solveRegion } from "../aiSolve";
import { convertRegion, cancelConversion } from "../handwriting";
import { ConvertPanel } from "./ConvertPanel";
import { clamp, uid } from "../util";
import { isPalmLike, isPenEraser, notePenActivity, penButtonHeld, penRecentlyActive } from "../input";
import { TEMPLATE_SPACING } from "../render";
import { FONT_FAMILY, fitTextWidth, naturalWidth } from "../text";

type XY = [number, number];

type Drag =
  | { kind: "draw"; points: Point[]; tool: "pen" | "highlighter"; color: string; size: number; simulate: boolean }
  | { kind: "erase"; last: XY; started: boolean; viaButton?: boolean; protect?: string }
  | { kind: "lasso"; pts: XY[]; purpose: "select" | "ai" | "convert" }
  | { kind: "move"; start: XY; orig: NoteObj[]; moved: boolean }
  | { kind: "scale"; origin: XY; start: XY; orig: NoteObj[] }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; lockAxis: boolean; axis: "x" | "y" | null; samples: { t: number; x: number; y: number }[] }
  | { kind: "pinch" };

/* ---------------- 개별 객체 (memo) ---------------- */

const StrokePath = memo(({ s }: { s: StrokeObj }) => <path d={strokePath(s)} fill={s.color} />);

const ImageView = memo(({ o }: { o: ImageObj }) => (
  <img className="image-obj" src={o.src} style={{ left: o.x, top: o.y, width: o.w, height: o.h }} draggable={false} alt="" />
));

const TextView = memo(({ o, editing, pageId }: { o: TextObj; editing: boolean; pageId: string }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const style: React.CSSProperties = { left: o.x, top: o.y, width: o.w, fontSize: o.fontSize, color: o.color, fontFamily: FONT_FAMILY };
  useLayoutEffect(() => {
    if (!editing) return;
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [editing]);
  if (!editing)
    return (
      <div className="text-obj" style={style} data-id={o.id}>
        {o.text}
      </div>
    );
  return (
    <textarea
      ref={ref}
      className="text-obj editing"
      style={style}
      defaultValue={o.text}
      placeholder="텍스트 입력…"
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value;
        const st = useStore.getState();
        st.setEditing(null);
        if (!text.trim()) st.updateObjects(pageId, (objs) => objs.filter((x) => x.id !== o.id), false);
        // 새로 만든 상자는 생성과 입력을 하나의 실행 취소 단계로 묶음
        else if (text !== o.text) {
          const pw = st.pages[pageId]?.width ?? 1200;
          st.updateObjects(pageId, (objs) => objs.map((x) => (x.id === o.id && x.type === "text" ? fitTextWidth({ ...x, text }, pw) : x)), o.text !== "");
        }
      }}
    />
  );
});

/* ---------------- 메인 캔버스 ---------------- */

export function Canvas() {
  const page = useStore(activePage);
  if (!page) return <div className="canvas-wrap empty" />;
  return <PageCanvas key={page.id} page={page} />;
}

let appClipboard: { objs: NoteObj[]; sig: string } | null = null;

const viewMemory = new Map<string, { x: number; y: number; z: number }>();

function PageCanvas({ page }: { page: Page }) {
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const editingId = useStore((s) => s.editingId);
  const eraserSize = useStore((s) => s.eraserSize);
  const penEraserHeld = useStore((s) => s.penEraserHeld);

  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const lassoRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<SVGCircleElement>(null);
  const view = useRef({ x: 0, y: 0, z: 1 });
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number; z: number; vx: number; vy: number } | null>(null);
  /** 현재 드래그(그리기·지우기·이동 등)를 소유한 포인터 — 다른 포인터의 이벤트는 무시 */
  const dragPointer = useRef<number | null>(null);
  const spaceDown = useRef(false);
  const [aiPending, setAiPending] = useState<XY[] | null>(null);
  const lastPos = useRef<XY | null>(null);

  const pageRef = useRef(page);
  pageRef.current = page;

  /* ----- 자동 쪽 추가: 마지막 쪽까지 내렸고 그 쪽에 내용이 있으면 아래에 새 쪽을 붙임 ----- */
  const extendingRef = useRef(false);
  const maybeExtend = () => {
    const wrap = wrapRef.current;
    if (!wrap || extendingRef.current) return;
    const p = pageRef.current;
    const v = view.current;
    const visibleBottom = (wrap.clientHeight - v.y) / v.z;
    if (visibleBottom < p.height - PAGE_H * 0.08) return; // 아직 끝까지 안 내림
    const lastTop = Math.max(0, p.height - PAGE_H);
    // 빈 쪽이 계속 쌓이지 않도록: 마지막 쪽에 뭔가 썼을 때만 추가
    const used = p.objects.some((o) => {
      const b = objBBox(o);
      return b.y + b.h > lastTop + 4;
    });
    if (!used) return;
    extendingRef.current = true;
    useStore.getState().extendPage(p.id);
  };
  useEffect(() => {
    extendingRef.current = false;
  }, [page.height]);

  /** 페이지가 화면 밖으로 사라지지 않게 이동 범위 제한 */
  const clampView = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const v = view.current;
    const p = pageRef.current;
    const pad = 140;
    const loY = Math.min(wrap.clientHeight - p.height * v.z - pad, pad), hiY = Math.max(wrap.clientHeight - p.height * v.z - pad, pad);
    v.y = clamp(v.y, loY, hiY);
    const W = wrap.clientWidth, pw = p.width * v.z;
    if (pw <= W - 16) {
      // 페이지가 화면 폭에 다 들어오면 좌우는 항상 가운데에 고정
      v.x = (W - pw) / 2;
    } else {
      const side = 24; // 확대했을 때도 좌우로는 페이지 가장자리까지만
      v.x = clamp(v.x, W - pw - side, side);
    }
  };

  /* ----- 관성 스크롤 ----- */
  const momentum = useRef<number | null>(null);
  const stopMomentum = () => {
    if (momentum.current !== null) cancelAnimationFrame(momentum.current);
    momentum.current = null;
  };
  const startMomentum = (velX: number, velY: number) => {
    stopMomentum();
    if (Math.hypot(velX, velY) < 0.25) return;
    // 너무 세게 튕겨도 과하게 날아가지 않도록 속도 상한 (px/ms)
    const MAX = 3.5;
    velX = clamp(velX, -MAX, MAX);
    velY = clamp(velY, -MAX, MAX);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      const v = view.current;
      const bx = v.x, by = v.y;
      v.x += velX * dt;
      v.y += velY * dt;
      applyView();
      // 끝에 닿으면 그 방향 속도는 멈춤
      if (Math.abs(v.x - (bx + velX * dt)) > 0.5) velX = 0;
      if (Math.abs(v.y - (by + velY * dt)) > 0.5) velY = 0;
      const decay = Math.pow(0.94, dt / 16);
      velX *= decay;
      velY *= decay;
      momentum.current = Math.hypot(velX, velY) > 0.03 ? requestAnimationFrame(step) : null;
    };
    momentum.current = requestAnimationFrame(step);
  };
  useEffect(() => stopMomentum, []);

  /* ----- 뷰포트 ----- */
  const applyView = useCallback(() => {
    clampView();
    const v = view.current;
    maybeExtend();
    if (worldRef.current) worldRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    viewMemory.set(pageRef.current.id, { ...v });
    if (useView.getState().zoom !== v.z) useView.setState({ zoom: v.z });
  }, []);

  const zoomAt = useCallback(
    (nz: number, cx: number, cy: number) => {
      const v = view.current;
      nz = clamp(nz, 0.25, 4);
      v.x = cx - ((cx - v.x) * nz) / v.z;
      v.y = cy - ((cy - v.y) * nz) / v.z;
      v.z = nz;
      applyView();
    },
    [applyView],
  );

  const fitWidth = useCallback(() => {
    const wrap = wrapRef.current!;
    const w = wrap.clientWidth;
    const z = clamp((w - 64) / pageRef.current.width, 0.25, 1.25);
    view.current = { x: (w - pageRef.current.width * z) / 2, y: 28, z };
    applyView();
  }, [applyView]);

  useLayoutEffect(() => {
    const saved = viewMemory.get(page.id);
    if (saved) {
      view.current = { ...saved };
      applyView();
    } else fitWidth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewApi.zoomBy = (f) => {
      const r = wrapRef.current!.getBoundingClientRect();
      zoomAt(view.current.z * f, r.width / 2, r.height / 2);
    };
    viewApi.setZoom = (z) => {
      const r = wrapRef.current!.getBoundingClientRect();
      zoomAt(z, r.width / 2, r.height / 2);
    };
    viewApi.fitWidth = fitWidth;
    viewApi.insertImage = (file) => insertImageFile(file);
  });

  const toPage = (clientX: number, clientY: number): XY => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = view.current;
    return [(clientX - r.left - v.x) / v.z, (clientY - r.top - v.y) / v.z];
  };

  /* ----- 휠: 이동 / Ctrl+휠: 확대 ----- */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".answer-body") && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(view.current.z * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      } else {
        stopMomentum();
        let dx = e.shiftKey ? e.deltaY : e.deltaX;
        let dy = e.shiftKey ? 0 : e.deltaY;
        // 주로 세로로 굴리는 중이면 가로 성분 무시, 주로 가로면 세로 무시 (트랙패드 흔들림 방지)
        if (Math.abs(dx) < Math.abs(dy) * 0.6) dx = 0;
        else if (Math.abs(dy) < Math.abs(dx) * 0.6) dy = 0;
        view.current.x -= dx;
        view.current.y -= dy;
        applyView();
      }
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [applyView, zoomAt]);

  /* ----- 화면 크기 변화(사이드바·회전) → 좌우 가운데 다시 맞춤 ----- */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => applyView());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [applyView]);

  /* ----- 스페이스바 누르는 동안 손 도구 ----- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        if (!spaceDown.current) {
          spaceDown.current = true;
          wrapRef.current?.classList.add("space-pan");
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        wrapRef.current?.classList.remove("space-pan");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ----- 이미지 붙여넣기 / 끌어놓기 ----- */
  const insertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const r = wrapRef.current!.getBoundingClientRect();
        const [cx, cy] = toPage(r.left + r.width / 2, r.top + r.height / 2);
        const maxW = Math.min(640, pageRef.current.width - 80);
        const s = Math.min(1, maxW / img.width);
        const w = img.width * s, h = img.height * s;
        const obj: ImageObj = {
          id: uid(),
          type: "image",
          x: clamp(cx - w / 2, 10, pageRef.current.width - w - 10),
          y: Math.max(10, cy - h / 2),
          w,
          h,
          src,
        };
        const st = useStore.getState();
        st.updateObjects(pageRef.current.id, (objs) => [...objs, obj]);
        st.setTool("select");
        st.setSelection([obj.id]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  /** 붙여넣을 위치: 마지막 포인터 위치(화면 안이면), 아니면 화면 중앙 */
  const pastePoint = (): XY => {
    const r = wrapRef.current!.getBoundingClientRect();
    const [cx, cy] = toPage(r.left + r.width / 2, r.top + r.height / 3);
    const lp = lastPos.current;
    if (lp) {
      const v = view.current;
      const sx = lp[0] * v.z + v.x, sy = lp[1] * v.z + v.y;
      if (sx > 0 && sy > 0 && sx < r.width && sy < r.height) return lp;
    }
    return [cx, cy];
  };

  /** 텍스트(문제 등) 붙여넣기 → 설정된 기본 글자 크기의 텍스트 상자 */
  const insertText = (raw: string) => {
    const text = raw.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return;
    const st = useStore.getState();
    const pw = pageRef.current.width;
    const fontSize = st.settings.textSize;
    const w = clamp(naturalWidth(text, fontSize) + 16, 160, Math.min(760, pw - 40));
    const [px, py] = pastePoint();
    const x = clamp(px, 12, pw - w - 12);
    const obj: TextObj = { id: uid(), type: "text", x, y: Math.max(12, py), w, text, fontSize, color: st.pen.color };
    // 기존 내용과 겹치면 아래쪽 빈 자리로
    const others = pageRef.current.objects.filter((o) => o.type !== "answer").map(objBBox);
    const h = objBBox(obj).h;
    while (obj.y + h < pageRef.current.height && others.some((b) => rectsIntersect(b, { x: obj.x, y: obj.y, w, h }))) obj.y += 16;
    st.updateObjects(pageRef.current.id, (objs) => [...objs, obj]);
    st.setTool("select");
    st.setSelection([obj.id]);
  };

  /* ----- 복사 / 붙여넣기 (앱 객체 → 이미지 → 텍스트 순) ----- */
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || window.getSelection()?.toString()) return;
      const st = useStore.getState();
      const sel = pageRef.current.objects.filter((o) => st.selection.includes(o.id));
      if (!sel.length || !e.clipboardData) return;
      e.preventDefault();
      // 다른 앱에 붙여넣을 때는 텍스트로, SmartNote 안에서는 객체 그대로
      const plain = sel.flatMap((o) => (o.type === "text" ? [o.text] : o.type === "table" ? Object.values(o.cells) : [])).join("\n");
      appClipboard = { objs: sel, sig: plain || `smartnote:${sel.map((o) => o.id).join(",")}` };
      e.clipboardData.setData("text/plain", appClipboard.sig);
      st.toast(`${sel.length}개 항목을 복사했습니다.`, "info");
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useStore.getState();
      const data = e.clipboardData;
      const plain = data?.getData("text/plain") ?? "";
      // 1) 방금 SmartNote에서 복사한 객체
      if (appClipboard && plain === appClipboard.sig) {
        e.preventDefault();
        const copies = appClipboard.objs.map((o) => ({ ...translateObj(o, 30, 30), id: uid() }));
        appClipboard = { ...appClipboard, objs: copies };
        st.updateObjects(pageRef.current.id, (objs) => [...objs, ...copies]);
        st.setTool("select");
        st.setSelection(copies.map((c) => c.id));
        return;
      }
      // 2) 이미지 (스크린샷한 문제 등)
      const file = [...(data?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        insertImageFile(file);
        return;
      }
      // 3) 텍스트 (복사한 문제 등) → 기본 글자 크기로
      if (plain.trim()) {
        e.preventDefault();
        insertText(plain);
      }
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  });

  /* ----- 선택 ----- */
  const selectedObjs = useMemo(() => page.objects.filter((o) => selection.includes(o.id)), [page.objects, selection]);
  const selBox = useMemo(() => selectedObjs.reduce<ReturnType<typeof objBBox> | null>((acc, o) => unionRect(acc, objBBox(o)), null), [selectedObjs]);

  const hitTest = (x: number, y: number): NoteObj | null => {
    const objs = pageRef.current.objects;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === "answer") continue;
      if (o.type === "stroke") {
        if (strokeHit(o, x, y, x, y, 6 / view.current.z)) return o;
      } else {
        const b = objBBox(o);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return o;
      }
    }
    return null;
  };

  /* ----- 포인터 이벤트 ----- */
  const onPointerDown = (e: React.PointerEvent) => {
    const wrap = wrapRef.current!;
    if ((e.target as HTMLElement).closest(".float-ui")) return;
    stopMomentum(); // 미끄러지는 중이면 닿는 순간 멈춤
    const st = useStore.getState();
    const isTouch = e.pointerType === "touch";

    if (e.pointerType === "pen") {
      notePenActivity(true);
      // 펜을 처음 쓰면 펜 전용 모드를 자동으로 켬 (설정에서 직접 끈 경우 제외)
      if (!st.settings.penOnly && !st.settings.penOnlyTouched) st.setSettings({ penOnly: true });
      // 손가락으로 화면을 움직이던 중이면 펜이 우선
      if (drag.current && (drag.current.kind === "pan" || drag.current.kind === "pinch")) {
        drag.current = null;
        pinch.current = null;
        dragPointer.current = null;
        wrap.classList.remove("panning");
      }
    }

    if (isTouch && st.settings.penOnly) {
      // 펜으로 작업 중이거나, 펜이 막 떠 있거나, 손바닥처럼 넓은 터치는 완전히 무시
      const penBusy = drag.current && drag.current.kind !== "pan" && drag.current.kind !== "pinch";
      if (penBusy || penRecentlyActive() || isPalmLike(e)) return;
    } else if (isTouch && drag.current && drag.current.kind !== "pan" && drag.current.kind !== "pinch" && dragPointer.current !== null) {
      // 펜 전용이 아니어도, 다른 포인터가 그리는 중이면 끼어들지 않음
      return;
    }

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    wrap.setPointerCapture(e.pointerId);

    // 펜 전용 모드면 손가락은 이동/확대만
    const touchNavigates = isTouch && st.settings.penOnly;
    const touches = [...pointers.current.values()].filter((p) => p.type === "touch");
    if (isTouch && touches.length === 2) {
      // 두 손가락 → 확대/이동 (손가락으로 그리던 획은 취소)
      cancelLive();
      const [a, b] = touches;
      const r = wrap.getBoundingClientRect();
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2 - r.left,
        cy: (a.y + b.y) / 2 - r.top,
        z: view.current.z,
        vx: view.current.x,
        vy: view.current.y,
      };
      drag.current = { kind: "pinch" };
      dragPointer.current = null;
      return;
    }

    // S펜 버튼을 누른 채 쓰면 지우개
    if (isPenEraser(e)) {
      const [ex, ey] = toPage(e.clientX, e.clientY);
      drag.current = { kind: "erase", last: [ex, ey], started: false, viaButton: true };
      dragPointer.current = e.pointerId;
      useStore.getState().setPenEraserHeld(true);
      eraseAlong(ex, ey, ex, ey);
      return;
    }

    if (e.button === 1 || e.button === 2 || spaceDown.current || st.tool === "hand" || touchNavigates) {
      e.preventDefault();
      stopMomentum();
      // 손가락·펜으로 끌 때는 방향 잠금 (마우스 손 도구는 자유 이동)
      drag.current = {
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        vx: view.current.x,
        vy: view.current.y,
        lockAxis: e.pointerType !== "mouse",
        axis: null,
        samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
      };
      dragPointer.current = e.pointerId;
      wrap.classList.add("panning");
      return;
    }
    // 이후 시작되는 모든 드래그는 이 포인터 소유
    dragPointer.current = e.pointerId;
    if (e.button !== 0) return;
    if (st.editingId) {
      // 편집 중 바깥 클릭 → 편집 종료만
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }

    const [x, y] = toPage(e.clientX, e.clientY);
    const pid = pageRef.current.id;

    switch (st.tool) {
      case "pen":
      case "highlighter": {
        const style = st[st.tool];
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        drag.current = { kind: "draw", points: [[x, y, pressure]], tool: st.tool, color: style.color, size: style.size, simulate: e.pointerType !== "pen" };
        renderLive();
        break;
      }
      case "eraser": {
        drag.current = { kind: "erase", last: [x, y], started: false };
        eraseAlong(x, y, x, y);
        break;
      }
      case "select": {
        if (selBox) {
          const hs = 14 / view.current.z;
          const hx = selBox.x + selBox.w, hy = selBox.y + selBox.h;
          if (Math.abs(x - hx) < hs && Math.abs(y - hy) < hs) {
            st.checkpoint(pid);
            drag.current = { kind: "scale", origin: [selBox.x, selBox.y], start: [x, y], orig: selectedObjs };
            return;
          }
          if (x >= selBox.x && x <= selBox.x + selBox.w && y >= selBox.y && y <= selBox.y + selBox.h) {
            drag.current = { kind: "move", start: [x, y], orig: selectedObjs, moved: false };
            return;
          }
        }
        const hit = hitTest(x, y);
        if (hit) {
          st.setSelection([hit.id]);
          drag.current = { kind: "move", start: [x, y], orig: [hit], moved: false };
          return;
        }
        st.setSelection([]);
        drag.current = { kind: "lasso", pts: [[x, y]], purpose: "select" };
        renderLasso();
        break;
      }
      case "convert": {
        cancelConversion();
        drag.current = { kind: "lasso", pts: [[x, y]], purpose: "convert" };
        renderLasso();
        break;
      }
      case "ai": {
        setAiPending(null);
        drag.current = { kind: "lasso", pts: [[x, y]], purpose: "ai" };
        renderLasso();
        break;
      }
      case "text": {
        const hit = hitTest(x, y);
        if (hit?.type === "text") {
          st.setEditing(hit.id);
          return;
        }
        const w = Math.min(520, pageRef.current.width - x - 20);
        const obj: TextObj = { id: uid(), type: "text", x: x - 4, y: y - 14, w: Math.max(160, w), text: "", fontSize: st.settings.textSize, color: st.pen.color };
        st.updateObjects(pid, (objs) => [...objs, obj]);
        st.setEditing(obj.id);
        e.preventDefault();
        break;
      }
      case "table": {
        const { rows, cols } = st.tableSize;
        const cw = 130, rh = 44;
        const t: TableObj = {
          id: uid(),
          type: "table",
          x: clamp(x, 10, Math.max(10, pageRef.current.width - cw * cols - 10)),
          y,
          colWidths: Array(cols).fill(cw),
          rowHeights: Array(rows).fill(rh),
          vRemoved: [],
          hRemoved: [],
          cells: {},
          color: "#2b2b2b",
          fontSize: 16,
        };
        st.updateObjects(pid, (objs) => [...objs, t]);
        st.setTool("select");
        st.setSelection([t.id]);
        st.toast("표를 만들었습니다. 선을 드래그해 크기를, 지우개로 선을 지워 셀을 병합하세요.", "success");
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") notePenActivity(); // 호버 포함 — 손바닥 판정용
    const p = pointers.current.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    const [x, y] = toPage(e.clientX, e.clientY);
    lastPos.current = [x, y];
    if (cursorRef.current) {
      cursorRef.current.setAttribute("cx", String(x));
      cursorRef.current.setAttribute("cy", String(y));
    }
    // S펜 측면 버튼: 누르는 동안만 지우개 (호버 중에도 지우개 커서 표시)
    if (e.pointerType === "pen") {
      const held = penButtonHeld(e);
      useStore.getState().setPenEraserHeld(held);
      const cur = drag.current;
      // 측면 버튼을 누른 채로 펜이 닿거나 떨어지면 브라우저는 pointerdown/up 대신
      // pointermove(buttons 2→3, 3→2)만 보낸다 → 여기서 지우기 시작/종료 처리
      if (!cur && held && (e.buttons & 1) && !useStore.getState().editingId) {
        notePenActivity(true);
        wrapRef.current?.setPointerCapture(e.pointerId);
        dragPointer.current = e.pointerId;
        drag.current = { kind: "erase", last: [x, y], started: false, viaButton: true };
        eraseAlong(x, y, x, y);
        return;
      }
      // 접촉 비트(1)가 "방금" 풀렸을 때만(button === 0) 종료. 기기에 따라 버튼만(buttons=2)으로 닿는 경우가 있어
      // 비트 1이 없다는 것만으로는 끝내지 않는다 (그 경우는 pointerup으로 끝남)
      if (cur && cur.kind === "erase" && cur.viaButton && e.pointerId === dragPointer.current && e.button === 0 && !(e.buttons & 1)) {
        notePenActivity(false);
        drag.current = null;
        dragPointer.current = null;
        return;
      }
      if (cur && e.pointerId === dragPointer.current) {
        if (held && cur.kind === "draw") {
          // 쓰는 도중 버튼을 누름 → 지금까지의 획은 저장하고 지우개로 전환
          // 펜 끝이 방금 쓴 획 위에 있으므로, 그 획은 이번 지우기에서 보호
          const protect = commitStroke(cur);
          drag.current = { kind: "erase", last: [x, y], started: false, viaButton: true, protect };
          eraseAlong(x, y, x, y);
          return;
        }
        if (!held && cur.kind === "erase" && cur.viaButton) {
          // 버튼을 뗌 → 펜(형광펜)이면 그 자리부터 다시 쓰기, 다른 도구면 지우기만 멈춤
          const st0 = useStore.getState();
          if ((e.buttons & 1) && (st0.tool === "pen" || st0.tool === "highlighter")) {
            const style = st0[st0.tool];
            drag.current = { kind: "draw", points: [[x, y, e.pressure || 0.5]], tool: st0.tool, color: style.color, size: style.size, simulate: false };
            renderLive();
          } else {
            drag.current = null;
            dragPointer.current = null;
          }
          return;
        }
      }
    }
    const d = drag.current;
    if (!d) return;
    // 드래그를 시작한 포인터의 움직임만 반영 (손바닥·다른 손가락 무시). 핀치는 두 터치를 함께 사용
    if (d.kind !== "pinch" && dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
    const pid = pageRef.current.id;
    const st = useStore.getState();

    switch (d.kind) {
      case "pinch": {
        const touches = [...pointers.current.values()].filter((t) => t.type === "touch");
        const pc = pinch.current;
        if (touches.length < 2 || !pc) return;
        const [a, b] = touches;
        const r = wrapRef.current!.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
        const nz = clamp((pc.z * dist) / pc.dist, 0.25, 4);
        view.current.z = nz;
        view.current.x = cx - ((pc.cx - pc.vx) * nz) / pc.z;
        view.current.y = cy - ((pc.cy - pc.vy) * nz) / pc.z;
        applyView();
        break;
      }
      case "pan": {
        let dx = e.clientX - d.sx;
        let dy = e.clientY - d.sy;
        if (d.lockAxis) {
          // 처음 움직인 방향으로 잠금: 확실히 가로(가로가 세로의 2배 이상)일 때만 가로, 나머지는 세로
          if (!d.axis && Math.hypot(dx, dy) > 8) d.axis = Math.abs(dx) > Math.abs(dy) * 2 ? "x" : "y";
          if (d.axis !== "x") dx = 0;
          if (d.axis !== "y") dy = 0;
        }
        view.current.x = d.vx + dx;
        view.current.y = d.vy + dy;
        const now = performance.now();
        d.samples.push({ t: now, x: e.clientX, y: e.clientY });
        while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift();
        applyView();
        break;
      }
      case "draw": {
        const evs = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
        const list = evs.length ? evs : [e.nativeEvent];
        if (e.shiftKey) {
          // Shift: 직선
          const [px, py] = toPage(e.clientX, e.clientY);
          d.points = [d.points[0], [px, py, d.points[0][2]]];
        } else {
          for (const ev of list) {
            const [px, py] = toPage(ev.clientX, ev.clientY);
            d.points.push([px, py, e.pointerType === "pen" ? ev.pressure || 0.5 : 0.5]);
          }
        }
        renderLive();
        break;
      }
      case "erase": {
        eraseAlong(d.last[0], d.last[1], x, y);
        d.last = [x, y];
        break;
      }
      case "lasso": {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) > 2 / view.current.z) {
          d.pts.push([x, y]);
          renderLasso();
        }
        break;
      }
      case "move": {
        const dx = x - d.start[0], dy = y - d.start[1];
        if (!d.moved) {
          if (Math.hypot(dx, dy) < 3 / view.current.z) return;
          st.checkpoint(pid);
          d.moved = true;
        }
        const map = new Map(d.orig.map((o) => [o.id, translateObj(o, dx, dy)]));
        st.updateObjects(pid, (objs) => objs.map((o) => map.get(o.id) ?? o), false);
        break;
      }
      case "scale": {
        const [ox, oy] = d.origin;
        const s0 = Math.hypot(d.start[0] - ox, d.start[1] - oy);
        const s = clamp(Math.hypot(x - ox, y - oy) / Math.max(1, s0), 0.1, 10);
        const map = new Map(d.orig.map((o) => [o.id, scaleObj(o, ox, oy, s)]));
        st.updateObjects(pid, (objs) => objs.map((o) => map.get(o.id) ?? o), false);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") {
      notePenActivity(false);
      useStore.getState().setPenEraserHeld(penButtonHeld(e));
    }
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    // 다른 포인터(손바닥 등)가 떨어져도 진행 중인 획은 계속
    if (d && d.kind !== "pinch" && dragPointer.current !== null && e.pointerId !== dragPointer.current) return;
    wrapRef.current?.classList.remove("panning");
    if (!d) return;
    if (d.kind === "pan" && d.lockAxis) {
      // 튕기듯 놓으면 잠긴 방향으로 관성 스크롤
      const s = d.samples;
      const a = s[0], b = s[s.length - 1];
      const dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 60) {
        let velX = (b.x - a.x) / dt, velY = (b.y - a.y) / dt;
        if (d.axis !== "x") velX = 0;
        if (d.axis !== "y") velY = 0;
        startMomentum(velX, velY);
      }
    }
    if (d.kind === "pinch") {
      if ([...pointers.current.values()].filter((p) => p.type === "touch").length < 2) {
        drag.current = null;
        pinch.current = null;
      }
      return;
    }
    drag.current = null;
    dragPointer.current = null;
    const st = useStore.getState();
    const pid = pageRef.current.id;

    if (d.kind === "draw") {
      commitStroke(d);
    } else if (d.kind === "lasso") {
      clearLasso();
      if (d.pts.length < 4) return;
      if (d.purpose === "select") {
        const ids = pageRef.current.objects.filter((o) => objInLasso(o, d.pts)).map((o) => o.id);
        st.setSelection(ids);
      } else if (d.purpose === "convert") {
        convertRegion(pid, simplify(d.pts, 1.5));
      } else {
        const poly = simplify(d.pts, 1.5);
        setAiPending(poly);
        solveRegion(pid, poly).finally(() => setAiPending(null));
      }
    }
  };

  /** 그리던 획을 페이지에 저장 */
  const commitStroke = (d: Extract<Drag, { kind: "draw" }>) => {
    liveRef.current?.setAttribute("d", "");
    if (d.points.length === 1) d.points.push([d.points[0][0] + 0.1, d.points[0][1] + 0.1, d.points[0][2]]);
    const stroke: StrokeObj = {
      id: uid(),
      type: "stroke",
      tool: d.tool,
      color: d.color,
      size: d.size,
      points: d.points.map(([x, y, p]) => [round2(x), round2(y), d.simulate ? 0.5 : round2(p)] as Point),
    };
    useStore.getState().updateObjects(pageRef.current.id, (objs) => [...objs, stroke]);
    return stroke.id;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const st = useStore.getState();
    // 그리기 도구가 아니면 어디서든 더블클릭으로 텍스트·셀 편집
    if (st.tool === "pen" || st.tool === "highlighter" || st.tool === "eraser") return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (cell) {
      st.setEditing(`${cell.dataset.table}:${cell.dataset.cell}`);
      return;
    }
    const [x, y] = toPage(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (hit?.type === "text") st.setEditing(hit.id);
  };

  /* ----- 지우개: 스트로크 삭제 + 표 선분 지우기(셀 병합) ----- */
  const eraseAlong = (ax: number, ay: number, bx: number, by: number) => {
    const d = drag.current;
    if (!d || d.kind !== "erase") return;
    const st = useStore.getState();
    const rad = st.eraserSize / 2;
    const objs = pageRef.current.objects;
    let changed = false;
    const next = objs
      .filter((o) => {
        if (o.type === "stroke" && o.id !== d.protect && strokeHit(o, ax, ay, bx, by, rad)) {
          changed = true;
          return false;
        }
        return true;
      })
      .map((o) => {
        if (o.type !== "table") return o;
        if (Math.max(ax, bx) < o.x - rad || Math.min(ax, bx) > o.x + tableWidth(o) + rad) return o;
        if (Math.max(ay, by) < o.y - rad || Math.min(ay, by) > o.y + tableHeight(o) + rad) return o;
        const { v, h } = tableSegmentsHit(o, ax, ay, bx, by, Math.max(rad, 4));
        const nv = v.filter((k) => !o.vRemoved.includes(k));
        const nh = h.filter((k) => !o.hRemoved.includes(k));
        if (!nv.length && !nh.length) return o;
        changed = true;
        return { ...o, vRemoved: [...o.vRemoved, ...nv], hRemoved: [...o.hRemoved, ...nh] };
      });
    if (!changed) return;
    if (!d.started) {
      st.checkpoint(pageRef.current.id);
      d.started = true;
    }
    st.updateObjects(pageRef.current.id, () => next, false);
  };

  /* ----- 실시간 그리기 미리보기 (React 렌더 없이 DOM 직접 갱신) ----- */
  const renderLive = () => {
    const d = drag.current;
    const el = liveRef.current;
    if (!d || d.kind !== "draw" || !el) return;
    const outline = getStroke(d.points, { ...strokeOptions(d.tool, d.size, d.simulate), last: false });
    el.setAttribute("d", outlineToPath(outline));
    el.setAttribute("fill", d.color);
    el.setAttribute("opacity", d.tool === "highlighter" ? "0.4" : "1");
    el.style.mixBlendMode = d.tool === "highlighter" ? "multiply" : "normal";
  };
  const cancelLive = () => {
    liveRef.current?.setAttribute("d", "");
    if (drag.current?.kind === "draw") drag.current = null;
  };
  const renderLasso = () => {
    const d = drag.current;
    if (!d || d.kind !== "lasso" || !lassoRef.current) return;
    lassoRef.current.setAttribute("d", "M" + d.pts.map((p) => p.join(" ")).join(" L") + (d.pts.length > 2 ? " Z" : ""));
    lassoRef.current.setAttribute("class", `lasso ${d.purpose}`);
  };
  const clearLasso = () => lassoRef.current?.setAttribute("d", "");

  /* ----- 선택 도구 모음 동작 ----- */
  const pid = page.id;
  const st = useStore.getState;
  const singleTable = selectedObjs.length === 1 && selectedObjs[0].type === "table" ? (selectedObjs[0] as TableObj) : null;
  const strokeSel = selectedObjs.filter((o): o is StrokeObj => o.type === "stroke");
  const textSel = selectedObjs.filter((o): o is TextObj => o.type === "text");
  const onlyText = textSel.length > 0 && textSel.length === selectedObjs.length;
  const setTextSize = (fn: (n: number) => number) =>
    st().updateObjects(pid, (objs) => objs.map((o) => (o.type === "text" && selection.includes(o.id) ? fitTextWidth({ ...o, fontSize: clamp(Math.round(fn(o.fontSize)), 8, 96) }, page.width) : o)));

  const delSelection = () => {
    st().updateObjects(pid, (objs) => objs.filter((o) => !selection.includes(o.id)));
    st().setSelection([]);
  };
  const dupSelection = () => {
    const copies = selectedObjs.map((o) => ({ ...translateObj(o, 24, 24), id: uid() }));
    st().updateObjects(pid, (objs) => [...objs, ...copies]);
    st().setSelection(copies.map((c) => c.id));
  };
  const recolor = (color: string) => st().updateObjects(pid, (objs) => objs.map((o) => (selection.includes(o.id) && o.type === "stroke" ? { ...o, color } : o)));
  const solveSelection = () => {
    if (!selBox) return;
    const p = 6;
    const poly: XY[] = [
      [selBox.x - p, selBox.y - p],
      [selBox.x + selBox.w + p, selBox.y - p],
      [selBox.x + selBox.w + p, selBox.y + selBox.h + p],
      [selBox.x - p, selBox.y + selBox.h + p],
    ];
    st().setSelection([]);
    solveRegion(pid, poly);
  };
  const tableOp = (fn: (t: TableObj) => TableObj) => singleTable && st().updateObjects(pid, (objs) => objs.map((o) => (o.id === singleTable.id ? fn(o as TableObj) : o)));

  const [tableEditId, tableEditKey] = editingId?.includes(":") ? editingId.split(":") : [null, null];

  /* ----- 렌더 ----- */
  const objs = page.objects;
  const showCursor = tool === "eraser" || penEraserHeld;
  const tplStyle = templateStyle(page);

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap tool-${penEraserHeld ? "eraser" : tool}`}
      onPointerLeave={(e) => e.pointerType === "pen" && useStore.getState().setPenEraserHeld(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onScroll={(e) => {
        // 포커스 등으로 브라우저가 스크롤시키면 원위치 (화면 이동은 transform으로만)
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
        if (f) insertImageFile(f);
      }}
    >
      <div ref={worldRef} className="world">
        <div className="page" style={{ width: page.width, height: page.height, ...tplStyle }}>
          {objs.map((o) => (o.type === "image" ? <ImageView key={o.id} o={o} /> : null))}
          {objs.map((o) =>
            o.type === "table" ? <TableView key={o.id} table={o} pageId={pid} tool={tool} selected={selection.includes(o.id)} editingKey={tableEditId === o.id ? tableEditKey : null} /> : null,
          )}
          {objs.map((o) => (o.type === "text" ? <TextView key={o.id} o={o} pageId={pid} editing={editingId === o.id} /> : null))}

          <svg className="ink" width={page.width} height={page.height}>
            <g className="hl-layer">{objs.map((o) => (o.type === "stroke" && o.tool === "highlighter" ? <StrokePath key={o.id} s={o} /> : null))}</g>
            <g>{objs.map((o) => (o.type === "stroke" && o.tool === "pen" ? <StrokePath key={o.id} s={o} /> : null))}</g>
            <path ref={liveRef} />
          </svg>

          {objs.map((o) => (o.type === "answer" ? <AnswerCard key={o.id} a={o} pageId={pid} /> : null))}

          <svg className="overlay" width={page.width} height={page.height}>
            <path ref={lassoRef} className="lasso" />
            {aiPending && <path className="lasso ai pending" d={"M" + aiPending.map((p) => p.join(" ")).join(" L") + " Z"} />}
            {selBox && tool === "select" && (
              <>
                <rect className="sel-box" x={selBox.x - 4} y={selBox.y - 4} width={selBox.w + 8} height={selBox.h + 8} rx={6} />
                <rect className="sel-handle" x={selBox.x + selBox.w - 7} y={selBox.y + selBox.h - 7} width={14} height={14} rx={4} />
              </>
            )}
            {showCursor && <circle ref={cursorRef} className="eraser-cursor" r={eraserSize / 2} cx={-100} cy={-100} />}
          </svg>

          {selBox && tool === "select" && !editingId && (
            <div className="sel-toolbar float-ui" style={{ left: selBox.x + selBox.w / 2, top: selBox.y - 12 }} onPointerDown={(e) => e.stopPropagation()}>
              {singleTable && (
                <>
                  <button title="행 추가" onClick={() => tableOp((t) => ({ ...t, rowHeights: [...t.rowHeights, t.rowHeights[t.rowHeights.length - 1]] }))}>
                    <Rows3 size={15} />
                    <Plus size={11} />
                  </button>
                  <button title="열 추가" onClick={() => tableOp((t) => ({ ...t, colWidths: [...t.colWidths, t.colWidths[t.colWidths.length - 1]] }))}>
                    <Columns3 size={15} />
                    <Plus size={11} />
                  </button>
                  <button title="마지막 행 삭제" disabled={singleTable.rowHeights.length < 2} onClick={() => tableOp((t) => ({ ...t, rowHeights: t.rowHeights.slice(0, -1) }))}>
                    <Rows3 size={15} />
                    <Minus size={11} />
                  </button>
                  <button title="마지막 열 삭제" disabled={singleTable.colWidths.length < 2} onClick={() => tableOp((t) => ({ ...t, colWidths: t.colWidths.slice(0, -1) }))}>
                    <Columns3 size={15} />
                    <Minus size={11} />
                  </button>
                  <button title="병합 모두 해제 (선 복원)" disabled={!singleTable.vRemoved.length && !singleTable.hRemoved.length} onClick={() => tableOp((t) => ({ ...t, vRemoved: [], hRemoved: [] }))}>
                    <Ungroup size={15} />
                  </button>
                  <button title="셀 크기 균등하게" onClick={() => tableOp((t) => {
                    const W = tableWidth(t), H = tableHeight(t);
                    return { ...t, colWidths: t.colWidths.map(() => W / t.colWidths.length), rowHeights: t.rowHeights.map(() => H / t.rowHeights.length) };
                  })}>
                    <Grid3x3 size={15} />
                  </button>
                  <span className="sep" />
                </>
              )}
              {onlyText && (
                <>
                  {textSel.length === 1 && (
                    <button title="텍스트 수정 (더블클릭)" onClick={() => st().setEditing(textSel[0].id)}>
                      <Pencil size={15} /> 수정
                    </button>
                  )}
                  <button title="글자 작게" onClick={() => setTextSize((n) => n - 2)}>
                    <AArrowDown size={16} />
                  </button>
                  <span className="size-readout">{textSel.length === 1 ? textSel[0].fontSize : "–"}</span>
                  <button title="글자 크게" onClick={() => setTextSize((n) => n + 2)}>
                    <AArrowUp size={16} />
                  </button>
                  <button title="기본 글자 크기로 맞추기" onClick={() => setTextSize(() => st().settings.textSize)}>
                    기본 크기
                  </button>
                  <span className="sep" />
                </>
              )}
              {strokeSel.length > 0 &&
                PEN_COLORS.slice(0, 5).map((c) => <button key={c} className="swatch-btn" title="색 바꾸기" onClick={() => recolor(c)}><span style={{ background: c }} /></button>)}
              {strokeSel.length > 0 && <span className="sep" />}
              {strokeSel.some((s) => s.tool === "pen") && (
                <button className="convert-btn" title="손글씨를 텍스트로 변환" onClick={() => {
                  const ids = strokeSel.filter((s) => s.tool === "pen").map((s) => s.id);
                  st().setSelection([]);
                  convertRegion(pid, null, ids);
                }}>
                  <ScanText size={15} /> 텍스트로
                </button>
              )}
              <button className="ai-btn" title="선택 영역 풀이" onClick={solveSelection}>
                <Sparkles size={15} /> 풀이
              </button>
              <button title="복제 (Ctrl+D)" onClick={dupSelection}>
                <Copy size={15} />
              </button>
              <button title="삭제 (Delete)" className="danger" onClick={delSelection}>
                <Trash2 size={15} />
              </button>
            </div>
          )}

          <ConvertPanel pageId={pid} pageWidth={page.width} pageHeight={page.height} />

          {/* 쪽 구분선 (한 노트 페이지 안에서 아래로 이어지는 쪽) */}
          {Array.from({ length: Math.max(0, Math.ceil(page.height / PAGE_H) - 1) }, (_, i) => (
            <div key={i} className="page-break" style={{ top: (i + 1) * PAGE_H }}>
              <span>{i + 2}</span>
            </div>
          ))}

          <button className="extend-page float-ui" onClick={() => useStore.getState().extendPage(pid)}>
            <FilePlus2 size={14} /> 다음 쪽 추가 · 쓰고 내리면 자동으로 추가돼요
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 보조 함수 ---------------- */

function templateStyle(page: Page): React.CSSProperties {
  switch (page.template) {
    case "lined":
      return {
        backgroundImage: `linear-gradient(to right, transparent 71px, #bdbdbd 71px, #bdbdbd 72px, transparent 72px), repeating-linear-gradient(to bottom, transparent 0, transparent ${TEMPLATE_SPACING.lined - 1}px, #dadada ${TEMPLATE_SPACING.lined - 1}px, #dadada ${TEMPLATE_SPACING.lined}px)`,
        backgroundPosition: `0 0, 0 ${120 - TEMPLATE_SPACING.lined + 1}px`,
        backgroundRepeat: "no-repeat, repeat",
        backgroundSize: "100% 100%, 100% auto",
      };
    case "grid": {
      const s = TEMPLATE_SPACING.grid;
      return {
        backgroundImage: `linear-gradient(#e4e4e4 1px, transparent 1px), linear-gradient(90deg, #e4e4e4 1px, transparent 1px)`,
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: `-1px -1px`,
      };
    }
    case "dot": {
      const s = TEMPLATE_SPACING.dot;
      return { backgroundImage: `radial-gradient(circle, #c2c2c2 1.1px, transparent 1.3px)`, backgroundSize: `${s}px ${s}px`, backgroundPosition: `${s / 2}px ${s / 2}px` };
    }
    default:
      return {};
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.tagName === "SELECT");
}

/** 점 간격이 tol 미만이면 생략 (다각형 단순화) */
function simplify(pts: XY[], tol: number): XY[] {
  const out: XY[] = [pts[0]];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= tol) out.push(p);
  }
  return out.map(([x, y]) => [round2(x), round2(y)]);
}
