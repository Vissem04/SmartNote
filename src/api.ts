import type { Material, Settings } from "./types";
import { SYSTEM_PROMPT, TRANSCRIBE_PROMPT, buildUserText } from "../shared/prompts";
import { getSample, isArtifact, sampleErrorMessage } from "./runtime";
import { dataUrlToBlob, extractPdfText, packMaterials, readAsDataUrl } from "./materials";

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

/** 강의자료 준비: 서버 모드는 Files API 업로드, 아티팩트 모드는 브라우저에서 텍스트/이미지 추출 */
export async function uploadMaterial(file: File, settings: Settings, kind: Material["kind"], onProgress?: (msg: string) => void): Promise<Partial<Material>> {
  if (isArtifact) {
    if (kind === "pdf") {
      const text = await extractPdfText(file, (d, t) => onProgress?.(`${d}/${t}쪽 읽는 중`));
      if (text.replace(/\[p\.\d+\]/g, "").trim().length < 20) throw new Error("PDF에서 글자를 찾지 못했습니다. 스캔본이면 페이지를 이미지로 올려 주세요.");
      return { localText: text };
    }
    if (kind === "text") return { localText: await file.text() };
    return { localImage: await readAsDataUrl(file) };
  }
  return uploadToServer(file, settings);
}

async function uploadToServer(file: File, settings: Settings): Promise<{ fileId: string; mime: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/materials", { method: "POST", body: fd, headers: headers(settings, false) });
  const data = await r.json().catch(() => ({ error: `업로드 실패 (${r.status})` }));
  if (!r.ok) throw new Error(data.error ?? `업로드 실패 (${r.status})`);
  return data;
}

export async function deleteMaterial(fileId: string, settings: Settings) {
  if (isArtifact) return;
  await fetch(`/api/materials/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: headers(settings, false) }).catch(() => {});
}

export async function transcribe(image: string, settings: Settings, signal?: AbortSignal): Promise<string> {
  if (isArtifact) {
    const sample = await getSample();
    if (!sample) throw new Error("이 화면에서는 AI를 사용할 수 없습니다.");
    try {
      const { text } = await sample(`${TRANSCRIBE_PROMPT}\n\n첨부한 이미지의 손글씨를 텍스트로 옮겨 주세요.`, {
        images: [dataUrlToBlob("data:image/png;base64," + image)],
        modelTier: "default",
        effort: "low",
        signal,
        cache: false,
      });
      const t = text.trim();
      return t === "[EMPTY]" ? "" : t;
    } catch (e) {
      throw new Error(sampleErrorMessage(e));
    }
  }
  let r: Response;
  try {
    r = await fetch("/api/transcribe", { method: "POST", headers: headers(settings), body: JSON.stringify({ image }), signal });
  } catch {
    throw new Error("서버에 연결할 수 없습니다. `npm run dev`로 서버가 실행 중인지 확인하세요.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `변환 실패 (${r.status})`);
  return data.text ?? "";
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
  if (isArtifact) {
    solveViaSample(args, settings, h, ctrl.signal);
    return ctrl;
  }
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

/** 아티팩트 모드 풀이: 보는 사람의 claude.ai 계정으로 Claude 호출 */
const EFFORT_MAP: Record<Settings["effort"], { modelTier: "default" | "complex"; effort: "low" | "medium" | "high" }> = {
  low: { modelTier: "default", effort: "low" },
  medium: { modelTier: "default", effort: "medium" },
  high: { modelTier: "default", effort: "high" },
  xhigh: { modelTier: "complex", effort: "high" },
};

async function solveViaSample(
  args: { image: string; materials: Material[]; notebookTitle?: string; extraInstruction?: string },
  settings: Settings,
  h: SolveHandlers,
  signal: AbortSignal,
) {
  const sample = await getSample();
  if (!sample) {
    h.onError("이 화면에서는 AI를 사용할 수 없습니다. claude.ai에서 아티팩트를 열어 주세요.");
    return;
  }
  const limits = await sample.limits().catch(() => null);
  const maxImages = limits?.images?.maxCount ?? 1;
  const textMats = args.materials.filter((m) => m.localText);
  const imageMats = args.materials.filter((m) => m.localImage).slice(0, Math.max(0, maxImages - 1));
  const packed = packMaterials(textMats.map((m) => ({ name: m.name, text: m.localText! })));
  const names = [...textMats, ...imageMats].map((m) => m.name);

  const prompt = [
    SYSTEM_PROMPT,
    packed.text ? `\n\n# 강의자료\n${packed.text}${packed.truncated ? "\n(일부 자료는 길어서 앞부분만 포함되었습니다.)" : ""}` : "",
    imageMats.length ? `\n\n두 번째 이후 이미지는 강의자료입니다: ${imageMats.map((m) => m.name).join(", ")}` : "",
    "\n\n# 요청\n첫 번째 이미지가 학생이 경계로 표시한 노트 영역입니다.\n" + buildUserText(names, args.notebookTitle, args.extraInstruction),
  ].join("");

  let last = "";
  try {
    const { text } = await sample(prompt, {
      images: [dataUrlToBlob("data:image/png;base64," + args.image), ...imageMats.map((m) => dataUrlToBlob(m.localImage!))],
      ...EFFORT_MAP[settings.effort],
      signal,
      cache: false,
      onText: ({ text }: { text: string }) => {
        const delta = text.slice(last.length);
        last = text;
        if (delta) h.onDelta(delta);
      },
    });
    const rest = text.slice(last.length);
    if (rest) h.onDelta(rest);
    h.onDone();
  } catch (e) {
    if ((e as { code?: string }).code === "cancelled") return;
    h.onError(sampleErrorMessage(e));
  }
}

/** 실행 중인 서버 연결/AI 사용 가능 여부 (설정 화면 표시용) */
export async function aiStatus(): Promise<{ mode: "artifact"; available: boolean } | { mode: "server"; health: Awaited<ReturnType<typeof health>> }> {
  if (isArtifact) return { mode: "artifact", available: !!(await getSample()) };
  return { mode: "server", health: await health() };
}
