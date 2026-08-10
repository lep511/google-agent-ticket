/* ──────────────────────────────────────────────────────────── */
/*  UserMenu                                                    */
/*                                                              */
/*  Session control of the header. A circular account button    */
/*  replaces the inline "email + Sign Out" pair, which cramped   */
/*  the header on narrow viewports, and opens a popover with    */
/*  the signed-in address and the sign-out action.              */
/* ──────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LogOut, User } from 'lucide-react';

export interface UserMenuProps {
  /** Address (or username) of the signed-in user, shown inside the popover. */
  email: string;
  /** Confirmed sign-out. */
  onSignOut: () => void;
}

export function UserMenu({ email, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const closeMenu = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // A click or tap outside the popover dismisses it.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        closeMenu(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open, closeMenu]);

  // `Escape` closes from anywhere inside the popover and gives the focus back.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeMenu]);

  // Opening moves the focus to the only action of the popover.
  useEffect(() => {
    if (open) signOutRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative font-sans">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeMenu(false) : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={email}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-stone-300 transition-colors hover:bg-white/10 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        style={{ touchAction: 'manipulation' }}
      >
        <User className="h-4.5 w-4.5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            /*
              Anchored to the right edge of the trigger and never wider than the
              viewport, so the popover stays on screen down to 320px.
            */
            className="absolute right-0 top-full z-50 mt-2 w-[min(16rem,calc(100vw-1.5rem))] rounded-xl border border-stone-700 bg-stone-800 p-3 shadow-2xl shadow-black/50"
          >
            <p className="text-[11px] uppercase tracking-wide text-stone-500">Signed in as</p>
            {/* An address is an identifier: it must not be auto-translated, and
                it can be long enough to need a wrap opportunity anywhere. */}
            <p
              translate="no"
              className="mt-1 break-all text-sm font-medium text-stone-100"
              title={email}
            >
              {email}
            </p>

            <div className="my-3 h-px bg-stone-700" aria-hidden="true" />

            <button
              ref={signOutRef}
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu(false);
                onSignOut();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-700 px-3 py-2 text-sm font-medium text-stone-100 transition-colors hover:bg-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
