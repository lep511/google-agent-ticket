/* ──────────────────────────────────────────────────────────── */
/*  History_Panel                                               */
/*                                                              */
/*  Right-side drawer that presents the already filtered list    */
/*  of Visible Entries. The component knows neither the store    */
/*  nor the Active Agent: it receives entries and returns        */
/*  intents through its callbacks, so filtering and persistence  */
/*  stay testable without a DOM.                                 */
/*                                                              */
/*  Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, */
/*  4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 5.6, 9.1, 9.2, 9.3,     */
/*  10.1, 10.2, 10.4, 10.5, 10.6, 10.8, 10.9                   */
/* ──────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Trash2, X } from 'lucide-react';
import {
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  type InteractionHistoryEntry,
} from '../interactionHistory';

/** Requirement 2.4: simultaneous translation and opacity, 200–300 ms. */
export const HISTORY_PANEL_TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const;

export interface HistoryPanelProps {
  open: boolean;
  /** Visible Entries already filtered and ordered by the Web_Client. */
  entries: InteractionHistoryEntry[];
  /** Requirement 5.6: no restoring while a run is in progress. */
  running: boolean;
  onClose: () => void;
  onRestore: (entry: InteractionHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  /** Reference instant for the relative timestamps; defaults to `Date.now()`. */
  now?: number;
}

export function HistoryPanel({
  open,
  entries,
  running,
  onClose,
  onRestore,
  onDelete,
  onClearAll,
  now,
}: HistoryPanelProps) {
  // Local confirmation layer of the clear-all action (Requirements 10.5–10.9).
  const [confirmClear, setConfirmClear] = useState(false);
  // Local confirmation layer of a single-entry deletion. The whole entry is
  // kept, not only its identifier, so the layer can name what it removes.
  const [pendingDelete, setPendingDelete] = useState<InteractionHistoryEntry | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Reference instant of the relative timestamps. Injecting it keeps the
  // rendered text independent of the clock during the tests (Requirement 4.4).
  const referenceNow = now ?? Date.now();

  /** Requirement 2.8: on open, focus moves to an element inside the panel. */
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  /** A closed panel never keeps a pending confirmation layer open. */
  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      setPendingDelete(null);
    }
  }, [open]);

  /**
   * An entry that stopped being a Visible Entry (deleted elsewhere, or hidden
   * by an agent switch) cannot keep its confirmation layer open.
   */
  useEffect(() => {
    if (pendingDelete === null) return;
    if (!entries.some((entry) => entry.id === pendingDelete.id)) setPendingDelete(null);
  }, [entries, pendingDelete]);

  /**
   * `Escape` layers (Requirements 2.3, 10.9): a single `keydown` listener with
   * the top layer first, so the key closes the confirmation while it is open
   * and the panel itself otherwise.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (pendingDelete !== null) {
        setPendingDelete(null); // the panel stays open, nothing is deleted
        return;
      }
      if (confirmClear) {
        setConfirmClear(false); // Requirement 10.9: the panel stays open
        return;
      }
      onClose(); // Requirement 2.3
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, confirmClear, pendingDelete, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Requirements 2.1, 2.2: darkened overlay that closes on click. */}
          <motion.div
            key="history-overlay"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={HISTORY_PANEL_TRANSITION}
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Requirements 2.5, 2.6, 2.7: fixed width on desktop, full width on mobile. */}
          <motion.aside
            key="history-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="History"
            className="fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-stone-800 bg-stone-900 font-sans text-stone-100 shadow-2xl sm:w-[380px]"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={HISTORY_PANEL_TRANSITION}
          >
            <header className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
              <h2 className="font-display text-sm uppercase tracking-wider text-stone-200">
                History
              </h2>
              {/* Requirement 2.10: close control with its accessible text. */}
              <button
                ref={closeRef}
                type="button"
                aria-label="Close history"
                onClick={onClose}
                className="rounded p-1.5 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Requirement 5.6: English notice above the list while a run runs. */}
            {running && (
              <p className="border-b border-stone-800 bg-stone-800/40 px-4 py-2 font-sans text-xs text-stone-400">
                Restoring is paused while a run is in progress.
              </p>
            )}

            {/* Requirements 9.1, 9.3: list and empty state are exclusive branches. */}
            {entries.length > 0 ? (
              <ul className="flex-1 space-y-2 overflow-y-auto p-3">
                {/* Requirement 4.1: the received order is the descending order. */}
                {entries.map((entry) => (
                  <li key={entry.id} className="group relative">
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => onRestore(entry)}
                      className="w-full rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5 pr-10 text-left transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {/* Requirements 4.2, 4.7: query clipped visually, value intact. */}
                      <p className="truncate font-sans text-sm text-stone-100">{entry.query}</p>
                      {/* Requirement 4.3: the instruction is the secondary line. */}
                      {entry.instruction && (
                        <p className="truncate font-serif text-xs italic text-stone-400">
                          {entry.instruction}
                        </p>
                      )}
                      {/* Requirements 4.4, 4.6: relative text, absolute date in `title`. */}
                      <time
                        dateTime={new Date(entry.createdAt).toISOString()}
                        title={formatAbsoluteTimestamp(entry.createdAt)}
                        className="mt-1 block font-mono text-[11px] text-stone-500"
                      >
                        {formatRelativeTimestamp(entry.createdAt, referenceNow)}
                      </time>
                    </button>
                    {/* Requirements 10.1, 10.2, 10.4: a sibling of the restore button,
                        never a descendant. It always stays in the accessibility tree;
                        only the opacity depends on the pointer and the focus. */}
                    <button
                      type="button"
                      aria-label="Delete entry"
                      onClick={(event) => {
                        event.stopPropagation();
                        // The deletion waits for its own confirmation layer.
                        setConfirmClear(false);
                        setPendingDelete(entry);
                      }}
                      className="absolute right-2 top-2 rounded p-1.5 text-stone-500 opacity-0 transition-opacity hover:text-[#CC3131] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              /* Requirement 9.1: empty state with its supporting line. */
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <Clock className="h-6 w-6 text-stone-600" />
                <p className="font-display text-sm text-stone-300">No history yet</p>
                <p className="font-sans text-xs text-stone-500">
                  Completed reports for this agent will appear here.
                </p>
              </div>
            )}

            {/* Requirements 9.2, 10.5: the footer exists only with Visible Entries. */}
            {entries.length > 0 && (
              <footer className="border-t border-stone-800 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setPendingDelete(null);
                    setConfirmClear(true);
                  }}
                  className="rounded border border-white/10 px-3 py-1.5 font-sans text-xs text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
                >
                  Clear all
                </button>
              </footer>
            )}
          </motion.aside>

          {/* Requirement 10.6: confirmation layer above the drawer. */}
          {confirmClear && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-sm rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-2xl">
                <h3 className="mb-2 font-display text-lg text-white">Clear all history?</h3>
                <p className="mb-5 text-sm text-stone-400">
                  This removes every saved report from this browser. It cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  {/* Requirement 10.8: cancelling changes nothing. */}
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                    }}
                    className="rounded-lg bg-[#CC3131] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#aa2929]"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirmation layer of a single-entry deletion, above the drawer
              and built like the clear-all one. */}
          {pendingDelete !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="mx-4 w-full max-w-sm rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-2xl">
                <h3 className="mb-2 font-display text-lg text-white">Delete this entry?</h3>
                <p className="mb-2 truncate font-sans text-sm text-stone-300">
                  {pendingDelete.query}
                </p>
                <p className="mb-5 text-sm text-stone-400">
                  This removes the saved report from this browser. It cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  {/* Cancelling keeps the entry and leaves the panel open. */}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(pendingDelete.id);
                      setPendingDelete(null);
                    }}
                    className="rounded-lg bg-[#CC3131] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#aa2929]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

export default HistoryPanel;
