import type { Material, Settings } from "./types";

function headers(settings: Settings, json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (settings.apiKey.trim()) h["x-user-api-key"] = settings.apiKey.trim();
  return h;
}

export async function health(): Promise<{ hasServerKey: boolean; model: string } | null> {
  try {
    const r = await fetch("/api/health");
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function uploadMaterial(file: File, settings: Settings): Promise<{ fileId: string; mime: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/materials", { method: "POST", body: fd, headers: headers(settings, false) });
  const data = await r.json().catch(() => ({ error: `업로드 실패 (${r.status})` }));
  if (!r.ok) throw new Error(data.error ?? `업로드 실패 (${r.status})`);
  return data;
}

export async function deleteMaterial(fileId: string, settings: Settings) {
  await fetch(`/api/materials/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: headers(settings, false) }).catch(() => {});
}

export interface SolveHandlers {
  onDelta(text: string): void;
  onDone(): void;
  onError(message: string): void;
}

export function solve(
  args: { image: string; materials: Material[]; notebookTitle?: string; extraInstruction?: string },
  settings: Settings,
  h: SolveHandlers,
): AbortController {
  const ctrl = new AbortController();
  (async () => {
    let r: Response;
    try {
      r = await fetch("/api/solve", {
        method: "POST",
        headers: headers(settings),
        signal: ctrl.signal,
        body: JSON.stringify({
          image: args.image,
          effort: settings.effort,
          notebookTitle: args.notebookTitle,
          extraInstruction: args.extraInstruction,
          materials: args.materials.filter((m) => m.fileId).map((m) => ({ fileId: m.fileId, name: m.name, kind: m.kind })),
        }),
      });
    } catch (e) {
      if (!ctrl.signal.aborted) h.onError("서버에 연결할 수 없습니다. `npm run dev`로 서버가 실행 중인지 확인하세요.");
      return;
    }
    if (!r.ok || !r.body) {
      const data = await r.json().catch(() => ({}));
      h.onError(data.error ?? `요청 실패 (${r.status})`);
      return;
    }
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let finished = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "{}");
          if (ev === "delta") h.onDelta(data.text);
          else if (ev === "done") {
            finished = true;
            h.onDone();
          } else if (ev === "error") {
            finished = true;
            h.onError(data.message);
          }
        }
      }
      if (!finished) h.onError("응답이 중간에 끊겼습니다. 다시 시도하세요.");
    } catch {
      if (!ctrl.signal.aborted) h.onError("응답 수신 중 오류가 발생했습니다.");
    }
  })();
  return ctrl;
}

/** 스트리밍 텍스트에서 VERDICT 줄을 분리 */
export function splitVerdict(content: string): { verdict: "correct" | "incorrect" | "partial" | "none" | null; body: string } {
  const m = /^\s*VERDICT:\s*(correct|incorrect|partial|none)\s*\n?/i.exec(content);
  if (m) return { verdict: m[1].toLowerCase() as "correct", body: content.slice(m[0].length) };
  // 아직 첫 줄이 다 오지 않았으면 숨김
  if (/^\s*V(E(R(D(I(C(T(:.*)?)?)?)?)?)?)?$/i.test(content)) return { verdict: null, body: "" };
  return { verdict: null, body: content };
}
