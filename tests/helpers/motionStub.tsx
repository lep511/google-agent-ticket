/**
 * Animation-free stand-in for `motion/react`, aliased into the `web` test
 * project by `vitest.config.ts`.
 *
 * The real library runs a full animation pipeline on every mount: it reads
 * computed styles, schedules frames and keeps a per-element motion value graph.
 * None of that changes what the components under test assert, but in jsdom it
 * dominates the cost of a property test that mounts the tree a hundred times.
 *
 * The stub keeps the observable semantics the tests rely on:
 *  - `motion.<tag>` renders the plain DOM element, forwarding refs, children and
 *    every real DOM attribute, and dropping the animation-only props;
 *  - `AnimatePresence` renders its children immediately and removes them
 *    immediately, which is the end state every assertion waits for anyway.
 */
import { createElement, forwardRef, Fragment, type ElementType, type ReactNode } from 'react';

/**
 * Props consumed by the animation library itself. They are dropped instead of
 * forwarded, so React does not warn about unknown DOM attributes.
 */
const ANIMATION_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'transition',
  'variants',
  'layout',
  'layoutId',
  'layoutDependency',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',
  'viewport',
  'onAnimationStart',
  'onAnimationComplete',
  'onUpdate',
  'onDrag',
  'onDragStart',
  'onDragEnd',
  'transformTemplate',
  'custom',
]);

/** Keeps only the props a real DOM element understands. */
function stripAnimationProps(props: Record<string, unknown>): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ANIMATION_PROPS.has(key)) {
      forwarded[key] = value;
    }
  }
  return forwarded;
}

/** `motion.div`, `motion.button`, ... resolved lazily through a proxy. */
export const motion = new Proxy({} as Record<string, ElementType>, {
  get(cache: Record<string, ElementType>, tag: string) {
    if (cache[tag] === undefined) {
      const Component = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
        createElement(tag, { ...stripAnimationProps(props), ref }),
      );
      Component.displayName = `motion.${tag}`;
      cache[tag] = Component as ElementType;
    }
    return cache[tag];
  },
});

/** Renders children with no enter or exit transition. */
export function AnimatePresence({ children }: { children?: ReactNode }) {
  return createElement(Fragment, null, children);
}
