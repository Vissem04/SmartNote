import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, FileImage, FileText, KeyRound, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import { useStore, activeNotebook } from "../store";
import type { Material, Settings } from "../types";
import { deleteMaterial, health, uploadMaterial } from "../api";
import { formatBytes, modKey, uid } from "../util";
import { TextSizeSelect } from "./TextSizeSelect";
import { isArtifact } from "../runtime";

function Modal({ title, icon, onClose, children, wide }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- 강의자료 ---------------- */

function kindOf(file: File): Material["kind"] | null {
  const n = file.name.toLowerCase();
  if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/") || n.endsWith(".md") || n.endsWith(".txt")) return "text";
  return null;
}

export function MaterialsPanel() {
  const nb = useStore(activeNotebook);
  const allMaterials = useStore((s) => s.materials);
  const materials = useMemo(() => allMaterials.filter((m) => m.notebookId === nb?.id), [allMaterials, nb?.id]);
  const settings = useStore((s) => s.settings);
  const [dragging, setDragging] = useState(false);
  const st = useStore.getState;

  const addFiles = async (files: FileList | File[]) => {
    if (!nb) return;
    for (const file of Array.from(files)) {
      const kind = kindOf(file);
      if (!kind) {
        st().toast(`'${file.name}': PDF, 텍스트, 이미지만 지원합니다. (PPT는 PDF로 변환해 올려 주세요)`, "error");
        continue;
      }
      const m: Material = { id: uid(), notebookId: nb.id, name: file.name, mime: file.type, kind, size: file.size, status: "uploading", enabled: true, createdAt: Date.now() };
      st().addMaterial(m);
      uploadMaterial(file, settings, kind, (msg) => st().updateMaterial(m.id, { error: msg }))
        .then((patch) => st().updateMaterial(m.id, { ...patch, error: undefined, status: "ready" }))
        .catch((e: Error) => st().updateMaterial(m.id, { status: "error", error: e.message }));
    }
  };

  const remove = (m: Material) => {
    if (m.fileId) deleteMaterial(m.fileId, settings);
    st().removeMaterial(m.id);
  };

  return (
    <Modal title="강의자료" icon={<BookOpen size={20} className="accent-ic" />} onClose={() => st().setPanel(null)} wide>
      <p className="modal-desc">
        <b>{nb?.title}</b> 노트에 첨부한 자료는 AI가 문제를 풀 때 참고합니다. 자료의 정의·표기법·공식을 따라 풀기 때문에 수업 방식과 같은 풀이를 얻을 수 있어요. 같은 자료로 반복해서 풀면 캐시가 적용되어 더 빠르고 저렴합니다.
      </p>
      <label
        className={`dropzone ${dragging ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={28} />
        <b>파일을 끌어놓거나 클릭해서 선택</b>
        <span>PDF · TXT · MD · PNG/JPG (최대 100MB)</span>
        <input type="file" multiple hidden accept=".pdf,.txt,.md,image/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </label>

      <div className="mat-list">
        {materials.length === 0 && <div className="empty-hint">아직 첨부된 자료가 없습니다.</div>}
        {materials.map((m) => (
          <div key={m.id} className={`mat ${m.status}`}>
            <div className="mat-ic">{m.kind === "image" ? <FileImage size={18} /> : <FileText size={18} />}</div>
            <div className="mat-info">
              <b title={m.name}>{m.name}</b>
              <span>
                {formatBytes(m.size)} ·{" "}
                {m.status === "uploading" ? (
                  <>
                    <Loader2 size={11} className="spin" /> {m.error ?? (isArtifact ? "읽는 중" : "업로드 중")}
                  </>
                ) : m.status === "ready" ? (
                  <>
                    <CheckCircle2 size={11} /> 사용 가능
                  </>
                ) : (
                  <>
                    <AlertCircle size={11} /> {m.error ?? "오류"}
                  </>
                )}
              </span>
            </div>
            <label className="switch" title="AI 풀이에 참조">
              <input type="checkbox" checked={m.enabled} disabled={m.status !== "ready"} onChange={(e) => st().updateMaterial(m.id, { enabled: e.target.checked })} />
              <span />
            </label>
            <button className="icon-btn sm danger" title="삭제" onClick={() => remove(m)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- 설정 ---------------- */

const EFFORTS: { id: Settings["effort"]; label: string; desc: string }[] = [
  { id: "low", label: "빠름", desc: "간단한 계산·암기형" },
  { id: "medium", label: "균형", desc: "일반 문제" },
  { id: "high", label: "정확", desc: "추천 · 대부분의 시험 문제" },
  { id: "xhigh", label: "최고 정확도", desc: "어려운 증명·다단계 문제 (느림)" },
];

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const [server, setServer] = useState<{ hasServerKey: boolean; model: string } | null | "loading">("loading");
  const st = useStore.getState;

  useEffect(() => {
    if (!isArtifact) health().then(setServer);
  }, []);

  return (
    <Modal title="설정" icon={<KeyRound size={20} className="accent-ic" />} onClose={() => st().setPanel(null)}>
      {isArtifact ? (
        <section className="setting">
          <h3>AI 연결</h3>
          <div className="server-status ok">claude.ai 계정의 Claude를 사용합니다</div>
          <small className="note">
            AI 풀이와 텍스트 변환은 지금 로그인한 claude.ai 계정의 사용량으로 동작합니다. 처음 사용할 때 Claude 사용 허용 여부를 묻습니다. API 키는 필요 없습니다.
          </small>
        </section>
      ) : (
      <section className="setting">
        <h3>AI 연결</h3>
        <div className={`server-status ${server === "loading" ? "" : server ? (server.hasServerKey || settings.apiKey ? "ok" : "warn") : "bad"}`}>
          {server === "loading"
            ? "서버 확인 중…"
            : !server
              ? "서버에 연결할 수 없습니다. `npm run dev`로 실행하세요."
              : server.hasServerKey
                ? `서버 API 키 사용 중 · 모델 ${server.model}`
                : settings.apiKey
                  ? `개인 API 키 사용 · 모델 ${server.model}`
                  : "API 키가 없습니다. 아래에 입력하거나 서버 .env에 설정하세요."}
        </div>
        <label className="field">
          <span>Anthropic API 키 (선택)</span>
          <input type="password" placeholder="sk-ant-…" value={settings.apiKey} onChange={(e) => st().setSettings({ apiKey: e.target.value })} autoComplete="off" />
          <small>이 브라우저에만 저장되며, 내 SmartNote 서버를 거쳐 Anthropic API로만 전송됩니다.</small>
        </label>
      </section>
      )}

      <section className="setting">
        <h3>풀이 정확도</h3>
        <div className="seg">
          {EFFORTS.map((e) => (
            <button key={e.id} className={settings.effort === e.id ? "active" : ""} onClick={() => st().setSettings({ effort: e.id })}>
              <b>{e.label}</b>
              <span>{e.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="setting">
        <h3>글자 크기</h3>
        <label className="row-toggle as-row">
          <span>
            <b>기본 글자 크기</b>
            <small>문제 텍스트 붙여넣기, 손글씨 → 텍스트 변환, 새 텍스트 상자에 항상 이 크기를 사용합니다.</small>
          </span>
          <TextSizeSelect />
        </label>
        <label className="row-toggle" style={{ marginTop: 12 }}>
          <span>
            <b>변환할 때 손글씨 크기 따라가기</b>
            <small>켜면 손글씨 크기에 맞춰 글자 크기를 추정합니다. 끄면 위의 기본 크기로 통일됩니다.</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={settings.convertMatchHandwriting} onChange={(e) => st().setSettings({ convertMatchHandwriting: e.target.checked })} />
            <span />
          </span>
        </label>
      </section>

      <section className="setting">
        <h3>입력</h3>
        <label className="row-toggle">
          <span>
            <b>펜 전용 모드</b>
            <small>스타일러스로만 필기하고 손가락은 화면 이동·확대에 사용 (손바닥 인식 방지). 펜이 감지되면 자동으로 켜집니다.</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={settings.penOnly} onChange={(e) => st().setSettings({ penOnly: e.target.checked })} />
            <span />
          </span>
        </label>
        <label className="field">
          <span>테마</span>
          <select value={settings.theme} onChange={(e) => st().setSettings({ theme: e.target.value as Settings["theme"] })}>
            <option value="system">시스템 설정 따르기</option>
            <option value="light">라이트</option>
            <option value="dark">다크</option>
          </select>
        </label>
      </section>

      <section className="setting">
        <h3>단축키</h3>
        <div className="shortcuts">
          {[
            ["P / H / E", "펜 / 형광펜 / 지우개"],
            ["V / T / B", "올가미 / 텍스트 / 표"],
            ["A", "AI 풀이 (영역 둘러싸기)"],
            ["C", "손글씨 → 텍스트 변환"],
            ["Space + 드래그", "화면 이동"],
            [`${modKey} + 휠`, "확대·축소"],
            [`${modKey} + Z / Shift+Z`, "실행 취소 / 다시 실행"],
            [`${modKey} + C / V / D`, "복사 / 붙여넣기 / 복제"],
            ["Delete", "선택 삭제"],
            ["[ / ]", "굵기 줄이기 / 키우기"],
            ["Shift (그리는 중)", "직선"],
            ["PgUp / PgDn", "이전 / 다음 페이지"],
          ].map(([k, v]) => (
            <div key={k}>
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </section>
    </Modal>
  );
}

/* ---------------- 토스트 ---------------- */

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
