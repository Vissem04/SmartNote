import { memo, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { TableObj, Tool } from "../types";
import { prefix, tableGroups, tableSegments } from "../geometry";
import { useStore } from "../store";
import { useView } from "../viewport";

interface Props {
  table: TableObj;
  pageId: string;
  tool: Tool;
  editingKey: string | null;
  selected: boolean;
}

const MIN_W = 28;
const MIN_H = 24;

type Handle =
  | { type: "col" | "row"; idx: number; edge: boolean }
  | { type: "corner"; sx: 1 | -1; sy: 1 | -1; edge: true }
  | { type: "move"; edge: true };

function TableViewInner({ table: t, pageId, tool, editingKey, selected }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<{ x: number; y: number } | null>(null);
  const zoom = useView((v) => v.zoom);
  const hs = Math.max(8, 12 / zoom); // 화면에서 약 12px 크기의 핸들
  const xs = prefix(t.colWidths);
  const ys = prefix(t.rowHeights);
  const W = xs[xs.length - 1];
  const H = ys[ys.length - 1];
  const groups = tableGroups(t);
  const resizable = tool === "select" || tool === "table";

  const update = (fn: (t: TableObj) => TableObj, record = false) =>
    useStore.getState().updateObjects(pageId, (objs) => objs.map((o) => (o.id === t.id && o.type === "table" ? fn(o) : o)), record);

  /**
   * 경계·꼭짓점 핸들 공통 처리
   * - 드래그: 안쪽 선/오른쪽·아래 테두리 = 행·열 크기, 꼭짓점 = 비율 유지 크기 조절, 위·왼쪽 테두리 = 표 이동
   * - 움직이지 않고 떼면(클릭): 표 삭제 탭 열기 (테두리·꼭짓점)
   */
  const startHandle = (e: React.PointerEvent, h: Handle) => {
    if (e.button !== 0) return;
    if (e.pointerType === "touch" && useStore.getState().settings.penOnly) return; // 손가락은 화면 이동으로
    e.stopPropagation();
    e.preventDefault();
    setTab(null);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const orig = t;
    const W0 = W, H0 = H;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const z = useView.getState().zoom;
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (!moved) {
        if (Math.hypot(dx, dy) * z < 4) return;
        moved = true;
        useStore.getState().checkpoint(pageId);
      }
      update(() => {
        switch (h.type) {
          case "col": {
            const colWidths = [...orig.colWidths];
            colWidths[h.idx] = Math.max(MIN_W, Math.round(orig.colWidths[h.idx] + dx));
            return { ...orig, colWidths };
          }
          case "row": {
            const rowHeights = [...orig.rowHeights];
            rowHeights[h.idx] = Math.max(MIN_H, Math.round(orig.rowHeights[h.idx] + dy));
            return { ...orig, rowHeights };
          }
          case "move":
            return { ...orig, x: orig.x + dx, y: orig.y + dy };
          case "corner": {
            // 대각선 방향 변화량의 평균으로 배율 계산 → 가로세로 비율 유지
            let k = ((W0 + h.sx * dx) / W0 + (H0 + h.sy * dy) / H0) / 2;
            const minK = Math.max(MIN_W / Math.min(...orig.colWidths), MIN_H / Math.min(...orig.rowHeights), 0.05);
            k = Math.max(minK, Math.min(k, 8));
            return {
              ...orig,
              x: h.sx < 0 ? orig.x + W0 * (1 - k) : orig.x,
              y: h.sy < 0 ? orig.y + H0 * (1 - k) : orig.y,
              colWidths: orig.colWidths.map((w) => Math.round(w * k * 10) / 10),
              rowHeights: orig.rowHeights.map((r) => Math.round(r * k * 10) / 10),
              fontSize: Math.max(8, Math.min(72, Math.round(orig.fontSize * k * 10) / 10)),
            };
          }
        }
      });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!moved && ev.type === "pointerup" && h.edge) {
        const r = rootRef.current!.getBoundingClientRect();
        const z = useView.getState().zoom;
        setTab({ x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z });
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // 탭 바깥을 누르면 닫기
  useEffect(() => {
    if (!tab) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement).closest(".table-tab")) setTab(null);
    };
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setTab(null);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [tab]);

  const deleteTable = () => {
    const st = useStore.getState();
    st.updateObjects(pageId, (objs) => objs.filter((o) => o.id !== t.id));
    st.setSelection(st.selection.filter((id) => id !== t.id));
    st.toast("표를 삭제했습니다.", "info", { label: "되돌리기", run: () => useStore.getState().undo() });
  };

  const restoreSegment = (e: React.PointerEvent, kind: "v" | "h", key: string) => {
    e.stopPropagation();
    update((tb) => (kind === "v" ? { ...tb, vRemoved: tb.vRemoved.filter((k) => k !== key) } : { ...tb, hRemoved: tb.hRemoved.filter((k) => k !== key) }), true);
  };

  const removed: { kind: "v" | "h"; key: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  if (tool === "table") {
    for (const k of t.vRemoved) {
      const [r, c] = k.split(",").map(Number);
      if (r < t.rowHeights.length && c < t.colWidths.length - 1) removed.push({ kind: "v", key: k, x0: xs[c + 1], y0: ys[r], x1: xs[c + 1], y1: ys[r + 1] });
    }
    for (const k of t.hRemoved) {
      const [r, c] = k.split(",").map(Number);
      if (r < t.rowHeights.length - 1 && c < t.colWidths.length) removed.push({ kind: "h", key: k, x0: xs[c], y0: ys[r + 1], x1: xs[c + 1], y1: ys[r + 1] });
    }
  }

  return (
    <div ref={rootRef} className={`table-obj ${selected ? "selected" : ""} ${resizable ? "editable" : ""}`} style={{ left: t.x, top: t.y, width: W, height: H }}>
      <svg className="table-lines" width={W + 4} height={H + 4} style={{ left: -2, top: -2 }}>
        <g transform="translate(2 2)" stroke={t.color} strokeWidth={1.5} strokeLinecap="square">
          {tableSegments(t).map(([a, b, c, d], i) => (
            <line key={i} x1={a} y1={b} x2={c} y2={d} />
          ))}
          {removed.map((s) => (
            <line key={s.kind + s.key} x1={s.x0} y1={s.y0} x2={s.x1} y2={s.y1} className="removed-hint" />
          ))}
        </g>
      </svg>

      {groups.map((g) => {
        const style = { left: xs[g.c0], top: ys[g.r0], width: xs[g.c1 + 1] - xs[g.c0], height: ys[g.r1 + 1] - ys[g.r0], fontSize: t.fontSize };
        if (editingKey === g.key)
          return <CellEditor key={g.key} style={style} value={t.cells[g.key] ?? ""} onDone={(v) => {
            const st = useStore.getState();
            st.setEditing(null);
            if ((t.cells[g.key] ?? "") !== v) update((tb) => ({ ...tb, cells: { ...tb.cells, [g.key]: v } }), true);
          }} />;
        return (
          <div
            key={g.key}
            className="table-cell"
            style={style}
            data-table={t.id}
            data-cell={g.key}
          >
            {t.cells[g.key]}
          </div>
        );
      })}

      {resizable && (
        <>
          {t.colWidths.map((_, i) => (
            <div
              key={`c${i}`}
              className={`resize-handle col ${i === t.colWidths.length - 1 ? "edge" : ""}`}
              style={{ left: xs[i + 1] - hs / 2, top: 0, width: hs, height: H }}
              onPointerDown={(e) => startHandle(e, { type: "col", idx: i, edge: i === t.colWidths.length - 1 })}
            />
          ))}
          {t.rowHeights.map((_, i) => (
            <div
              key={`r${i}`}
              className={`resize-handle row ${i === t.rowHeights.length - 1 ? "edge" : ""}`}
              style={{ top: ys[i + 1] - hs / 2, left: 0, height: hs, width: W }}
              onPointerDown={(e) => startHandle(e, { type: "row", idx: i, edge: i === t.rowHeights.length - 1 })}
            />
          ))}
          {/* 위·왼쪽 테두리: 드래그로 표 이동, 클릭으로 삭제 탭 */}
          <div className="resize-handle edge move" style={{ left: 0, top: -hs / 2, width: W, height: hs }} onPointerDown={(e) => startHandle(e, { type: "move", edge: true })} />
          <div className="resize-handle edge move" style={{ left: -hs / 2, top: 0, width: hs, height: H }} onPointerDown={(e) => startHandle(e, { type: "move", edge: true })} />
          {/* 꼭짓점: 드래그로 비율 유지 크기 조절, 클릭으로 삭제 탭 */}
          {([
            [-1, -1, "nwse"],
            [1, -1, "nesw"],
            [-1, 1, "nesw"],
            [1, 1, "nwse"],
          ] as const).map(([cx, cy, cur]) => (
            <div
              key={`k${cx}${cy}`}
              className={`corner-handle ${cur}`}
              style={{ left: (cx < 0 ? 0 : W) - hs * 0.75, top: (cy < 0 ? 0 : H) - hs * 0.75, width: hs * 1.5, height: hs * 1.5 }}
              onPointerDown={(e) => startHandle(e, { type: "corner", sx: cx, sy: cy, edge: true })}
            >
              <span style={{ borderWidth: Math.max(1.5, 2 / zoom) }} />
            </div>
          ))}
        </>
      )}

      {tab && (
        <div
          className="table-tab float-ui"
          style={{ left: tab.x, top: tab.y, transform: `translate(-50%, calc(-100% - ${10 / zoom}px)) scale(${1 / zoom})`, transformOrigin: "50% 100%" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="danger" onClick={deleteTable}>
            <Trash2 size={15} /> 표 삭제
          </button>
          <button className="icon-btn sm" title="닫기" onClick={() => setTab(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {removed.map((s) => (
        <div
          key={`hit${s.kind}${s.key}`}
          className="restore-hit"
          title="클릭해서 선 복원"
          style={
            s.kind === "v"
              ? { left: s.x0 - 6, top: s.y0, width: 12, height: s.y1 - s.y0 }
              : { left: s.x0, top: s.y0 - 6, width: s.x1 - s.x0, height: 12 }
          }
          onPointerDown={(e) => restoreSegment(e, s.kind, s.key)}
        />
      ))}
    </div>
  );
}

function CellEditor({ style, value, onDone }: { style: React.CSSProperties; value: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="cell-editor"
      style={style}
      defaultValue={value}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export const TableView = memo(TableViewInner);
