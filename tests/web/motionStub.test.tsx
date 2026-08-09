/* ──────────────────────────────────────────────────────────── */
/*  Animation stub aliased over `motion/react`                   */
/*                                                               */
/*  `vitest.config.ts` points `motion/react` at                    */
/*  `tests/helpers/motionStub.tsx` for the whole `web` project, so   */
/*  every component test of `LandingView`, `AgentSelector`,          */
/*  `AgentTimeline` and `HistoryPanel` renders through this stub.    */
/*  A regression here would look like a component bug in all of      */
/*  them at once, which is why the stub is covered directly.        */
/* ──────────────────────────────────────────────────────────── */

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('motion/react alias', () => {
  it('resolves to the stub instead of the real animation library', () => {
    // The real library does not name its components this way, so this is what
    // tells a broken alias apart from a working one.
    expect((motion.div as { displayName?: string }).displayName).toBe('motion.div');
  });

  it('caches one component per tag, so a re-render does not remount the tree', () => {
    expect(motion.div).toBe(motion.div);
    expect(motion.div).not.toBe(motion.span);
  });
});

describe('motion.<tag>', () => {
  it('renders the plain DOM element with its children and DOM attributes', () => {
    render(
      <motion.section className="panel" data-testid="panel" aria-label="Panel">
        <span>Body</span>
      </motion.section>,
    );

    const panel = screen.getByTestId('panel');
    expect(panel.tagName).toBe('SECTION');
    expect(panel).toHaveClass('panel');
    expect(panel).toHaveAccessibleName('Panel');
    expect(panel).toHaveTextContent('Body');
  });

  it('drops the animation-only props instead of forwarding them to the DOM', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <motion.div
        data-testid="animated"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        layout
        layoutId="card"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        variants={{ open: { opacity: 1 } }}
        drag="x"
        onAnimationComplete={() => {}}
      />,
    );

    const element = screen.getByTestId('animated');
    for (const attribute of ['initial', 'animate', 'exit', 'transition', 'layout', 'drag']) {
      expect(element.hasAttribute(attribute)).toBe(false);
    }
    // React warns on unknown DOM attributes through `console.error`, so a prop
    // that slipped through would show up here.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('forwards real DOM event handlers', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <motion.button type="button" onClick={onClick} whileTap={{ scale: 0.9 }}>
        Run
      </motion.button>,
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards refs, which the panels use to move focus', () => {
    function WithRef() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <>
          <motion.div ref={ref} data-testid="target" tabIndex={-1} />
          <button type="button" onClick={() => ref.current?.focus()}>
            Focus
          </button>
        </>
      );
    }

    render(<WithRef />);
    screen.getByRole('button', { name: 'Focus' }).click();

    expect(screen.getByTestId('target')).toHaveFocus();
  });
});

describe('AnimatePresence', () => {
  it('mounts and unmounts children with no transition to wait for', async () => {
    const user = userEvent.setup();

    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(!open)}>
            Toggle
          </button>
          <AnimatePresence>
            {open ? <motion.div key="drawer" role="dialog" aria-label="Drawer" /> : null}
          </AnimatePresence>
        </>
      );
    }

    render(<Toggle />);
    const toggle = screen.getByRole('button', { name: 'Toggle' });

    expect(screen.queryByRole('dialog', { name: 'Drawer' })).toBeNull();

    await user.click(toggle);
    expect(screen.getByRole('dialog', { name: 'Drawer' })).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Drawer' })).toBeNull();
    });
  });
});
