"use client";

import { m, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-reveal building blocks for marketing pages.
 *
 * Performance rules baked in:
 * - only opacity and transform animate (compositor-only, no layout or paint)
 * - one shared IntersectionObserver drives visibility (no scroll listeners)
 * - children stay server-rendered; only this thin wrapper is client code
 * - reduced-motion users get a plain fade (MotionConfig in MotionProvider)
 *
 * Don't wrap above-the-fold hero content: hiding it until hydration delays LCP.
 */

export type RevealVariant = "up" | "down" | "left" | "right" | "scale" | "zoom-up" | "fade";

const OFFSETS: Record<RevealVariant, { x?: number; y?: number; scale?: number }> = {
   up: { y: 28 },
   down: { y: -28 },
   left: { x: -40 },
   right: { x: 40 },
   scale: { scale: 0.92 },
   "zoom-up": { y: 36, scale: 0.96 },
   fade: {},
};

const EASE = [0.22, 1, 0.36, 1] as const; // smooth ease-out

/**
 * Global pace for every reveal. All durations, delays and staggers (including
 * the ones passed on individual pages) are multiplied by this, so raise it to
 * slow everything down, lower it to speed up.
 */
const PACE = 2.4;

/**
 * false = replay every time an element scrolls back into view (it resets when
 * it leaves). true = animate only the first time.
 */
const ONCE = false;
const VIEWPORT_MARGIN = "0px 0px -8% 0px"; // start a little before the element is fully in

function variantsFor(variant: RevealVariant, duration: number, delay = 0): Variants {
   return {
      hidden: { opacity: 0, ...OFFSETS[variant] },
      visible: {
         opacity: 1,
         x: 0,
         y: 0,
         scale: 1,
         transition: { duration: duration * PACE, delay: delay * PACE, ease: EASE },
      },
   };
}

type Tag = "div" | "section" | "ul" | "ol" | "li" | "article" | "header";

interface RevealProps {
   children: ReactNode;
   variant?: RevealVariant;
   delay?: number;
   duration?: number;
   /** Fraction of the element that must be visible before it animates. */
   amount?: number;
   as?: Tag;
   className?: string;
   id?: string;
}

/** Animates a single block into view. */
export function Reveal({
   children,
   variant = "up",
   delay = 0,
   duration = 0.7,
   amount = 0.2,
   as = "div",
   className,
   id,
}: RevealProps) {
   const Component = m[as];
   return (
      <Component
         id={id}
         className={className}
         variants={variantsFor(variant, duration, delay)}
         initial="hidden"
         whileInView="visible"
         viewport={{ once: ONCE, amount, margin: VIEWPORT_MARGIN }}
      >
         {children}
      </Component>
   );
}

interface RevealGroupProps extends Omit<RevealProps, "variant" | "duration"> {
   /** Seconds between each child starting. */
   stagger?: number;
}

/** Container that reveals its <RevealItem> children one after another. */
export function RevealGroup({
   children,
   delay = 0,
   stagger = 0.08,
   amount = 0.1,
   as = "div",
   className,
   id,
}: RevealGroupProps) {
   const Component = m[as];
   return (
      <Component
         id={id}
         className={className}
         variants={{
            hidden: {},
            visible: { transition: { staggerChildren: stagger * PACE, delayChildren: delay * PACE } },
         }}
         initial="hidden"
         whileInView="visible"
         viewport={{ once: ONCE, amount, margin: VIEWPORT_MARGIN }}
      >
         {children}
      </Component>
   );
}

/** Child of <RevealGroup>; animates when the group comes into view. */
export function RevealItem({
   children,
   variant = "up",
   duration = 0.6,
   as = "div",
   className,
}: Pick<RevealProps, "children" | "variant" | "duration" | "as" | "className">) {
   const Component = m[as];
   return (
      <Component className={className} variants={variantsFor(variant, duration)}>
         {children}
      </Component>
   );
}
