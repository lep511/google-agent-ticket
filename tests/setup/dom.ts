import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false`, así que el desmontaje se registra explícitamente.
afterEach(() => {
  cleanup();
});
