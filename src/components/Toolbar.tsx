import { useState } from "react";
import { Eraser, Hand, Highlighter, Lasso, PenLine, Sparkles, Table2, Type, BookOpen } from "lucide-react";
import { useStore, PEN_COLORS, HL_COLORS } from "../store";
import type { Tool } from "../types";

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: "pen", label: "펜", key: "P", icon: <PenLine size={19} /> },
  { id: "highlighter", label: "형광펜", key: "H", icon: <Highlighter size={19} /> },
  { id: "eraser", label: "지우개 (표 선을 지우면 셀 병합)", key: "E", icon: <Eraser size={19} /> },
  { id: "select", label: "올가미 선택", key: "V", icon: <Lasso size={19} /> },
  { id: "text", label: "텍스트", key: "T", icon: <Type size={19} /> },
  { id: "table", label: "표", key: "B", icon: <Table2 size={19} /> },
  { id: "hand", label: "화면 이동", key: "Space", icon: <Hand size={19} /> },
];

const PEN_SIZES = [2, 4, 7];
const HL_SIZES = [14, 22, 32];
const ERASER_SIZES = [8, 14, 28];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="toolbar float-ui" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool-btn ${tool === t.id ? "active" : ""}`} onClick={() => setTool(t.id)} data-tip={`${t.label} (${t.key})`}>
            {t.icon}
          </button>
        ))}
        <span className="divider" />
        <button className={`tool-btn ai ${tool === "ai" ? "active" : ""}`} onClick={() => setTool("ai")} data-tip="AI 풀이: 문제를 둘러싸세요 (A)">
          <Sparkles size={18} />
          <span>AI 풀이</span>
        </button>
      </div>
      <ToolOptions />
    </div>
  );
}

function ToolOptions() {
  const tool = useStore((s) => s.tool);
  const pen = useStore((s) => s.pen);
  const hl = useStore((s) => s.highlighter);
  const eraserSize = useStore((s) => s.eraserSize);
  const recent = useStore((s) => s.recentColors);
  const setToolStyle = useStore((s) => s.setToolStyle);
  const setEraserSize = useStore((s) => s.setEraserSize);

  if (tool === "pen" || tool === "highlighter" || tool === "text") {
    const key = tool === "highlighter" ? "highlighter" : "pen";
    const style = key === "pen" ? pen : hl;
    const palette = key === "pen" ? PEN_COLORS : HL_COLORS;
    const extra = key === "pen" ? recent.filter((c) => !palette.includes(c)).slice(0, 3) : [];
    return (
      <div className="tool-options">
        {[...palette, ...extra].map((c) => (
          <button key={c} className={`swatch ${style.color === c ? "active" : ""}`} style={{ "--c": c } as React.CSSProperties} onClick={() => setToolStyle(key, { color: c })} aria-label={`색상 ${c}`} />
        ))}
        <label className="swatch custom" data-tip="사용자 색상">
          <input type="color" value={style.color} onChange={(e) => setToolStyle(key, { color: e.target.value })} />
        </label>
        {tool !== "text" && (
          <>
            <span className="divider" />
            {(key === "pen" ? PEN_SIZES : HL_SIZES).map((s) => (
              <button key={s} className={`size-btn ${style.size === s ? "active" : ""}`} onClick={() => setToolStyle(key, { size: s })} data-tip={`굵기 ${s}`}>
                <span style={{ width: Math.min(18, s * (key === "pen" ? 1.6 : 0.55)), height: Math.min(18, s * (key === "pen" ? 1.6 : 0.55)), background: key === "pen" ? style.color : style.color }} />
              </button>
            ))}
          </>
        )}
      </div>
    );
  }
  if (tool === "eraser")
    return (
      <div className="tool-options">
        <span className="hint">획 단위로 지워요 · 표의 선을 지우면 셀이 합쳐져요</span>
        <span className="divider" />
        {ERASER_SIZES.map((s) => (
          <button key={s} className={`size-btn ${eraserSize === s ? "active" : ""}`} onClick={() => setEraserSize(s)} data-tip={`크기 ${s}`}>
            <span className="ring" style={{ width: Math.min(20, s * 0.7), height: Math.min(20, s * 0.7) }} />
          </button>
        ))}
      </div>
    );
  if (tool === "table") return <TablePicker />;
  if (tool === "ai") return <AiHint />;
  if (tool === "select")
    return (
      <div className="tool-options">
        <span className="hint">드래그로 둘러싸서 선택 · 모서리 핸들로 크기 조절 · 표 선 드래그로 셀 크기 조절</span>
      </div>
    );
  return null;
}

function TablePicker() {
  const size = useStore((s) => s.tableSize);
  const setTableSize = useStore((s) => s.setTableSize);
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const shown = hover ?? size;
  const N = 8;
  return (
    <div className="tool-options table-picker">
      <div className="grid-picker" onPointerLeave={() => setHover(null)}>
        {Array.from({ length: N * N }, (_, i) => {
          const r = Math.floor(i / N) + 1, c = (i % N) + 1;
          const on = r <= shown.rows && c <= shown.cols;
          return (
            <span
              key={i}
              className={on ? "on" : ""}
              onPointerEnter={() => setHover({ rows: r, cols: c })}
              onClick={() => setTableSize({ rows: r, cols: c })}
            />
          );
        })}
      </div>
      <div className="picker-label">
        <b>
          {shown.rows} × {shown.cols}
        </b>
        <span>크기를 고른 뒤 페이지를 클릭하세요</span>
        <span className="muted">점선 = 지운 선 (클릭해서 복원)</span>
      </div>
    </div>
  );
}

function AiHint() {
  const nbId = useStore((s) => s.activeNotebookId);
  const count = useStore((s) => s.materials.filter((m) => m.notebookId === nbId && m.enabled && m.status === "ready").length);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <div className="tool-options">
      <span className="hint ai">문제(와 내 풀이)를 펜으로 둘러싸면 AI가 풀고 채점해요</span>
      <span className="divider" />
      <button className={`chip ${count ? "on" : ""}`} onClick={() => setPanel("materials")}>
        <BookOpen size={14} /> 강의자료 {count ? `${count}개 참조` : "없음"}
      </button>
    </div>
  );
}
