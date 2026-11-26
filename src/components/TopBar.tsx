import { useState } from "react";
import { BookOpen, Check, ChevronDown, Download, FileImage, FileText, ImagePlus, Loader2, Maximize2, Minus, Moon, PanelLeft, Plus, Redo2, Settings, Sun, Undo2 } from "lucide-react";
import { useStore, activeNotebook, activePage } from "../store";
import { useView, viewApi } from "../viewport";
import type { Template } from "../types";
import { renderPage } from "../render";
import { modKey } from "../util";

const TEMPLATES: { id: Template; label: string }[] = [
  { id: "blank", label: "무지" },
  { id: "lined", label: "줄 노트" },
  { id: "grid", label: "모눈" },
  { id: "dot", label: "도트" },
];

export function TopBar() {
  const nb = useStore(activeNotebook);
  const page = useStore(activePage);
  const saveState = useStore((s) => s.saveState);
  const canUndo = useStore((s) => (s.activePageId ? (s.history[s.activePageId]?.undo.length ?? 0) > 0 : false));
  const canRedo = useStore((s) => (s.activePageId ? (s.history[s.activePageId]?.redo.length ?? 0) > 0 : false));
  const zoom = useView((s) => s.zoom);
  const theme = useStore((s) => s.settings.theme);
  const matCount = useStore((s) => s.materials.filter((m) => m.notebookId === s.activeNotebookId && m.enabled && m.status === "ready").length);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = useStore.getState;

  const isDark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

  const exportPng = async () => {
    if (!page) return;
    setExportOpen(false);
    const c = await renderPage(page, 2);
    download(c.toDataURL("image/png"), `${nb?.title ?? "note"}-${page.title}.png`);
  };

  const exportPdf = async () => {
    if (!nb) return;
    setExportOpen(false);
    setBusy(true);
    try {
      const { jsPDF } = await import("jspdf");
      const pages = nb.pageIds.map((id) => st().pages[id]).filter(Boolean);
      let doc: InstanceType<typeof jsPDF> | null = null;
      for (const p of pages) {
        const c = await renderPage(p, 1.5);
        const orient = p.width > p.height ? "l" : "p";
        if (!doc) doc = new jsPDF({ orientation: orient, unit: "px", format: [p.width, p.height], hotfixes: ["px_scaling"] });
        else doc.addPage([p.width, p.height], orient);
        doc.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, p.width, p.height);
      }
      doc?.save(`${nb.title}.pdf`);
      st().toast("PDF로 내보냈습니다.", "success");
    } catch (e) {
      console.error(e);
      st().toast("PDF 내보내기에 실패했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="topbar">
      <button className="icon-btn" title="사이드바" onClick={() => st().toggleSidebar()}>
        <PanelLeft size={18} />
      </button>
      <div className="crumb">
        <span className="crumb-nb" style={{ "--c": nb?.color } as React.CSSProperties}>
          {nb?.title}
        </span>
        <span className="crumb-sep">/</span>
        <span className="crumb-page">{page?.title}</span>
        <span className={`save-state ${saveState}`}>
          {saveState === "saving" ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
          {saveState === "saving" ? "저장 중" : "저장됨"}
        </span>
      </div>

      <div className="topbar-group">
        <button className="icon-btn" title={`실행 취소 (${modKey}+Z)`} disabled={!canUndo} onClick={() => st().undo()}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" title={`다시 실행 (${modKey}+Shift+Z)`} disabled={!canRedo} onClick={() => st().redo()}>
          <Redo2 size={17} />
        </button>
      </div>

      <div className="topbar-group zoom">
        <button className="icon-btn" title="축소" onClick={() => viewApi.zoomBy(1 / 1.2)}>
          <Minus size={15} />
        </button>
        <button className="zoom-label" title="100%로" onClick={() => viewApi.setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" title="확대" onClick={() => viewApi.zoomBy(1.2)}>
          <Plus size={15} />
        </button>
        <button className="icon-btn" title="폭에 맞추기" onClick={() => viewApi.fitWidth()}>
          <Maximize2 size={14} />
        </button>
      </div>

      <span className="spacer" />

      {page && (
        <div className="select-wrap" title="페이지 배경">
          <select value={page.template} onChange={(e) => st().setTemplate(page.id, e.target.value as Template)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      )}

      <label className="icon-btn" title="이미지 삽입 (붙여넣기·끌어놓기도 가능)">
        <ImagePlus size={17} />
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) viewApi.insertImage(f);
            e.target.value = "";
          }}
        />
      </label>

      <button className={`btn soft ${matCount ? "accent" : ""}`} onClick={() => st().setPanel("materials")}>
        <BookOpen size={16} />
        <span className="hide-sm">강의자료</span>
        {matCount > 0 && <span className="badge">{matCount}</span>}
      </button>

      <div className="dropdown">
        <button className="btn soft" onClick={() => setExportOpen(!exportOpen)} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          <span className="hide-sm">내보내기</span>
        </button>
        {exportOpen && (
          <div className="menu right" onMouseLeave={() => setExportOpen(false)}>
            <button onClick={exportPng}>
              <FileImage size={15} /> 현재 페이지 PNG
            </button>
            <button onClick={exportPdf}>
              <FileText size={15} /> 노트 전체 PDF
            </button>
          </div>
        )}
      </div>

      <button className="icon-btn" title="테마 전환" onClick={() => st().setSettings({ theme: isDark ? "light" : "dark" })}>
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <button className="icon-btn" title="설정" onClick={() => st().setPanel("settings")}>
        <Settings size={17} />
      </button>
    </header>
  );
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
}
