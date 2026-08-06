import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_INPUT_FIELDS,
  MAX_EFFECTIVE_INPUT_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  TEXT_MAX_LENGTH,
  TICKER_MAX_LENGTH,
  selectEffectiveInput,
  validateAnalyzeInput,
  type AnalyzeInputRejection,
  type AnalyzeInputValidation,
  type AnalyzeRequestBody,
  type ValidatedAnalyzeInput,
} from './analyzeInput.ts';
import type { InputMode } from './agentTypes.ts';

/** Valida contra un agente de tipo `ticker` que admite instrucción. */
function validateTicker(
  body: AnalyzeRequestBody,
  supportsInstruction = true,
): ReturnType<typeof validateAnalyzeInput> {
  return validateAnalyzeInput({ body, inputMode: 'ticker', supportsInstruction });
}

/** Valida contra un agente de tipo `text` que admite instrucción. */
function validateText(
  body: AnalyzeRequestBody,
  supportsInstruction = true,
): ReturnType<typeof validateAnalyzeInput> {
  return validateAnalyzeInput({ body, inputMode: 'text', supportsInstruction });
}

function expectAccepted(result: AnalyzeInputValidation): ValidatedAnalyzeInput {
  if (!result.ok || result.value === null) {
    throw new Error(
      `Se esperaba aceptación y llegó ${result.rejection?.body.code}: ${result.rejection?.body.error}`,
    );
  }
  expect(result.rejection).toBeNull();
  return result.value;
}

function expectRejected(result: AnalyzeInputValidation): AnalyzeInputRejection {
  if (result.ok || result.rejection === null) {
    throw new Error('Se esperaba un rechazo de validación');
  }
  expect(result.value).toBeNull();
  expect(result.rejection.status).toBe(400);
  return result.rejection;
}

describe('entrada efectiva: `input` con `ticker` como alias heredado', () => {
  it('usa `input` cuando contiene al menos un carácter tras recortar', () => {
    const value = expectAccepted(validateTicker({ input: ' msft ', ticker: 'TSLA' }));

    expect(value.field).toBe('input');
    expect(value.usedLegacyAlias).toBe(false);
    expect(value.input).toBe('MSFT');
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vacío', ''],
    ['solo espacios', '   '],
  ])('cae en el alias `ticker` cuando `input` está %s', (_label, input) => {
    const value = expectAccepted(validateTicker({ input, ticker: ' tsla ' }));

    expect(value.field).toBe('ticker');
    expect(value.usedLegacyAlias).toBe(true);
    expect(value.input).toBe('TSLA');
    expect(value.rawInput).toBe(' tsla ');
  });

  it('enumera los campos aceptados cuando ni `input` ni `ticker` aportan valor', () => {
    const rejection = expectRejected(validateTicker({ input: '  ', ticker: '' }));

    expect(rejection.body.code).toBe('missing_input');
    for (const field of ACCEPTED_INPUT_FIELDS) {
      expect(rejection.body.error).toContain(field);
    }
  });

  it('describe la selección sin validar nada', () => {
    expect(selectEffectiveInput({ ticker: 'IBM' })).toMatchObject({
      field: 'ticker',
      raw: 'IBM',
    });
    expect(selectEffectiveInput({})).toMatchObject({ field: null, raw: null });
  });
});

describe('rechazo por tipo, ausencia y límite común', () => {
  it('identifica el campo cuando la entrada no es una cadena', () => {
    const rejection = expectRejected(validateTicker({ input: 42 }));

    expect(rejection.body.code).toBe('invalid_input_type');
    expect(rejection.body.field).toBe('input');
    expect(rejection.body.error).toContain('number');
  });

  it('identifica el alias cuando `ticker` no es una cadena y `input` falta', () => {
    const rejection = expectRejected(validateTicker({ ticker: { symbol: 'TSLA' } }));

    expect(rejection.body.code).toBe('invalid_input_type');
    expect(rejection.body.field).toBe('ticker');
  });

  it.each<InputMode>(['ticker', 'text'])(
    'rechaza una entrada de más de 10.000 caracteres en modo %s',
    (inputMode) => {
      const rejection = expectRejected(
        validateAnalyzeInput({
          body: { input: 'a'.repeat(MAX_EFFECTIVE_INPUT_LENGTH + 1) },
          inputMode,
          supportsInstruction: false,
        }),
      );

      expect(rejection.body.code).toBe('input_too_long');
      expect(rejection.body.field).toBe('input');
      expect(rejection.body.limit).toContain(String(MAX_EFFECTIVE_INPUT_LENGTH));
    },
  );
});

describe('modo `ticker`: de 1 a 10 caracteres A-Z y 0-9', () => {
  it.each(['tsla', 'BRK1', 'a', '0123456789'])('acepta el símbolo %s', (received) => {
    const value = expectAccepted(validateTicker({ input: received }));
    expect(value.input).toBe(received.toUpperCase());
  });

  it.each([
    ['con guion', 'BRK-B'],
    ['con punto', 'TS.LA'],
    ['con espacio interior', 'TS LA'],
    ['con acento', 'TSLÁ'],
    ['de 11 caracteres', 'ABCDEFGHIJK'],
  ])('rechaza el símbolo %s', (_label, received) => {
    const rejection = expectRejected(validateTicker({ input: received }));

    expect(rejection.body.code).toBe('invalid_ticker_format');
    expect(rejection.body.field).toBe('input');
    expect(rejection.body.limit).toContain(String(TICKER_MAX_LENGTH));
  });
});

describe('modo `text`: de 1 a 2000 caracteres tras recortar', () => {
  it('acepta texto libre y devuelve el valor recortado sin cambiar la caja', () => {
    const value = expectAccepted(validateText({ input: '  Perfil de Iberdrola, S.A.  ' }));
    expect(value.input).toBe('Perfil de Iberdrola, S.A.');
  });

  it('acepta exactamente 2000 caracteres', () => {
    const value = expectAccepted(validateText({ input: 'x'.repeat(TEXT_MAX_LENGTH) }));
    expect(value.input).toHaveLength(TEXT_MAX_LENGTH);
  });

  it('rechaza 2001 caracteres identificando el campo y el límite', () => {
    const rejection = expectRejected(validateText({ input: 'x'.repeat(TEXT_MAX_LENGTH + 1) }));

    expect(rejection.body.code).toBe('text_too_long');
    expect(rejection.body.field).toBe('input');
    expect(rejection.body.limit).toContain(String(TEXT_MAX_LENGTH));
  });
});

describe('instrucción', () => {
  it('conserva la instrucción recortada cuando el agente la admite', () => {
    const value = expectAccepted(validateTicker({ input: 'TSLA', instruction: '  foco en deuda  ' }));
    expect(value.instruction).toBe('foco en deuda');
  });

  it('descarta la instrucción sin rechazar cuando el agente no la admite', () => {
    const value = expectAccepted(
      validateTicker({ input: 'TSLA', instruction: 'x'.repeat(MAX_INSTRUCTION_LENGTH + 1) }, false),
    );
    expect(value.instruction).toBeNull();
  });

  it('rechaza una instrucción que no es cadena', () => {
    const rejection = expectRejected(validateTicker({ input: 'TSLA', instruction: 7 }));

    expect(rejection.body.code).toBe('invalid_instruction_type');
    expect(rejection.body.field).toBe('instruction');
  });

  it('rechaza una instrucción de más de 2000 caracteres tras recortar', () => {
    const rejection = expectRejected(
      validateTicker({ input: 'TSLA', instruction: ` ${'y'.repeat(MAX_INSTRUCTION_LENGTH + 1)} ` }),
    );

    expect(rejection.body.code).toBe('instruction_too_long');
    expect(rejection.body.field).toBe('instruction');
    expect(rejection.body.limit).toContain(String(MAX_INSTRUCTION_LENGTH));
  });

  it('acepta la instrucción ausente y la vacía tras recortar', () => {
    expect(expectAccepted(validateTicker({ input: 'TSLA' })).instruction).toBeNull();
    expect(expectAccepted(validateTicker({ input: 'TSLA', instruction: '   ' })).instruction).toBe('');
  });
});
