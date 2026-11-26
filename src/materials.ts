/** 아티팩트 모드용: 강의자료를 브라우저에서 읽어 텍스트/이미지로 보관 */

export async function extractPdfText(file: File, onProgress?: (done: number, total: number) => void): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      else if (text && !text.endsWith(" ") && item.str && !item.str.startsWith(" ")) text += " ";
      text += item.str;
      lastY = y;
    }
    pages.push(`[p.${i}]\n${text.replace(/[ \t]+\n/g, "\n").trim()}`);
    onProgress?.(i, doc.numPages);
  }
  await task.destroy();
  return pages.join("\n\n");
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** 여러 자료 텍스트를 프롬프트 한도 안으로 합치기 (자료별로 고르게 자름) */
export function packMaterials(items: { name: string; text: string }[], budget = 140_000): { text: string; truncated: boolean } {
  if (!items.length) return { text: "", truncated: false };
  const per = Math.floor(budget / items.length);
  let truncated = false;
  const parts = items.map(({ name, text }) => {
    let t = text;
    if (t.length > per) {
      t = t.slice(0, per) + "\n…(이하 생략)";
      truncated = true;
    }
    return `<자료 이름="${name}">\n${t}\n</자료>`;
  });
  return { text: parts.join("\n\n"), truncated };
}
