/* ──────────────────────────────────────────────────────────── */
/*  Interface test environment                                   */
/*                                                               */
/*  If anything here fails, the UI test infrastructure is not      */
/*  operational and no component test in `src/**` can be trusted.  */
/* ──────────────────────────────────────────────────────────── */

import { useState } from 'react';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PROPERTY_RUNS } from '../setup/fastCheck.ts';

describe('web test environment', () => {
  it('renders a React component in jsdom with the jest-dom matchers', () => {
    render(<button type="button">Analyze</button>);

    // A missing `@testing-library/jest-dom/vitest` import would throw here.
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeInTheDocument();
  });

  it('drives state updates through user-event', async () => {
    const user = userEvent.setup();

    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          Runs: {count}
        </button>
      );
    }

    render(<Counter />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('Runs: 1');
  });

  it('unmounts the previous tree between tests', () => {
    // The `afterEach` cleanup from `tests/setup/dom.ts` ran after each test
    // above, so nothing they rendered is still in the document.
    expect(screen.queryByRole('button', { name: 'Analyze' })).toBeNull();
  });

  it('loads the shared fast-check configuration in the jsdom project too', () => {
    expect(fc.readConfigureGlobal().numRuns).toBe(PROPERTY_RUNS);
  });
});
