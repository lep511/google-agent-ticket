/**
 * Printing a report to PDF.
 *
 * Browsers name the PDF after `document.title`, so the title is swapped for a
 * task-specific file name while the print dialog is open and restored
 * afterwards. The page title is otherwise the product name.
 */

/** Lower-case, hyphen-separated form of the agent name for a file name. */
export function slugifyForFileName(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'report';
}

/** Local calendar date as `YYYY-MM-DD`. */
export function formatDateForFileName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `report-{agent}-{date}`, without extension: the browser appends `.pdf`
 * itself when the destination is "Save as PDF".
 */
export function buildReportFileName(agentName: string | undefined, date: Date = new Date()): string {
  return `report-${slugifyForFileName(agentName ?? '')}-${formatDateForFileName(date)}`;
}

/**
 * Opens the print dialog with `fileName` as the document title and puts the
 * previous title back once printing ends. `afterprint` is the signal browsers
 * give; the timer covers the ones that never fire it.
 */
export function printWithFileName(fileName: string, win: Window = window): void {
  const previousTitle = win.document.title;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    win.document.title = previousTitle;
    win.removeEventListener('afterprint', restore);
  };

  win.document.title = fileName;
  win.addEventListener('afterprint', restore);
  try {
    win.print();
  } finally {
    // Browsers that block in `print()` have already fired `afterprint` here;
    // the others get a generous window before the title goes back.
    win.setTimeout(restore, 60_000);
  }
}
