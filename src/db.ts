import { createStore, get, set, del } from "idb-keyval";
import type { Material, Notebook, Page } from "./types";

const store = createStore("smartnote", "kv");

export interface Meta {
  notebooks: Notebook[];
  pages: Omit<Page, "objects">[];
  materials: Material[];
  activeNotebookId: string | null;
  activePageId: string | null;
}

export async function loadAll(): Promise<{ meta: Meta | undefined; pages: Record<string, Page> }> {
  const meta = await get<Meta>("meta", store);
  const pages: Record<string, Page> = {};
  if (meta) {
    await Promise.all(
      meta.pages.map(async (p) => {
        const objects = (await get(`objs:${p.id}`, store)) ?? [];
        pages[p.id] = { ...p, objects };
      }),
    );
  }
  return { meta, pages };
}

export async function saveMeta(meta: Meta) {
  await set("meta", meta, store);
}

export async function savePageObjects(page: Page) {
  await set(`objs:${page.id}`, page.objects, store);
}

export async function deletePageObjects(pageId: string) {
  await del(`objs:${pageId}`, store);
}
