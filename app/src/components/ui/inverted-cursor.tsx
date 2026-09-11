"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

interface CursorProps {
  size?: number;
}

export const Cursor: React.FC<CursorProps> = ({ size = 60 }) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const previousPos = useRef({ x: -size, y: -size });

  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: -size, y: -size });

  const animate = useCallback(() => {
    if (!cursorRef.current) return;

    const currentX = previousPos.current.x;
    const currentY = previousPos.current.y;
    const targetX = position.x - size / 2;
    const targetY = position.y - size / 2;

    const deltaX = (targetX - currentX) * 0.2;
    const deltaY = (targetY - currentY) * 0.2;

    const newX = currentX + deltaX;
    const newY = currentY + deltaY;

    previousPos.current = { x: newX, y: newY };
    cursorRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;

    requestRef.current = requestAnimationFrame(animate);
  }, [position.x, position.y, size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setVisible(true);
      setPosition({ x: e.clientX, y: e.clientY });
    };

    const handleMouseEnter = () => {
      setVisible(true);
    };

    const handleMouseLeave = () => {
      setVisible(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.documentElement.addEventListener("mouseenter", handleMouseEnter);
    document.documentElement.addEventListener("mouseleave", handleMouseLeave);

    document.body.style.cursor = "none";

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.documentElement.removeEventListener("mouseenter", handleMouseEnter);
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      document.body.style.cursor = "auto";
    };
  }, [animate]);

  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 pointer-events-none rounded-full bg-white mix-blend-difference z-50 transition-opacity duration-300 will-change-transform"
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
