import { ValidationError } from 'class-validator';
import { DETAIL_CODES, DetailCode } from './constants';
import { ErrorDetail, ValidationFailedException } from './api.exception';

/**
 * Turns class-validator output into the `details[]` shape, so a DTO-level
 * failure carries the same stable codes as the hand-written checks.
 */
export function validationExceptionFactory(errors: ValidationError[]): ValidationFailedException {
  return new ValidationFailedException(flatten(errors));
}

function flatten(errors: ValidationError[], prefix = ''): ErrorDetail[] {
  const details: ErrorDetail[] = [];

  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints && error.value === undefined) {
      // A missing field fails every rule on it (isString, maxLength, ...); one REQUIRED says it all.
      details.push({ field, code: DETAIL_CODES.REQUIRED, issue: 'is required' });
    } else {
      for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
        details.push({ field, code: codeFor(constraint, error.value), issue: stripField(message, error.property) });
      }
    }
    if (error.children?.length) details.push(...flatten(error.children, field));
  }

  return details;
}

function codeFor(constraint: string, value: unknown): DetailCode {
  if (/^(isDefined|isNotEmpty|arrayNotEmpty)$/.test(constraint)) return DETAIL_CODES.REQUIRED;
  if (constraint === 'arrayMinSize' && Array.isArray(value) && value.length === 0) return DETAIL_CODES.REQUIRED;
  if (/^(maxLength|arrayMaxSize)$/.test(constraint)) return DETAIL_CODES.TOO_LONG;
  if (/^(min|max|isPositive|isNegative|minLength|arrayMinSize)$/.test(constraint)) return DETAIL_CODES.OUT_OF_RANGE;
  return DETAIL_CODES.WRONG_SHAPE;
}

/** class-validator prefixes the property name; `field` already carries it. */
function stripField(message: string, property: string): string {
  return message.startsWith(property) ? message.slice(property.length).trim() : message;
}
