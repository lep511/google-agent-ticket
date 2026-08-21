import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LandingView } from './LandingView';
import type { AgentCatalogEntry } from './types';

function entry(overrides: Partial<AgentCatalogEntry> = {}): AgentCatalogEntry {
  return {
    id: 'financial_analyst_agent',
    name: 'Financial Analyst',
    tagline: 'Finds and synthesizes recent SEC filings.',
    description: 'Locates recent filings and synthesizes them into one report.',
    icon: 'Landmark',
    accentColor: 'rgba(255,255,255,0.12)',
    order: 10,
    isDefault: true,
    inputMode: 'ticker',
    inputPlaceholder: 'TICKER',
    actionLabel: 'Analyze',
    supportsInstruction: true,
    outputRenderer: 'financial_report',
    landing: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('LandingView', () => {
  it('renders the title, subtitle, and highlight groups from the manifest', () => {
    render(
      <LandingView
        agent={entry({
          landing: {
            title: 'Tickr, your intelligent financial document analyzer',
            subtitle: 'Automatically finds and synthesizes recent SEC filings.',
            highlights: [
              {
                title: 'Comprehensive SEC document coverage.',
                items: [
                  { title: 'Form 10-K & 10-Q', subtitle: 'Annual and Quarterly Reports', icon: 'FileText' },
                  { title: 'Form 8-K', subtitle: 'Current / Material Events', icon: 'Activity' },
                ],
              },
              {
                title: 'Deep insights pulled directly from the source.',
                items: [{ title: 'Identify key takeaways and risks', icon: 'CheckCircle2' }],
              },
            ],
          },
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tickr, your intelligent financial document analyzer' }),
    ).toBeTruthy();
    expect(screen.getByText('Automatically finds and synthesizes recent SEC filings.')).toBeTruthy();
    expect(screen.getByText('Comprehensive SEC document coverage.')).toBeTruthy();
    expect(screen.getByText('Deep insights pulled directly from the source.')).toBeTruthy();
    expect(screen.getByText('Form 10-K & 10-Q')).toBeTruthy();
    expect(screen.getByText('Annual and Quarterly Reports')).toBeTruthy();
    expect(screen.getByText('Form 8-K')).toBeTruthy();
    expect(screen.getByText('Identify key takeaways and risks')).toBeTruthy();
  });

  it('falls back to name, tagline, and description when the manifest omits landing', () => {
    render(<LandingView agent={entry({ landing: null })} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Financial Analyst' })).toBeTruthy();
    expect(screen.getByText('Finds and synthesizes recent SEC filings.')).toBeTruthy();
    expect(
      screen.getByText('Locates recent filings and synthesizes them into one report.'),
    ).toBeTruthy();
  });

  it('displays neutral content while no agent is active', () => {
    render(<LandingView agent={null} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Tickr');
    expect(screen.getByText('Pick an agent to start a run.')).toBeTruthy();
  });
});
