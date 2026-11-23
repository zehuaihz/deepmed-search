import { useEffect, useRef, useState } from "react";

type Size = { width?: number; height?: number };

export default function useResizeObserver<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height }
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}
