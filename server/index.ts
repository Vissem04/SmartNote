import "dotenv/config";
import express, { type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TRANSCRIBE_PROMPT, buildUserText } from "../shared/prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json({ limit: "40mb" }));

const MODEL = "claude-opus-5-5";

/** 요청 헤더의 개인 키(설정 화면) → 없으면 서버 환경변수 키 사용 */
function clientFor(req: Request): Anthropic {
  const override = req.header("x-user-api-key")?.trim();
  return override ? new Anthropic({ apiKey: override }) : new Anthropic();
}

function hasServerKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.";
  if (err instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 해당 기능을 사용할 권한이 없습니다.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (err instanceof Anthropic.BadRequestError) return `요청 오류: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Anthropic API에 연결할 수 없습니다. 네트워크를 확인하세요.";
  if (err instanceof Anthropic.APIError) return `API 오류 (${err.status}): ${err.message}`;
  if (err instanceof Error && /api key|apiKey|authentication/i.test(err.message))
    return "API 키가 설정되지 않았습니다. 설정 화면에서 Anthropic API 키를 입력하세요.";
  return err instanceof Error ? err.message : String(err);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasServerKey: hasServerKey(), model: MODEL });
});

/* ---------------- 강의자료 업로드 (Files API) ---------------- */

const ALLOWED = new Set(["application/pdf", "text/plain", "text/markdown", "image/png", "image/jpeg", "image/gif", "image/webp"]);

app.post("/api/materials", upload.single("file"), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return void res.status(400).json({ error: "파일이 없습니다." });
  let mime = file.mimetype;
  if (mime === "text/markdown" || file.originalname.toLowerCase().endsWith(".md")) mime = "text/plain";
  if (!ALLOWED.has(mime)) return void res.status(415).json({ error: "PDF, 텍스트(.txt/.md), 이미지 파일만 지원합니다." });
  try {
    const name = Buffer.from(file.originalname, "latin1").toString("utf8");
    const meta = await clientFor(req).files.upload({
      file: await toFile(file.buffer, name, { type: mime }),
    });
    res.json({ fileId: meta.id, mime, size: file.size });
  } catch (err) {
    console.error("[materials] upload failed", err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete("/api/materials/:fileId", async (req, res) => {
  try {
    await clientFor(req).files.delete(req.params.fileId);
  } catch (err) {
    console.warn("[materials] delete failed (ignored)", errorMessage(err));
  }
  res.json({ ok: true });
});

/* ---------------- AI 문제 풀이 (SSE 스트리밍) ---------------- */

interface SolveBody {
  image: string; // base64 PNG (data URL prefix 없이)
  materials?: { fileId: string; name: string; kind: "pdf" | "text" | "image" }[];
  effort?: "low" | "medium" | "high" | "xhigh";
  notebookTitle?: string;
  extraInstruction?: string;
}

app.post("/api/solve", async (req: Request, res: Response) => {
  const { image, materials = [], effort = "high", notebookTitle, extraInstruction } = (req.body ?? {}) as SolveBody;
  if (!image) return void res.status(400).json({ error: "이미지가 없습니다." });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // 강의자료 → 문서/이미지 블록. 마지막 자료 블록에 캐시 지정 → 같은 자료로 반복 풀이 시 비용·지연 절감
  const materialBlocks: Anthropic.Beta.BetaContentBlockParam[] = materials.map((m) =>
    m.kind === "image"
      ? { type: "image", source: { type: "file", file_id: m.fileId } }
      : { type: "document", source: { type: "file", file_id: m.fileId }, title: m.name },
  );
  if (materialBlocks.length) {
    const last = materialBlocks[materialBlocks.length - 1] as { cache_control?: unknown };
    last.cache_control = { type: "ephemeral" };
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...materialBlocks,
    { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
    { type: "text", text: buildUserText(materials.map((m) => m.name), notebookTitle, extraInstruction) },
  ];

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    const stream = clientFor(req).beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        output_config: { effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
      },
      { signal: abort.signal },
    );
    stream.on("text", (delta) => send("delta", { text: delta }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send("error", { message: "AI가 이 요청에 대한 답변을 거절했습니다. 영역을 다시 지정해 보세요." });
    } else {
      send("done", {
        stopReason: final.stop_reason,
        usage: {
          input: final.usage.input_tokens,
          output: final.usage.output_tokens,
          cacheRead: final.usage.cache_read_input_tokens ?? 0,
        },
      });
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("[solve] failed", err);
      send("error", { message: errorMessage(err) });
    }
  } finally {
    res.end();
  }
});

/* ---------------- 손글씨 → 텍스트 변환 ---------------- */

app.post("/api/transcribe", async (req: Request, res: Response) => {
  const { image } = (req.body ?? {}) as { image?: string };
  if (!image) return void res.status(400).json({ error: "이미지가 없습니다." });
  try {
    const msg = await clientFor(req).beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: TRANSCRIBE_PROMPT,
      // 단순 인식 작업이므로 낮은 effort로 빠르게
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
    });
    if (msg.stop_reason === "refusal") return void res.status(422).json({ error: "이 영역은 변환할 수 없습니다." });
    const text = msg.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    res.json({ text: text === "[EMPTY]" ? "" : text });
  } catch (err) {
    console.error("[transcribe] failed", err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

/* ---------------- 프로덕션: 빌드된 프론트엔드 제공 ---------------- */
const dist = path.resolve(here, "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`SmartNote server → http://localhost:${port}`);
  if (!hasServerKey()) console.log("  ⚠ ANTHROPIC_API_KEY 미설정: 앱 설정 화면에서 키를 입력하세요.");
});
