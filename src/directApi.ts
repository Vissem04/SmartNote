/**
 * 설치형 앱(안드로이드 APK) 모드: 서버 없이 기기에서 Anthropic API를 직접 호출.
 * API 키는 앱 설정에 입력하며 이 기기에만 저장된다.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Material, Settings } from "./types";
import { SYSTEM_PROMPT, TRANSCRIBE_PROMPT, buildUserText } from "../shared/prompts";
import { packMaterials } from "./materials";
import type { SolveHandlers } from "./api";

const MODEL = "claude-opus-5-5";

async function makeClient(settings: Settings) {
  const key = settings.apiKey.trim();
  if (!key) throw new Error("설정에서 Anthropic API 키를 입력하세요.");
  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
  // 사용자 본인 기기·본인 키로만 쓰는 앱이므로 브라우저(WebView)에서 직접 호출 허용
  return { client: new AnthropicSDK({ apiKey: key, dangerouslyAllowBrowser: true }), SDK: AnthropicSDK };
}

function errorMessage(SDK: typeof Anthropic | null, err: unknown): string {
  if (SDK) {
    if (err instanceof SDK.AuthenticationError) return "API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.";
    if (err instanceof SDK.PermissionDeniedError) return "이 API 키로는 사용할 권한이 없습니다.";
    if (err instanceof SDK.RateLimitError) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
    if (err instanceof SDK.BadRequestError) return `요청 오류: ${err.message}`;
    if (err instanceof SDK.APIConnectionError) return "인터넷에 연결할 수 없습니다. 네트워크를 확인하세요.";
    if (err instanceof SDK.APIError) return `오류 (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const b64 = (dataUrl: string) => dataUrl.split(",")[1];
const mimeOf = (dataUrl: string) => (/data:([^;]+)/.exec(dataUrl)?.[1] ?? "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export async function solveDirect(
  args: { image: string; materials: Material[]; notebookTitle?: string; extraInstruction?: string },
  settings: Settings,
  h: SolveHandlers,
  signal: AbortSignal,
) {
  let SDK: typeof Anthropic | null = null;
  try {
    const made = await makeClient(settings);
    SDK = made.SDK;
    const textMats = args.materials.filter((m) => m.localText);
    const imageMats = args.materials.filter((m) => m.localImage).slice(0, 8);
    const packed = packMaterials(textMats.map((m) => ({ name: m.name, text: m.localText! })));

    // 강의자료를 앞에 두고 캐시 지정 → 같은 자료로 반복해서 풀 때 빠르고 저렴
    const materialBlocks: Anthropic.Beta.BetaContentBlockParam[] = [
      ...imageMats.map((m): Anthropic.Beta.BetaContentBlockParam => ({ type: "image", source: { type: "base64", media_type: mimeOf(m.localImage!), data: b64(m.localImage!) } })),
      ...(packed.text ? [{ type: "text" as const, text: `# 강의자료\n${packed.text}${packed.truncated ? "\n(일부 자료는 길어서 앞부분만 포함되었습니다.)" : ""}` }] : []),
    ];
    if (materialBlocks.length) (materialBlocks[materialBlocks.length - 1] as { cache_control?: unknown }).cache_control = { type: "ephemeral" };

    const names = [...textMats, ...imageMats].map((m) => m.name);
    const stream = made.client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        output_config: { effort: settings.effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [
          {
            role: "user",
            content: [
              ...materialBlocks,
              { type: "image", source: { type: "base64", media_type: "image/png", data: args.image } },
              { type: "text", text: buildUserText(names, args.notebookTitle, args.extraInstruction) },
            ],
          },
        ],
      },
      { signal },
    );
    stream.on("text", (d) => h.onDelta(d));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") h.onError("이 영역은 풀 수 없습니다. 영역을 다시 지정해 보세요.");
    else h.onDone();
  } catch (err) {
    if (signal.aborted) return;
    h.onError(errorMessage(SDK, err));
  }
}

export async function transcribeDirect(image: string, settings: Settings, signal?: AbortSignal): Promise<string> {
  let SDK: typeof Anthropic | null = null;
  try {
    const made = await makeClient(settings);
    SDK = made.SDK;
    const msg = await made.client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        system: TRANSCRIBE_PROMPT,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
              { type: "text", text: "이 손글씨를 텍스트로 옮겨 주세요." },
            ],
          },
        ],
      },
      { signal },
    );
    if (msg.stop_reason === "refusal") throw new Error("이 영역은 변환할 수 없습니다.");
    const text = msg.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return text === "[EMPTY]" ? "" : text;
  } catch (err) {
    throw new Error(errorMessage(SDK, err));
  }
}
