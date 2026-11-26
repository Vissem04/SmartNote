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

/**
 * 지금 S펜 측면 버튼(보조 버튼, buttons 비트 2)이나 지우개 끝(비트 32)이 눌려 있는지.
 * 이동·호버 이벤트에서는 눌림 "상태"인 buttons만 본다 (button은 방금 바뀐 버튼이라 뗄 때도 2가 옴).
 */
export function penButtonHeld(e: { pointerType: string; buttons: number }) {
  return e.pointerType === "pen" && ((e.buttons & 2) !== 0 || (e.buttons & 32) !== 0);
}

/** 펜이 닿는 순간 측면 버튼(2)·지우개 끝(5)이 눌려 있는지 */
export function isPenEraser(e: { pointerType: string; button: number; buttons: number }) {
  return e.pointerType === "pen" && (e.button === 2 || e.button === 5 || penButtonHeld(e));
}
