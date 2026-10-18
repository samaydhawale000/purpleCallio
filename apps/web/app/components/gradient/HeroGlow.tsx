"use client";

import { useEffect, useRef } from "react";

/**
 * Soft drifting colour blobs behind the hero. Pure CSS transform animation
 * (compositor-only, no WebGL, no per-frame JavaScript). Paused while the hero
 * is off screen or the tab is hidden; still for prefers-reduced-motion.
 */
export default function HeroGlow() {
   const ref = useRef<HTMLDivElement>(null);

   useEffect(() => {
      const el = ref.current;
      if (!el) return;
      let onScreen = true;
      const sync = () => el.toggleAttribute("data-paused", !onScreen || document.hidden);
      const observer = new IntersectionObserver(([entry]) => {
         onScreen = entry.isIntersecting;
         sync();
      });
      observer.observe(el);
      document.addEventListener("visibilitychange", sync);
      return () => {
         observer.disconnect();
         document.removeEventListener("visibilitychange", sync);
      };
   }, []);

   return (
      <div ref={ref} className="hero-glow" aria-hidden="true">
         <span className="hero-glow-blob hero-glow-blob--1" />
         <span className="hero-glow-blob hero-glow-blob--2" />
         <span className="hero-glow-blob hero-glow-blob--3" />
      </div>
   );
}
