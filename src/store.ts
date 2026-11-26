import { create } from "zustand";
import type { Conversion, Material, NoteObj, Notebook, Page, Settings, Template, Tool } from "./types";
import { loadAll, saveMeta, savePageObjects, deletePageObjects } from "./db";
import { debounce, uid } from "./util";

export const PAGE_W = 1200;
export const PAGE_H = 1600;

export const PEN_COLORS = ["#1f2328", "#2156d1", "#d1302f", "#1d8a4e", "#8a3ffc", "#e0761a"];
export const HL_COLORS = ["#ffe066", "#8ce99a", "#74c0fc", "#ffa8c5", "#ffc078"];
export const NOTEBOOK_COLORS = ["#4f6bed", "#e8590c", "#2f9e44", "#ae3ec9", "#1098ad", "#e03131", "#f08c00"];

interface ToolStyle {
  color: string;
  size: number;
}

interface Toast {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

interface History {
  undo: NoteObj[][];
  redo: NoteObj[][];
}

interface State {
  loaded: boolean;
  notebooks: Notebook[];
  pages: Record<string, Page>;
  materials: Material[];
  activeNotebookId: string | null;
  activePageId: string | null;

  tool: Tool;
  prevTool: Tool;
  pen: ToolStyle;
  highlighter: ToolStyle;
  eraserSize: number;
  recentColors: string[];
  tableSize: { rows: number; cols: number };
  selection: string[];
  editingId: string | null;
  conversion: Conversion | null;

  settings: Settings;
  history: Record<string, History>;
  saveState: "saved" | "saving";
  toasts: Toast[];
  panel: "materials" | "settings" | null;
  sidebarOpen: boolean;

  init(): Promise<void>;
  createNotebook(title?: string): string;
  renameNotebook(id: string, title: string): void;
  deleteNotebook(id: string): void;
  openNotebook(id: string): void;

  addPage(notebookId: string, afterPageId?: string): string;
  duplicatePage(pageId: string): void;
  deletePage(pageId: string): void;
  renamePage(pageId: string, title: string): void;
  movePage(pageId: string, toIndex: number): void;
  openPage(pageId: string): void;
  setTemplate(pageId: string, t: Template): void;
  extendPage(pageId: string): void;

  updateObjects(pageId: string, fn: (objs: NoteObj[]) => NoteObj[], record?: boolean): void;
  checkpoint(pageId: string): void;
  undo(): void;
  redo(): void;

  setTool(t: Tool): void;
  setToolStyle(tool: "pen" | "highlighter", patch: Partial<ToolStyle>): void;
  setEraserSize(n: number): void;
  setTableSize(s: { rows: number; cols: number }): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  setConversion(c: Conversion | null): void;

  addMaterial(m: Material): void;
  updateMaterial(id: string, patch: Partial<Material>): void;
  removeMaterial(id: string): void;

  setSettings(patch: Partial<Settings>): void;
  toast(text: string, kind?: Toast["kind"], action?: Toast["action"]): void;
  dismissToast(id: string): void;
  setPanel(p: State["panel"]): void;
  toggleSidebar(): void;
}

const dirtyPages = new Set<string>();
const deletedPages = new Set<string>();

function loadSettings(): Settings {
  const def: Settings = { apiKey: "", effort: "high", theme: "system", penOnly: true, penOnlyTouched: false, textSize: 20, convertMatchHandwriting: false };
  try {
    const saved = { ...def, ...JSON.parse(localStorage.getItem("smartnote:settings") ?? "{}") } as Settings;
    if (!saved.penOnlyTouched) saved.penOnly = true;
    return saved;
  } catch {
    return def;
  }
}

function newPage(notebookId: string, title: string, template: Template = "lined"): Page {
  const now = Date.now();
  return { id: uid(), notebookId, title, template, width: PAGE_W, height: PAGE_H, objects: [], createdAt: now, updatedAt: now };
}

function sampleObjects(): NoteObj[] {
  return [
    {
      id: uid(),
      type: "text",
      x: 80,
      y: 70,
      w: 1040,
      fontSize: 30,
      color: "#1f2328",
      text: "SmartNote에 오신 것을 환영합니다 👋",
    },
    {
      id: uid(),
      type: "text",
      x: 80,
      y: 140,
      w: 1000,
      fontSize: 19,
      color: "#3b4250",
      text:
        "✦ AI 풀이 (A): 문제와 내 풀이를 펜으로 둘러싸면 AI가 답을 옆에 적고, 내 답이 맞는지 채점해 줍니다.\n" +
        "✦ 텍스트 변환 (C): 손글씨를 둘러싸면 컴퓨터 글자로 바꿔 줍니다. 결과를 확인·수정한 뒤 적용하세요.\n" +
        "✦ 표 (B): 원하는 크기의 표를 넣고, 선을 드래그해 셀 크기를 바꾸고, 지우개로 선을 지우면 셀이 병합됩니다.\n" +
        "✦ 강의자료: 상단의 📚 강의자료에서 PDF를 올리면 AI가 그 자료의 표기법과 공식을 참고해 풉니다.\n" +
        "✦ 단축키: P 펜 · H 형광펜 · E 지우개 · V 올가미 · T 텍스트 · B 표 · C 텍스트 변환 · A AI 풀이 · Space+드래그 이동 · Ctrl+Z 실행취소",
    },
    {
      id: uid(),
      type: "text",
      x: 80,
      y: 330,
      w: 700,
      fontSize: 22,
      color: "#1f2328",
      text: "예제) 이차방정식 x² − 5x + 6 = 0 의 두 근의 합과 곱을 구하시오.\n\n내 답: 합 = 5, 곱 = 6",
    },
    {
      id: uid(),
      type: "table",
      x: 80,
      y: 520,
      colWidths: [180, 180, 180],
      rowHeights: [48, 48, 48],
      vRemoved: ["0,0", "0,1"],
      hRemoved: [],
      cells: { "0,0": "병합된 제목 행 (지우개로 선을 지워서 병합)", "1,0": "개념", "1,1": "공식", "1,2": "비고" },
      color: "#3b4250",
      fontSize: 16,
    },
  ];
}

const persistMeta = debounce(async () => {
  const s = useStore.getState();
  const pageMetas = Object.values(s.pages).map(({ objects: _o, ...rest }) => rest);
  const pendingPages = [...dirtyPages];
  dirtyPages.clear();
  const removed = [...deletedPages];
  deletedPages.clear();
  try {
    await saveMeta({
      notebooks: s.notebooks,
      pages: pageMetas,
      materials: s.materials.map((m) => (m.status === "uploading" ? { ...m, status: "error", error: "업로드가 중단되었습니다." } : m)),
      activeNotebookId: s.activeNotebookId,
      activePageId: s.activePageId,
    });
    await Promise.all(pendingPages.map((id) => (s.pages[id] ? savePageObjects(s.pages[id]) : Promise.resolve())));
    await Promise.all(removed.map(deletePageObjects));
    useStore.setState({ saveState: "saved" });
  } catch (e) {
    console.error(e);
    useStore.getState().toast("저장에 실패했습니다. 브라우저 저장 공간을 확인하세요.", "error");
  }
}, 600);

function scheduleSave(pageId?: string) {
  if (pageId) dirtyPages.add(pageId);
  useStore.setState({ saveState: "saving" });
  persistMeta();
}

export const useStore = create<State>()((set, get) => ({
  loaded: false,
  notebooks: [],
  pages: {},
  materials: [],
  activeNotebookId: null,
  activePageId: null,

  tool: "pen",
  prevTool: "pen",
  pen: { color: PEN_COLORS[0], size: 4 },
  highlighter: { color: HL_COLORS[0], size: 22 },
  eraserSize: 14,
  recentColors: [],
  tableSize: { rows: 3, cols: 3 },
  selection: [],
  editingId: null,
  conversion: null,

  settings: loadSettings(),
  history: {},
  saveState: "saved",
  toasts: [],
  panel: null,
  sidebarOpen: typeof window !== "undefined" ? window.innerWidth > 900 : true,

  async init() {
    let loadedData: Awaited<ReturnType<typeof loadAll>> = { meta: undefined, pages: {} };
    try {
      loadedData = await loadAll();
    } catch (e) {
      console.warn("저장된 노트를 불러올 수 없습니다 (브라우저 저장소 차단)", e);
    }
    const { meta, pages } = loadedData;
    if (meta && meta.notebooks.length) {
      set({
        loaded: true,
        notebooks: meta.notebooks,
        pages,
        materials: meta.materials ?? [],
        activeNotebookId: meta.activeNotebookId ?? meta.notebooks[0].id,
        activePageId: meta.activePageId && pages[meta.activePageId] ? meta.activePageId : meta.notebooks[0].pageIds[0],
      });
      return;
    }
    // 첫 실행: 예제 노트 생성
    const nbId = uid();
    const p = newPage(nbId, "시작하기", "grid");
    p.objects = sampleObjects();
    const now = Date.now();
    set({
      loaded: true,
      notebooks: [{ id: nbId, title: "시작하기", color: NOTEBOOK_COLORS[0], pageIds: [p.id], createdAt: now, updatedAt: now }],
      pages: { [p.id]: p },
      activeNotebookId: nbId,
      activePageId: p.id,
    });
    scheduleSave(p.id);
  },

  createNotebook(title) {
    const s = get();
    const id = uid();
    const p = newPage(id, "1페이지");
    const now = Date.now();
    const nb: Notebook = {
      id,
      title: title ?? `새 노트 ${s.notebooks.length + 1}`,
      color: NOTEBOOK_COLORS[s.notebooks.length % NOTEBOOK_COLORS.length],
      pageIds: [p.id],
      createdAt: now,
      updatedAt: now,
    };
    set({ notebooks: [nb, ...s.notebooks], pages: { ...s.pages, [p.id]: p }, activeNotebookId: id, activePageId: p.id, selection: [] });
    scheduleSave(p.id);
    return id;
  },

  renameNotebook(id, title) {
    set({ notebooks: get().notebooks.map((n) => (n.id === id ? { ...n, title, updatedAt: Date.now() } : n)) });
    scheduleSave();
  },

  deleteNotebook(id) {
    const s = get();
    const nb = s.notebooks.find((n) => n.id === id);
    if (!nb) return;
    const pages = { ...s.pages };
    nb.pageIds.forEach((pid) => {
      delete pages[pid];
      deletedPages.add(pid);
    });
    const notebooks = s.notebooks.filter((n) => n.id !== id);
    const materials = s.materials.filter((m) => m.notebookId !== id);
    set({ notebooks, pages, materials });
    if (s.activeNotebookId === id) {
      if (notebooks.length) get().openNotebook(notebooks[0].id);
      else get().createNotebook("새 노트");
    }
    scheduleSave();
  },

  openNotebook(id) {
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    set({ activeNotebookId: id, activePageId: nb.pageIds[0], selection: [], editingId: null });
    scheduleSave();
  },

  addPage(notebookId, afterPageId) {
    const s = get();
    const nb = s.notebooks.find((n) => n.id === notebookId)!;
    const ref = afterPageId ? s.pages[afterPageId] : s.pages[nb.pageIds[nb.pageIds.length - 1]];
    const p = newPage(notebookId, `${nb.pageIds.length + 1}페이지`, ref?.template ?? "lined");
    const idx = afterPageId ? nb.pageIds.indexOf(afterPageId) + 1 : nb.pageIds.length;
    const pageIds = [...nb.pageIds];
    pageIds.splice(idx, 0, p.id);
    set({
      pages: { ...s.pages, [p.id]: p },
      notebooks: s.notebooks.map((n) => (n.id === notebookId ? { ...n, pageIds, updatedAt: Date.now() } : n)),
      activePageId: p.id,
      selection: [],
    });
    scheduleSave(p.id);
    return p.id;
  },

  duplicatePage(pageId) {
    const s = get();
    const src = s.pages[pageId];
    if (!src) return;
    const p: Page = { ...src, id: uid(), title: `${src.title} (사본)`, objects: src.objects.map((o) => ({ ...o, id: uid() })), createdAt: Date.now(), updatedAt: Date.now() };
    const nb = s.notebooks.find((n) => n.id === src.notebookId)!;
    const pageIds = [...nb.pageIds];
    pageIds.splice(pageIds.indexOf(pageId) + 1, 0, p.id);
    set({
      pages: { ...s.pages, [p.id]: p },
      notebooks: s.notebooks.map((n) => (n.id === nb.id ? { ...n, pageIds } : n)),
      activePageId: p.id,
    });
    scheduleSave(p.id);
  },

  deletePage(pageId) {
    const s = get();
    const page = s.pages[pageId];
    if (!page) return;
    const nb = s.notebooks.find((n) => n.id === page.notebookId)!;
    if (nb.pageIds.length === 1) {
      get().toast("노트에는 최소 한 페이지가 있어야 합니다.", "info");
      return;
    }
    const idx = nb.pageIds.indexOf(pageId);
    const pageIds = nb.pageIds.filter((id) => id !== pageId);
    const pages = { ...s.pages };
    delete pages[pageId];
    set({
      pages,
      notebooks: s.notebooks.map((n) => (n.id === nb.id ? { ...n, pageIds } : n)),
      activePageId: s.activePageId === pageId ? pageIds[Math.max(0, idx - 1)] : s.activePageId,
    });
    // 실행 취소 지원
    get().toast(`'${page.title}' 페이지를 삭제했습니다.`, "info", {
      label: "되돌리기",
      run: () => {
        const st = get();
        const n = st.notebooks.find((x) => x.id === nb.id);
        if (!n) return;
        const ids = [...n.pageIds];
        ids.splice(idx, 0, page.id);
        set({ pages: { ...st.pages, [page.id]: page }, notebooks: st.notebooks.map((x) => (x.id === nb.id ? { ...x, pageIds: ids } : x)), activePageId: page.id });
        deletedPages.delete(page.id);
        scheduleSave(page.id);
      },
    });
    deletedPages.add(pageId);
    scheduleSave();
  },

  renamePage(pageId, title) {
    const s = get();
    set({ pages: { ...s.pages, [pageId]: { ...s.pages[pageId], title } } });
    scheduleSave();
  },

  movePage(pageId, toIndex) {
    const s = get();
    const page = s.pages[pageId];
    const nb = s.notebooks.find((n) => n.id === page.notebookId)!;
    const ids = nb.pageIds.filter((id) => id !== pageId);
    ids.splice(toIndex, 0, pageId);
    set({ notebooks: s.notebooks.map((n) => (n.id === nb.id ? { ...n, pageIds: ids } : n)) });
    scheduleSave();
  },

  openPage(pageId) {
    set({ activePageId: pageId, selection: [], editingId: null, conversion: null });
    scheduleSave();
  },

  setTemplate(pageId, template) {
    const s = get();
    set({ pages: { ...s.pages, [pageId]: { ...s.pages[pageId], template } } });
    scheduleSave();
  },

  extendPage(pageId) {
    const s = get();
    const p = s.pages[pageId];
    set({ pages: { ...s.pages, [pageId]: { ...p, height: p.height + 800 } } });
    scheduleSave();
  },

  updateObjects(pageId, fn, record = true) {
    const s = get();
    const page = s.pages[pageId];
    if (!page) return;
    const next = fn(page.objects);
    if (next === page.objects) return;
    const history = record ? pushHist(s.history, pageId, page.objects) : s.history;
    set({ pages: { ...s.pages, [pageId]: { ...page, objects: next, updatedAt: Date.now() } }, history });
    scheduleSave(pageId);
  },

  checkpoint(pageId) {
    const s = get();
    const page = s.pages[pageId];
    if (page) set({ history: pushHist(s.history, pageId, page.objects) });
  },

  undo() {
    const s = get();
    const pid = s.activePageId;
    if (!pid) return;
    const h = s.history[pid];
    if (!h?.undo.length) return;
    const prev = h.undo[h.undo.length - 1];
    const page = s.pages[pid];
    set({
      pages: { ...s.pages, [pid]: { ...page, objects: prev } },
      history: { ...s.history, [pid]: { undo: h.undo.slice(0, -1), redo: [...h.redo, page.objects] } },
      selection: [],
    });
    scheduleSave(pid);
  },

  redo() {
    const s = get();
    const pid = s.activePageId;
    if (!pid) return;
    const h = s.history[pid];
    if (!h?.redo.length) return;
    const next = h.redo[h.redo.length - 1];
    const page = s.pages[pid];
    set({
      pages: { ...s.pages, [pid]: { ...page, objects: next } },
      history: { ...s.history, [pid]: { undo: [...h.undo, page.objects], redo: h.redo.slice(0, -1) } },
      selection: [],
    });
    scheduleSave(pid);
  },

  setTool(tool) {
    const s = get();
    if (tool === s.tool) return;
    set({ tool, prevTool: s.tool, selection: tool === "select" ? s.selection : [], editingId: null });
  },

  setToolStyle(tool, patch) {
    const s = get();
    const recent = patch.color ? [patch.color, ...s.recentColors.filter((c) => c !== patch.color)].slice(0, 6) : s.recentColors;
    set({ [tool]: { ...s[tool], ...patch }, recentColors: recent } as Partial<State>);
  },

  setEraserSize(eraserSize) {
    set({ eraserSize });
  },

  setTableSize(tableSize) {
    set({ tableSize });
  },

  setSelection(selection) {
    set({ selection });
  },

  setEditing(editingId) {
    set({ editingId });
  },

  setConversion(conversion) {
    set({ conversion });
  },

  addMaterial(m) {
    set({ materials: [...get().materials, m] });
    scheduleSave();
  },

  updateMaterial(id, patch) {
    set({ materials: get().materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    scheduleSave();
  },

  removeMaterial(id) {
    set({ materials: get().materials.filter((m) => m.id !== id) });
    scheduleSave();
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    try {
      localStorage.setItem("smartnote:settings", JSON.stringify(settings));
    } catch {
      /* 저장소를 쓸 수 없는 환경: 이번 세션에만 적용 */
    }
    set({ settings });
  },

  toast(text, kind = "info", action) {
    const id = uid();
    set({ toasts: [...get().toasts, { id, text, kind, action }] });
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setPanel(panel) {
    set({ panel });
  },

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },
}));

function pushHist(h: Record<string, History>, pageId: string, objs: NoteObj[]): Record<string, History> {
  const cur = h[pageId] ?? { undo: [], redo: [] };
  const undo = [...cur.undo, objs];
  if (undo.length > 150) undo.shift();
  return { ...h, [pageId]: { undo, redo: [] } };
}

export const activePage = (s: State) => (s.activePageId ? s.pages[s.activePageId] : undefined);
export const activeNotebook = (s: State) => s.notebooks.find((n) => n.id === s.activeNotebookId);
