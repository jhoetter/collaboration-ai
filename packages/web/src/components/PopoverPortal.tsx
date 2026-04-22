/**
 * Anchored popover rendered through `createPortal` so the panel can
 * escape ancestor `overflow-hidden` / `transform` containers.
 *
 * Positioning is computed from a live anchor `getBoundingClientRect()`
 * on every scroll/resize/mutation. The popover supports two anchor
 * placements: above-left (`bottom-start`) for menus that grow upward
 * out of toolbar buttons, and below-left (`top-start`) for inline
 * suggestion lists. The implementation is intentionally tiny — we
 * don't pull a positioning lib because we only need two corners.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "bottom-start" | "top-start";

export interface PopoverPortalProps {
  /** Element used to anchor the popover. When null, the popover does not render. */
  anchor: HTMLElement | null;
  /** Default `bottom-start` opens the panel *above* the anchor (useful for composer toolbars). */
  placement?: PopoverPlacement;
  /** Vertical gap (px) between the anchor edge and the popover. */
  gap?: number;
  children: React.ReactNode;
  /** Forwarded to the outer wrapper for tests / styling hooks. */
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

export function PopoverPortal({
  anchor,
  placement = "bottom-start",
  gap = 6,
  children,
  className,
}: PopoverPortalProps) {
  const [pos, setPos] = useState<Position | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    function compute() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const popH = ref.current?.offsetHeight ?? 0;
      const popW = ref.current?.offsetWidth ?? 0;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // Decide vertical side. Honour the requested placement when there's
      // room, otherwise flip to the opposite side. Clamp to the viewport
      // as a last resort so the panel never lands fully off-screen.
      const spaceAbove = rect.top;
      const spaceBelow = vh - rect.bottom;
      const wantsAbove = placement === "bottom-start";
      const fitsAbove = spaceAbove >= popH + gap;
      const fitsBelow = spaceBelow >= popH + gap;
      const openAbove = wantsAbove ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
      let top = openAbove ? rect.top - popH - gap : rect.bottom + gap;
      top = Math.max(8, Math.min(top, vh - popH - 8));
      // Horizontally align to the anchor's left edge but keep the panel
      // inside the viewport with a small margin on either side.
      let left = rect.left;
      if (popW > 0) left = Math.max(8, Math.min(left, vw - popW - 8));
      setPos({ top, left });
    }
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    if (ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, [anchor, placement, gap]);

  // Recompute once the children render (height stabilises). We re-use the
  // same flip-and-clamp logic as the layout effect so the second pass
  // can't drop the panel into a clipped position.
  useEffect(() => {
    if (!anchor || !ref.current) return;
    const rect = anchor.getBoundingClientRect();
    const popH = ref.current.offsetHeight;
    const popW = ref.current.offsetWidth;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const wantsAbove = placement === "bottom-start";
    const fitsAbove = spaceAbove >= popH + gap;
    const fitsBelow = spaceBelow >= popH + gap;
    const openAbove = wantsAbove ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    let top = openAbove ? rect.top - popH - gap : rect.bottom + gap;
    top = Math.max(8, Math.min(top, vh - popH - 8));
    const left = Math.max(8, Math.min(rect.left, vw - popW - 8));
    setPos({ top, left });
  }, [anchor, placement, gap, children]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 50,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
