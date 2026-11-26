import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Check, ChevronDown, ChevronUp, Copy, GripHorizontal, Loader2, RefreshCw, Sparkles, Trash2, X, AlertTriangle, BookOpen } from "lucide-react";
import type { AnswerObj } from "../types";
import { splitVerdict } from "../api";
import { useStore } from "../store";
import { useView } from "../viewport";
import { cancelSolve, solveRegion } from "../aiSolve";

const VERDICT_UI = {
  correct: { label: "정답", cls: "ok", icon: <Check size={13} strokeWidth={3} /> },
  incorrect: { label: "오답", cls: "bad", icon: <X size={13} strokeWidth={3} /> },
  partial: { label: "부분 정답", cls: "warn", icon: <AlertTriangle size={12} /> },
} as const;

function AnswerCardInner({ a, pageId }: { a: AnswerObj; pageId: string }) {
  const [hover, setHover] = useState(false);
  const { verdict, body } = splitVerdict(a.content);

  const update = (p: Partial<AnswerObj>, record = true) =>
    useStore.getState().updateObjects(pageId, (objs) => objs.map((o) => (o.id === a.id && o.type === "answer" ? { ...o, ...p } : o)), record);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (e.pointerType === "touch" && useStore.getState().settings.penOnly) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    useStore.getState().checkpoint(pageId);
    const sx = e.clientX, sy = e.clientY, ox = a.x, oy = a.y;
    const move = (ev: PointerEvent) => {
      const z = useView.getState().zoom;
      update({ x: ox + (ev.clientX - sx) / z, y: oy + (ev.clientY - sy) / z }, false);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const remove = () => {
    cancelSolve(a.id);
    useStore.getState().updateObjects(pageId, (objs) => objs.filter((o) => o.id !== a.id));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body.trim());
      useStore.getState().toast("풀이를 복사했습니다.", "success");
    } catch {
      useStore.getState().toast("복사할 수 없는 환경입니다. 카드의 글을 직접 선택해 복사하세요.", "info");
    }
  };

  const v = verdict && verdict !== "none" ? VERDICT_UI[verdict] : null;
  const poly = a.polygon.map((p) => p.join(",")).join(" ");

  return (
    <>
      {hover && (
        <svg className="region-outline" width="100%" height="100%">
          <polygon points={poly} />
        </svg>
      )}
      <div
        className={`answer-card ${a.status} ${a.collapsed ? "collapsed" : ""}`}
        style={{ left: a.x, top: a.y, width: a.w }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <div className="answer-head" onPointerDown={startDrag}>
          <GripHorizontal size={14} className="grip" />
          <Sparkles size={15} className="spark" />
          <span className="answer-title">풀이</span>
          {a.status === "loading" && (
            <span className="answer-status">
              <Loader2 size={13} className="spin" /> {body ? "작성 중" : "푸는 중"}
            </span>
          )}
          {v && (
            <span className={`verdict ${v.cls}`}>
              {v.icon}
              {v.label}
            </span>
          )}
          <span className="spacer" />
          <button className="icon-btn sm" title="다시 풀기" onClick={() => solveRegion(pageId, a.polygon, a.id)} disabled={a.status === "loading"}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn sm" title="복사" onClick={copy} disabled={!body}>
            <Copy size={14} />
          </button>
          <button className="icon-btn sm" title={a.collapsed ? "펼치기" : "접기"} onClick={() => update({ collapsed: !a.collapsed })}>
            {a.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          <button className="icon-btn sm danger" title="삭제" onClick={remove}>
            <Trash2 size={14} />
          </button>
        </div>
        {!a.collapsed && (
          <div className="answer-body" onWheel={(e) => e.stopPropagation()}>
            {a.status === "error" ? (
              <div className="answer-error">
                <AlertTriangle size={16} />
                <span>{a.content}</span>
              </div>
            ) : body ? (
              <div className="md">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {body}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="skeleton">
                <div />
                <div />
                <div />
              </div>
            )}
            {a.materialNames.length > 0 && a.status !== "error" && (
              <div className="answer-foot">
                <BookOpen size={12} /> 참고 자료: {a.materialNames.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export const AnswerCard = memo(AnswerCardInner);
