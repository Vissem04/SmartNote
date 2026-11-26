/**
 * 실행 환경 감지.
 * - 서버 모드: `npm run dev` / `npm start` → /api 서버가 Anthropic API 호출
 * - 아티팩트 모드: claude.ai 아티팩트로 열림 → window.claude.use("sample")로 보는 사람의 Claude 계정 사용
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Use = (name: string) => Promise<any>;

export interface SampleFn {
  (input: string, opts?: Record<string, unknown>): Promise<{ text: string; truncated: boolean }>;
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] } }>;
}

export interface DownloadsApi {
  save(req: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: string }>;
}

const claudeUse: Use | null = typeof window !== "undefined" && typeof (window as any).claude?.use === "function" ? (window as any).claude.use.bind((window as any).claude) : null;

/** claude.ai 아티팩트 안에서 실행 중인지 */
export const isArtifact = claudeUse !== null;

let samplePromise: Promise<SampleFn | null> | null = null;
export function getSample(): Promise<SampleFn | null> {
  if (!claudeUse) return Promise.resolve(null);
  samplePromise ??= claudeUse("sample").catch(() => null);
  return samplePromise;
}

let downloadsPromise: Promise<DownloadsApi | null> | null = null;
export function getDownloads(): Promise<DownloadsApi | null> {
  if (!claudeUse) return Promise.resolve(null);
  downloadsPromise ??= claudeUse("downloads").catch(() => null);
  return downloadsPromise;
}

/** sample 오류 코드 → 사용자 안내 문구 */
export function sampleErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case "not_granted":
      return "Claude 사용을 허용하지 않아 AI 기능을 쓸 수 없습니다. 페이지를 새로 열면 다시 허용할 수 있어요.";
    case "sampling_disabled":
      return "이 계정에서는 아티팩트의 Claude 사용이 꺼져 있습니다.";
    case "rate_limited":
      return (e as { reason?: string }).reason === "usage_limit"
        ? "Claude 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요."
        : "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.";
    case "session_expired":
      return "claude.ai 로그인이 만료되었습니다. 다시 로그인하세요.";
    case "images_unavailable":
      return "이 화면에서는 이미지를 Claude에 보낼 수 없습니다.";
    case "image_rejected":
      return "영역 이미지를 처리할 수 없습니다. 영역을 조금 작게 다시 지정해 보세요.";
    case "refused":
      return "AI가 이 요청에 대한 답변을 거절했습니다. 영역을 다시 지정해 보세요.";
    case "prompt_too_large":
      return "강의자료가 너무 깁니다. 참조할 자료 수를 줄여 주세요.";
    case "empty_completion":
      return "AI가 답을 만들지 못했습니다. 영역을 다시 지정해 보세요.";
    case "cancelled":
      return "취소되었습니다.";
    default:
      return "AI 연결에 문제가 생겼습니다. 다시 시도하세요.";
  }
}
