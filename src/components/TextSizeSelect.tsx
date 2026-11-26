import { ChevronDown, Type } from "lucide-react";
import { useStore } from "../store";

export const TEXT_SIZES = [14, 16, 18, 20, 22, 24, 28, 32, 40];

/** 기본 글자 크기 선택 (붙여넣기·손글씨 변환·새 텍스트 상자에 적용) */
export function TextSizeSelect({ compact }: { compact?: boolean }) {
  const size = useStore((s) => s.settings.textSize);
  const setSettings = useStore((s) => s.setSettings);
  const sizes = TEXT_SIZES.includes(size) ? TEXT_SIZES : [...TEXT_SIZES, size].sort((a, b) => a - b);
  return (
    <label className={`size-select ${compact ? "compact" : ""}`} data-tip={compact ? "기본 글자 크기 (붙여넣기·변환·텍스트)" : undefined}>
      <Type size={14} />
      <select value={size} onChange={(e) => setSettings({ textSize: Number(e.target.value) })}>
        {sizes.map((n) => (
          <option key={n} value={n}>
            {n}px
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}
