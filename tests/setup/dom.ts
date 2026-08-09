import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false`, so the unmount is registered explicitly.
afterEach(() => {
  cleanup();
});
