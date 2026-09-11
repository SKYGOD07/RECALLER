"use client";

import { Cursor } from "@/components/ui/inverted-cursor";

export default function CursorDemoPage() {
  return (
    <div className="relative w-full h-screen overflow-hidden cursor-none bg-background text-foreground">
      {/* Custom circular inverted color cursor */}
      <Cursor />

      {/* Main content centered vertically and horizontally */}
      <main className="flex items-center justify-center h-full">
        <h1 className="text-4xl font-extrabold select-none tracking-tight">
          Move your mouse
        </h1>
      </main>
    </div>
  );
}

export { CursorDemoPage };
