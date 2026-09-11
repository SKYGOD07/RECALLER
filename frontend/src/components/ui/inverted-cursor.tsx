"use client";

import React, { useState, useEffect, useRef } from "react";

interface CursorProps {
  size?: number;
}

export const Cursor: React.FC<CursorProps> = ({ size = 60 }) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | undefined>(undefined);
  
  // Position & scale tracking in refs for 60/120fps animation loop without re-renders
  const targetPos = useRef({ x: -size, y: -size });
  const currentPos = useRef({ x: -size, y: -size });
  const targetScale = useRef(1);
  const currentScale = useRef(1);

  const [visible, setVisible] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // 1. Disable on touch / coarse pointer devices
    const touchMedia = window.matchMedia("(pointer: coarse), (hover: none)");
    if (touchMedia.matches) {
      setIsTouch(true);
      return;
    }

    // 2. Check prefers-reduced-motion
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedMotion = motionMedia.matches;

    // Animation loop
    const animate = () => {
      if (!cursorRef.current) return;

      const targetX = targetPos.current.x - size / 2;
      const targetY = targetPos.current.y - size / 2;

      if (reducedMotion) {
        currentPos.current = { x: targetX, y: targetY };
        currentScale.current = targetScale.current;
      } else {
        const deltaX = (targetX - currentPos.current.x) * 0.2;
        const deltaY = (targetY - currentPos.current.y) * 0.2;
        const deltaScale = (targetScale.current - currentScale.current) * 0.2;

        currentPos.current.x += deltaX;
        currentPos.current.y += deltaY;
        currentScale.current += deltaScale;
      }

      cursorRef.current.style.transform = `translate3d(${currentPos.current.x}px, ${currentPos.current.y}px, 0) scale(${currentScale.current})`;

      requestRef.current = requestAnimationFrame(animate);
    };

    const handleMouseMove = (e: MouseEvent) => {
      setVisible(true);
      targetPos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseEnter = () => {
      setVisible(true);
    };

    const handleMouseLeave = () => {
      setVisible(false);
    };

    // 4. Hover-scale delegation on interactive & heading elements
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          'a, button, [role="button"], input, select, textarea, h1, h2, h3, h4, h5, h6, .btn, .display-xl, .display-l, .display-m'
        )
      ) {
        targetScale.current = 1.5;
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          'a, button, [role="button"], input, select, textarea, h1, h2, h3, h4, h5, h6, .btn, .display-xl, .display-l, .display-m'
        )
      ) {
        targetScale.current = 1.0;
      }
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseover", handleMouseOver, { passive: true });
    document.addEventListener("mouseout", handleMouseOut, { passive: true });
    document.documentElement.addEventListener("mouseenter", handleMouseEnter);
    document.documentElement.addEventListener("mouseleave", handleMouseLeave);

    document.body.style.cursor = "none";

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.documentElement.removeEventListener("mouseenter", handleMouseEnter);
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      document.body.style.cursor = "auto";
    };
  }, [size]);

  if (isTouch) {
    return null;
  }

  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 pointer-events-none rounded-full bg-white mix-blend-difference z-[99999] transition-opacity duration-300 will-change-transform"
      style={{
        width: size,
        height: size,
        opacity: visible ? 1 : 0,
      }}
      aria-hidden="true"
    />
  );
};

export default Cursor;
