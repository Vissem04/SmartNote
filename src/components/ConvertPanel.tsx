import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ScanText, X } from "lucide-react";
import { useStore } from "../store";
import { applyConversion, cancelConversion, convertRegion } from "../handwriting";
import { FONT_FAMILY } from "../render";
import { modKey } from "../util";
import { TEXT_SIZES } from "./TextSizeSelect";

const PANEL_W = 380;

/** 손글씨 인식 결과 미리보기 (페이지 좌표에 배치) */
export function ConvertPanel({ pageId, pageWidth, pageHeight }: { pageId: string; pageWidth: number; pageHeight: number }) {
  const c = useStore((s) => s.conversion);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (c?.status === "ready") {
      setText(c.text);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [c?.status, c?.text]);

  if (!c || c.pageId !== pageId) return null;
  const r = c.rect;
  const left = Math.min(Math.max(8, r.x), pageWidth - PANEL_W - 8);
  // 페이지 아래쪽이면 손글씨 위에 표시
  const above = r.y + r.h + 300 > pageHeight && r.y > 300;
  const retry = () => convertRegion(pageId, null, c.strokeIds);

  return (
    <>
      <div className="convert-target" style={{ left: r.x - 8, top: r.y - 8, width: r.w + 16, height: r.h + 16 }} />
      <div
        className="convert-panel float-ui"
        style={{ left, top: above ? r.y - 14 : r.y + r.h + 14, width: PANEL_W, transform: above ? "translateY(-100%)" : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="convert-head">
          <ScanText size={15} />
          <b>손글씨 → 텍스트</b>
          {c.status === "loading" && (
            <span className="answer-status">
              <Loader2 size={13} className="spin" /> 인식 중
            </span>
          )}
          <span className="spacer" />
          {c.status !== "loading" && (
            <button className="icon-btn sm" title="다시 인식" onClick={retry}>
              <RefreshCw size={14} />
            </button>
          )}
          <button className="icon-btn sm" title="닫기 (Esc)" onClick={cancelConversion}>
            <X size={15} />
          </button>
        </div>

        {c.status === "loading" && (
          <div className="skeleton convert-skel">
            <div />
            <div />
          </div>
        )}

        {c.status === "error" && (
          <div className="answer-error">
            <AlertTriangle size={16} />
            <span>{c.error}</span>
          </div>
        )}

        {c.status === "ready" && (
          <>
            <textarea
              ref={ref}
              className="convert-text"
              value={text}
              rows={Math.min(10, Math.max(2, text.split("\n").length))}
              style={{ fontFamily: FONT_FAMILY, color: c.color, fontSize: Math.min(28, Math.max(14, c.fontSize)) }}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") cancelConversion();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  applyConversion(text, true);
                }
              }}
            />
            <div className="convert-hint">인식이 틀린 부분은 여기서 바로 고칠 수 있어요.</div>
            <div className="convert-actions">
              <label className="size-select compact" title="글자 크기">
                <select
                  value={c.fontSize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    useStore.getState().setConversion({ ...c, fontSize: n });
                  }}
                >
                  {[...new Set([...TEXT_SIZES, c.fontSize])].sort((a, b) => a - b).map((n) => (
                    <option key={n} value={n}>
                      {n}px
                    </option>
                  ))}
                </select>
              </label>
              <span className="spacer" />
              <button className="btn soft" onClick={() => applyConversion(text, false)} disabled={!text.trim()}>
                아래에 추가
              </button>
              <button className="btn primary" onClick={() => applyConversion(text, true)} disabled={!text.trim()}>
                텍스트로 바꾸기 <kbd>{modKey}+↵</kbd>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
