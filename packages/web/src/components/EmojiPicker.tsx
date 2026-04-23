/**
 * Thin wrapper around `emoji-mart` for the composer + reaction picker.
 *
 * `emoji-mart` ships its own picker + (8MB) data bundle. We use the
 * `Picker` component directly with the Slack-style "search → grid" UX
 * and a minimal dark theme.
 *
 * Category tab icons are overridden with our `lucide-react` set so the
 * picker matches the rest of the chrome (the defaults are a bespoke
 * outline family that clashes with our toolbar icons).
 */
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Apple, Car, Clock, Dog, Flag, Heart, Lightbulb, Smile, Volleyball } from "lucide-react";
import { type ComponentType, useEffect, useMemo, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useColorScheme } from "../lib/theme/index.ts";

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

// emoji-mart accepts a per-category `{ svg: string }` payload and stamps
// the markup straight into the tab via `innerHTML`. Pre-render once at
// module load so the picker doesn't pay the cost on every mount.
//
// emoji-mart's stylesheet sets `fill: currentColor` on the tab `<svg>`,
// which overrides Lucide's `fill="none"` attribute and turns every icon
// into a solid silhouette. Inline `style` wins over the cascade, so we
// also push the stroke colour through `style` to keep the icons as the
// thin outlines Lucide ships with.
type LucideComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
  style?: React.CSSProperties;
}>;

const OUTLINE_STYLE: React.CSSProperties = {
  fill: "none",
  stroke: "currentColor",
};

function toSvg(Icon: LucideComponent): { svg: string } {
  return {
    svg: renderToStaticMarkup(<Icon size={18} strokeWidth={1.75} style={OUTLINE_STYLE} aria-hidden />),
  };
}

const CATEGORY_ICONS = {
  frequent: toSvg(Clock),
  people: toSvg(Smile),
  nature: toSvg(Dog),
  foods: toSvg(Apple),
  activity: toSvg(Volleyball),
  places: toSvg(Car),
  objects: toSvg(Lightbulb),
  symbols: toSvg(Heart),
  flags: toSvg(Flag),
};

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedScheme } = useColorScheme();

  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [onClose]);

  // `emoji-mart` mutates the icons object during init; clone to keep the
  // module-level constant immutable across remounts.
  const categoryIcons = useMemo(() => ({ ...CATEGORY_ICONS }), []);

  // `emoji-mart` ships its own chrome (background, border, shadow) and an
  // internally-scrolling emoji grid sized to its intrinsic height. Wrapping
  // it in a container with `max-h` + `overflow-hidden` would clip the host
  // without telling the picker to shrink, which kills its internal scroll
  // and strands the bottom rows on shorter viewports — so we leave layout
  // entirely to the picker here.
  return (
    <div ref={ref} className="w-[min(20rem,calc(100vw-1rem))]">
      <Picker
        data={data}
        theme={resolvedScheme}
        previewPosition="none"
        skinTonePosition="none"
        categoryIcons={categoryIcons}
        onEmojiSelect={(emoji: { native?: string; shortcodes?: string }) => {
          onPick(emoji.native ?? emoji.shortcodes ?? "");
        }}
      />
    </div>
  );
}
