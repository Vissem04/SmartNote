/** 텍스트 측정·줄바꿈 공용 유틸 (화면 DOM과 같은 규칙: padding 4px, line-height 1.5) */
export const FONT_FAMILY = `"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;

let ctx: CanvasRenderingContext2D | null = null;
function measurer(fontSize: number) {
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx!.font = `${fontSize}px ${FONT_FAMILY}`;
  return ctx!;
}

/** 문자 단위 줄바꿈 (한글은 공백이 적으므로 글자 단위로 끊고, 가능하면 공백에서 끊음) */
export function wrapText(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (c.measureText(line + ch).width > maxW && line) {
        const sp = line.lastIndexOf(" ");
        if (sp > line.length * 0.5) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** 줄바꿈 없이 한 줄로 쓸 때의 가장 긴 줄 너비 */
export function naturalWidth(text: string, fontSize: number) {
  const c = measurer(fontSize);
  return Math.max(0, ...text.split("\n").map((l) => c.measureText(l).width));
}

export function textHeight(t: { text: string; fontSize: number; w: number }) {
  const lines = wrapText(measurer(t.fontSize), t.text || " ", Math.max(10, t.w - 8)).length;
  return lines * t.fontSize * 1.5 + 8;
}

/** 내용이 한 줄에 들어가도록 상자를 (페이지 안에서) 넓힘. 줄이지는 않음 */
export function fitTextWidth<T extends { x: number; w: number; text: string; fontSize: number }>(o: T, pageW: number): T {
  const want = naturalWidth(o.text, o.fontSize) + 14;
  if (want <= o.w) return o;
  const w = Math.min(want, pageW - 16);
  const x = Math.max(8, Math.min(o.x, pageW - w - 8));
  return { ...o, x, w };
}
