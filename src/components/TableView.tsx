import { memo, useEffect, useRef } from "react";
import type { TableObj, Tool } from "../types";
import { prefix, tableGroups, tableSegments } from "../geometry";
import { useStore } from "../store";
import { useView } from "../viewport";

interface Props {
  table: TableObj;
  pageId: string;
  tool: Tool;
  editingKey: string | null;
}

const MIN_W = 28;
const MIN_H = 24;

function TableViewInner({ table: t, pageId, tool, editingKey }: Props) {
  const xs = prefix(t.colWidths);
  const ys = prefix(t.rowHeights);
  const W = xs[xs.length - 1];
  const H = ys[ys.length - 1];
  const groups = tableGroups(t);
  const resizable = tool === "select" || tool === "table";

  const update = (fn: (t: TableObj) => TableObj, record = false) =>
    useStore.getState().updateObjects(pageId, (objs) => objs.map((o) => (o.id === t.id && o.type === "table" ? fn(o) : o)), record);

  /** 행/열 경계 드래그로 크기 조절 */
  const startResize = (e: React.PointerEvent, axis: "col" | "row", idx: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    useStore.getState().checkpoint(pageId);
    const start = axis === "col" ? e.clientX : e.clientY;
    const orig = axis === "col" ? t.colWidths[idx] : t.rowHeights[idx];
    const move = (ev: PointerEvent) => {
      const d = ((axis === "col" ? ev.clientX : ev.clientY) - start) / useView.getState().zoom;
      update((tb) => {
        if (axis === "col") {
          const colWidths = [...tb.colWidths];
          colWidths[idx] = Math.max(MIN_W, Math.round(orig + d));
          return { ...tb, colWidths };
        }
        const rowHeights = [...tb.rowHeights];
        rowHeights[idx] = Math.max(MIN_H, Math.round(orig + d));
        return { ...tb, rowHeights };
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
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
    <div className="table-obj" style={{ left: t.x, top: t.y, width: W, height: H }}>
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
            <div key={`c${i}`} className="resize-handle col" style={{ left: xs[i + 1] - 5, top: 0, height: H }} onPointerDown={(e) => startResize(e, "col", i)} />
          ))}
          {t.rowHeights.map((_, i) => (
            <div key={`r${i}`} className="resize-handle row" style={{ top: ys[i + 1] - 5, left: 0, width: W }} onPointerDown={(e) => startResize(e, "row", i)} />
          ))}
        </>
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
