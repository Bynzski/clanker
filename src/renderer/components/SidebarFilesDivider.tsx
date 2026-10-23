import { useEffect, useRef } from 'react';

interface SidebarFilesDividerProps {
  percent: number;
  onChange: (percent: number) => void;
}

/** Percentage sizing follows window resizes while keeping both sections reachable. */
export default function SidebarFilesDivider({ percent, onChange }: SidebarFilesDividerProps) {
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const change = (value: number) => onChange(Math.min(85, Math.max(15, value)));

  return <div
    className="sidebar-files-divider"
    role="separator"
    tabIndex={0}
    aria-label="Resize Files section"
    aria-orientation="horizontal"
    aria-valuemin={15}
    aria-valuemax={85}
    aria-valuenow={Math.round(percent)}
    onKeyDown={(event) => {
      const next = { ArrowUp: percent + 5, ArrowDown: percent - 5, Home: 85, End: 15 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      change(next);
    }}
    onMouseDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stopDrag.current?.();
      const height = event.currentTarget.parentElement!.getBoundingClientRect().height;
      if (height <= 0) return;
      const startY = event.clientY;
      const cursor = document.body.style.cursor;
      const userSelect = document.body.style.userSelect;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      const move = (moveEvent: MouseEvent) => change(percent - (moveEvent.clientY - startY) / height * 100);
      const stop = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
        window.removeEventListener('blur', stop);
        document.body.style.cursor = cursor;
        document.body.style.userSelect = userSelect;
        stopDrag.current = null;
      };
      stopDrag.current = stop;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
      window.addEventListener('blur', stop);
    }}
  />;
}
