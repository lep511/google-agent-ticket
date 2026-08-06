import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * Comprobación del entorno `jsdom` + `@testing-library/react` del proyecto
 * `web`: si esta prueba falla, la infraestructura de pruebas de interfaz no
 * está operativa y las pruebas de componentes posteriores no son fiables.
 */
describe('entorno de pruebas de interfaz', () => {
  it('renderiza un componente React en jsdom con los matchers de jest-dom', () => {
    render(<button type="button">Analyze</button>);

    expect(screen.getByRole('button', { name: 'Analyze' })).toBeInTheDocument();
  });
});
