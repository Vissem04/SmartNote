export type Point = [number, number, number]; // x, y, pressure

export interface StrokeObj {
  id: string;
  type: "stroke";
  tool: "pen" | "highlighter";
  color: string;
  size: number;
  points: Point[];
}

export interface TextObj {
  id: string;
  type: "text";
  x: number;
  y: number;
  w: number;
  text: string;
  fontSize: number;
  color: string;
}

export interface ImageObj {
  id: string;
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface TableObj {
  id: string;
  type: "table";
  x: number;
  y: number;
  colWidths: number[];
  rowHeights: number[];
  /** 지워진 세로 선분: "r,c" = (r,c)와 (r,c+1) 사이 */
  vRemoved: string[];
  /** 지워진 가로 선분: "r,c" = (r,c)와 (r+1,c) 사이 */
  hRemoved: string[];
  /** 병합 그룹의 대표(좌상단) 셀 기준 텍스트 */
  cells: Record<string, string>;
  color: string;
  fontSize: number;
}

export type Verdict = "correct" | "incorrect" | "partial" | "none";

export interface AnswerObj {
  id: string;
  type: "answer";
  x: number;
  y: number;
  w: number;
  /** 사용자가 그린 경계 (페이지 좌표) */
  polygon: [number, number][];
  status: "loading" | "done" | "error";
  content: string;
  verdict: Verdict | null;
  collapsed: boolean;
  createdAt: number;
  materialNames: string[];
}

export type NoteObj = StrokeObj | TextObj | ImageObj | TableObj | AnswerObj;

export type Template = "blank" | "lined" | "grid" | "dot";

export interface Page {
  id: string;
  notebookId: string;
  title: string;
  template: Template;
  width: number;
  height: number;
  objects: NoteObj[];
  createdAt: number;
  updatedAt: number;
}

export interface Notebook {
  id: string;
  title: string;
  color: string;
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Material {
  id: string;
  notebookId: string;
  name: string;
  mime: string;
  kind: "pdf" | "text" | "image";
  size: number;
  fileId?: string;
  /** 아티팩트 모드: 브라우저에서 추출한 텍스트 (PDF는 [p.N] 페이지 표시 포함) */
  localText?: string;
  /** 아티팩트 모드: 이미지 자료 data URL */
  localImage?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  enabled: boolean;
  createdAt: number;
}

export type Tool = "select" | "pen" | "highlighter" | "eraser" | "text" | "table" | "ai" | "convert" | "hand";

export interface Settings {
  apiKey: string;
  effort: "low" | "medium" | "high" | "xhigh";
  theme: "light" | "dark" | "system";
  penOnly: boolean;
  /** 붙여넣기·손글씨 변환·새 텍스트 상자의 기본 글자 크기 */
  textSize: number;
  /** true면 손글씨 변환 시 손글씨 크기를 따라감 */
  convertMatchHandwriting: boolean;
}

/** 손글씨 → 텍스트 변환 미리보기 */
export interface Conversion {
  pageId: string;
  strokeIds: string[];
  rect: Rect;
  status: "loading" | "ready" | "error";
  text: string;
  error?: string;
  fontSize: number;
  color: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
