import { create } from "zustand";

/** 화면 확대/이동 상태. 캔버스 렌더와 분리해 줌 표시만 구독 */
export const useView = create<{ zoom: number }>(() => ({ zoom: 1 }));

export const viewApi = {
  zoomBy: (_f: number) => {},
  setZoom: (_z: number) => {},
  fitWidth: () => {},
  insertImage: (_file: File) => {},
};
