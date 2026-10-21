"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

const loadFeatures = () => import("./features").then((mod) => mod.default);

/**
 * Lets `m.*` components (see Reveal.tsx) animate. The animation features are
 * code-split and fetched after hydration, and users who ask for reduced motion
 * get opacity fades only (no movement).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
   return (
      <LazyMotion features={loadFeatures}>
         <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </LazyMotion>
   );
}
