/**
 * 펜·터치 입력 판정 (손바닥 인식 방지).
 * - 펜 전용 모드에서 손가락은 화면 이동·확대만 하고 절대 그리지 않는다.
 * - 펜이 닿아 있거나 막 떠 있는(호버) 동안 들어온 터치는 손바닥으로 보고 무시한다.
 * - 접촉 면적이 큰 터치도 손바닥으로 보고 무시한다.
 */
let lastPenAt = 0;
let penDown = false;

export const PALM_GRACE_MS = 500;
const PALM_SIZE = 40; // CSS px

export function notePenActivity(down?: boolean) {
  lastPenAt = performance.now();
  if (down !== undefined) penDown = down;
}

export function penRecentlyActive() {
  return penDown || performance.now() - lastPenAt < PALM_GRACE_MS;
}

export function isPalmLike(e: { pointerType: string; width: number; height: number }) {
  return e.pointerType === "touch" && (e.width > PALM_SIZE || e.height > PALM_SIZE);
}

/** S펜 버튼을 누른 채 쓰기(버튼 2) 또는 지우개 끝(버튼 5) */
export function isPenEraser(e: { pointerType: string; button: number; buttons: number }) {
  return e.pointerType === "pen" && (e.button === 2 || e.button === 5 || (e.buttons & 2) !== 0 || (e.buttons & 32) !== 0);
}
