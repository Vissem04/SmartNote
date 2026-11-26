import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Copy, FileText, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import type { Page } from "../types";
import { pageThumbnail } from "../render";
import { timeAgo } from "../util";

export function Sidebar() {
  const notebooks = useStore((s) => s.notebooks);
  const activeId = useStore((s) => s.activeNotebookId);
  const pages = useStore((s) => s.pages);
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const st = useStore.getState;

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return null;
    const out: { page: Page; nbTitle: string; snippet: string }[] = [];
    for (const nb of notebooks)
      for (const pid of nb.pageIds) {
        const p = pages[pid];
        if (!p) continue;
        const texts = [p.title, nb.title, ...p.objects.flatMap((o) => (o.type === "text" ? [o.text] : o.type === "table" ? Object.values(o.cells) : o.type === "answer" ? [o.content] : []))];
        const hit = texts.find((t) => t.toLowerCase().includes(query));
        if (hit) {
          const i = hit.toLowerCase().indexOf(query);
          out.push({ page: p, nbTitle: nb.title, snippet: (i > 20 ? "…" : "") + hit.slice(Math.max(0, i - 20), i + 40).replace(/\n/g, " ") });
        }
      }
    return out;
  }, [q, notebooks, pages]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">
          <BookMarked size={18} />
        </div>
        <span>SmartNote</span>
      </div>

      <div className="search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="노트·필기 텍스트 검색" />
        {q && (
          <button className="icon-btn sm" onClick={() => setQ("")}>
            <X size={14} />
          </button>
        )}
      </div>

      {results ? (
        <div className="search-results">
          <div className="section-label">검색 결과 {results.length}개</div>
          {results.map((r) => (
            <button
              key={r.page.id}
              className="result"
              onClick={() => {
                const s = st();
                if (s.activeNotebookId !== r.page.notebookId) s.openNotebook(r.page.notebookId);
                s.openPage(r.page.id);
              }}
            >
              <b>
                {r.nbTitle} · {r.page.title}
              </b>
              <span>{r.snippet}</span>
            </button>
          ))}
          {!results.length && <div className="empty-hint">일치하는 내용이 없습니다.</div>}
        </div>
      ) : (
        <>
          <div className="section-label">
            노트
            <button className="icon-btn sm" title="새 노트" onClick={() => st().createNotebook()}>
              <Plus size={15} />
            </button>
          </div>
          <div className="notebooks">
            {notebooks.map((nb) => (
              <div key={nb.id} className={`nb ${nb.id === activeId ? "active" : ""}`}>
                <div className="nb-row" onClick={() => st().openNotebook(nb.id)} onDoubleClick={() => setRenaming(nb.id)}>
                  <span className="nb-cover" style={{ background: nb.color }} />
                  {renaming === nb.id ? (
                    <InlineInput value={nb.title} onDone={(v) => { if (v.trim()) st().renameNotebook(nb.id, v.trim()); setRenaming(null); }} />
                  ) : (
                    <span className="nb-title">{nb.title}</span>
                  )}
                  <span className="nb-count">{nb.pageIds.length}</span>
                  <button
                    className="icon-btn sm nb-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === nb.id ? null : nb.id);
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {menu === nb.id && (
                    <div className="menu" onMouseLeave={() => setMenu(null)} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setRenaming(nb.id); setMenu(null); }}>
                        <Pencil size={14} /> 이름 바꾸기
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setMenu(null);
                          if (confirm(`'${nb.title}' 노트와 모든 페이지를 삭제할까요?`)) st().deleteNotebook(nb.id);
                        }}
                      >
                        <Trash2 size={14} /> 노트 삭제
                      </button>
                    </div>
                  )}
                </div>
                {nb.id === activeId && <PageList notebookId={nb.id} />}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function PageList({ notebookId }: { notebookId: string }) {
  const nb = useStore((s) => s.notebooks.find((n) => n.id === notebookId)!);
  const pages = useStore((s) => s.pages);
  const activePageId = useStore((s) => s.activePageId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const st = useStore.getState;

  return (
    <div className="page-list">
      {nb.pageIds.map((pid, i) => {
        const p = pages[pid];
        if (!p) return null;
        return (
          <div
            key={pid}
            className={`page-item ${pid === activePageId ? "active" : ""} ${overIdx === i && dragId !== pid ? "drop" : ""}`}
            draggable
            onDragStart={() => setDragId(pid)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(i);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIdx(null);
            }}
            onDrop={() => {
              if (dragId) st().movePage(dragId, i);
              setDragId(null);
              setOverIdx(null);
            }}
            onClick={() => st().openPage(pid)}
          >
            <Thumb page={p} />
            <div className="page-meta">
              {renaming === pid ? (
                <InlineInput value={p.title} onDone={(v) => { if (v.trim()) st().renamePage(pid, v.trim()); setRenaming(null); }} />
              ) : (
                <span className="page-title" onDoubleClick={() => setRenaming(pid)}>
                  {p.title}
                </span>
              )}
              <span className="page-time">{timeAgo(p.updatedAt)}</span>
            </div>
            <div className="page-actions">
              <button className="icon-btn sm" title="이름 바꾸기" onClick={(e) => { e.stopPropagation(); setRenaming(pid); }}>
                <Pencil size={13} />
              </button>
              <button className="icon-btn sm" title="복제" onClick={(e) => { e.stopPropagation(); st().duplicatePage(pid); }}>
                <Copy size={13} />
              </button>
              <button className="icon-btn sm danger" title="삭제" onClick={(e) => { e.stopPropagation(); st().deletePage(pid); }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        );
      })}
      <button className="add-page" onClick={() => st().addPage(notebookId, activePageId ?? undefined)}>
        <Plus size={15} /> 페이지 추가
      </button>
    </div>
  );
}

function Thumb({ page }: { page: Page }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => pageThumbnail(page).then((u) => alive && setUrl(u)), 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [page]);
  return <div className="thumb">{url ? <img src={url} alt="" /> : <FileText size={16} />}</div>;
}

function InlineInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      className="inline-input"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(value);
      }}
    />
  );
}
