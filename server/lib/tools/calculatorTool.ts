/**
 * `calculate` tool for the Strands agent.
 *
 * Performs basic arithmetic operations: add, subtract, multiply, divide,
 * power, sqrt, and modulo. The agent calls this tool instead of computing
 * numbers itself, ensuring accuracy.
 */

import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

const OPERATIONS = ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt', 'modulo'] as const;
type Operation = (typeof OPERATIONS)[number];

function compute(operation: Operation, a: number, b?: number): number {
  switch (operation) {
    case 'add': return a + (b ?? 0);
    case 'subtract': return a - (b ?? 0);
    case 'multiply': return a * (b ?? 1);
    case 'divide':
      if (b === 0 || b === undefined) throw new Error('Division by zero');
      return a / b;
    case 'power': return Math.pow(a, b ?? 2);
    case 'sqrt':
      if (a < 0) throw new Error('Cannot compute square root of a negative number');
      return Math.sqrt(a);
    case 'modulo':
      if (b === 0 || b === undefined) throw new Error('Modulo by zero');
      return a % b;
  }
}

export function createCalculatorTool() {
  return tool({
    name: 'calculate',
    description:
      'Performs an arithmetic operation on one or two numbers. ' +
      'Supported operations: add, subtract, multiply, divide, power, sqrt, modulo. ' +
      'For sqrt, only parameter "a" is needed.',
    inputSchema: z.object({
      operation: z.enum(OPERATIONS).describe('The arithmetic operation to perform.'),
      a: z.number().describe('The first operand.'),
      b: z.number().optional().describe('The second operand (not needed for sqrt).'),
    }),
    callback: ({ operation, a, b }) => {
      const result = compute(operation, a, b);
      return { operation, a, b, result } as unknown as Record<string, unknown>;
    },
  });
}
