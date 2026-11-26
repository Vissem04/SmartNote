import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { Canvas, isTyping } from "./components/Canvas";
import { MaterialsPanel, SettingsPanel, Toasts } from "./components/Panels";
import { viewApi } from "./viewport";
import { translateObj } from "./geometry";
import type { NoteObj, Tool } from "./types";
import { uid } from "./util";
import { cancelConversion } from "./handwriting";

const TOOL_KEYS: Record<string, Tool> = { p: "pen", h: "highlighter", e: "eraser", v: "select", t: "text", b: "table", a: "ai", c: "convert" };
let clipboard: NoteObj[] = [];

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const panel = useStore((s) => s.panel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    useStore.getState().init();
  }, []);

  // 테마
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const pid = st.activePageId;

      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        viewApi.zoomBy(1.2);
        return;
      }
      if (mod && k === "-") {
        e.preventDefault();
        viewApi.zoomBy(1 / 1.2);
        return;
      }
      if (mod && k === "0") {
        e.preventDefault();
        viewApi.fitWidth();
        return;
      }
      if (!pid) return;
      const page = st.pages[pid];
      const sel = page.objects.filter((o) => st.selection.includes(o.id));

      if (mod && k === "c" && sel.length) {
        clipboard = sel;
        st.toast(`${sel.length}개 항목을 복사했습니다.`, "info");
        return;
      }
      if (mod && k === "v" && clipboard.length) {
        // 이미지 붙여넣기는 Canvas의 paste 이벤트가 처리
        const copies = clipboard.map((o) => ({ ...translateObj(o, 30, 30), id: uid() }));
        clipboard = copies;
        st.updateObjects(pid, (objs) => [...objs, ...copies]);
        st.setTool("select");
        st.setSelection(copies.map((c) => c.id));
        return;
      }
      if (mod && k === "d" && sel.length) {
        e.preventDefault();
        const copies = sel.map((o) => ({ ...translateObj(o, 24, 24), id: uid() }));
        st.updateObjects(pid, (objs) => [...objs, ...copies]);
        st.setSelection(copies.map((c) => c.id));
        return;
      }
      if (mod && k === "a" && st.tool === "select") {
        e.preventDefault();
        st.setSelection(page.objects.filter((o) => o.type !== "answer").map((o) => o.id));
        return;
      }
      if (mod) return;

      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
        e.preventDefault();
        st.updateObjects(pid, (objs) => objs.filter((o) => !st.selection.includes(o.id)));
        st.setSelection([]);
        return;
      }
      if (e.key === "Escape") {
        if (st.conversion) cancelConversion();
        st.setSelection([]);
        st.setPanel(null);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const d = e.key === "]" ? 1 : -1;
        if (st.tool === "pen" || st.tool === "highlighter") {
          const cur = st[st.tool].size;
          st.setToolStyle(st.tool, { size: Math.max(1, Math.min(48, cur + d * (st.tool === "pen" ? 1 : 4))) });
        } else if (st.tool === "eraser") st.setEraserSize(Math.max(4, Math.min(60, st.eraserSize + d * 4)));
        return;
      }
      if (e.key === "PageDown" || e.key === "PageUp") {
        const nb = st.notebooks.find((n) => n.id === page.notebookId)!;
        const i = nb.pageIds.indexOf(pid) + (e.key === "PageDown" ? 1 : -1);
        if (i >= 0 && i < nb.pageIds.length) st.openPage(nb.pageIds[i]);
        return;
      }
      if (TOOL_KEYS[k] && !e.altKey) st.setTool(TOOL_KEYS[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!loaded)
    return (
      <div className="boot">
        <div className="logo big" />
      </div>
    );

  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="stage">
          <Canvas />
          <Toolbar />
        </div>
      </main>
      {panel === "materials" && <MaterialsPanel />}
      {panel === "settings" && <SettingsPanel />}
      <Toasts />
    </div>
  );
}
