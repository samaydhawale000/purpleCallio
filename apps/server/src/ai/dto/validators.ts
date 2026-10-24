import {
  isURL,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

import { aiToolsAllowInsecureLocalhost } from '../ai.config';
import { validateToolParametersSchema } from '../tool-parameters-schema';

/** Rejects empty and whitespace-only strings. */
export const NOT_BLANK = /\S/;

/** Tool names: what every provider accepts as a function name. */
export const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/** BCP-47-ish language tag: "en", "hi", "en-US". */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export const TRANSCRIPT_RETENTION_DAYS = [7, 30, 90];

export function IsToolParametersSchema(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isToolParametersSchema',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          validateToolParametersSchema(value).length === 0,
        defaultMessage: (args: ValidationArguments) =>
          `parametersSchema is invalid: ${validateToolParametersSchema(args.value).join('; ')}`,
      },
    });
}

/** Rejects values whose JSON encoding is larger than `maxBytes` (UTF-8). */
export function MaxJsonBytes(maxBytes: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'maxJsonBytes',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options,
      validator: {
        validate: (value: unknown) => {
          if (value === undefined) return true;
          const json = JSON.stringify(value);
          return (
            json !== undefined && Buffer.byteLength(json, 'utf8') <= maxBytes
          );
        },
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be at most ${maxBytes} bytes as JSON.`,
      },
    });
}

const HTTPS_URL = { protocols: ['https'], require_protocol: true };
const LOCALHOST_URL =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s]*)?$/i;

/**
 * Tool endpoints: https:// URLs. With AI_TOOLS_ALLOW_INSECURE_LOCALHOST=true
 * (local development only) http(s)://localhost URLs are accepted too.
 */
export function IsToolEndpointUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isToolEndpointUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (isURL(value, HTTPS_URL) ||
            (aiToolsAllowInsecureLocalhost() && LOCALHOST_URL.test(value))),
      },
    });
}
