import type { BrowserResourceErrorSourceEvent } from '@aurora/browser';
import {
  ErrorCategory,
  ErrorResourceType,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';

export type ResourceErrorConversionResult =
  ErrorEventBodyParseResult | { readonly success: false; readonly unsupportedSource: true };

function includesRelToken(rel: string | null, token: string): boolean {
  return rel?.split(/\s+/u).includes(token) === true;
}

function mapResourceType(event: BrowserResourceErrorSourceEvent): ErrorResourceType | undefined {
  if (event.tagName === 'script' || event.as === 'script') return ErrorResourceType.Script;
  if (
    (event.tagName === 'link' && includesRelToken(event.rel, 'stylesheet')) ||
    event.as === 'style'
  ) {
    return ErrorResourceType.Stylesheet;
  }
  if (event.tagName === 'img' || event.as === 'image') return ErrorResourceType.Image;
  if (event.as === 'font') return ErrorResourceType.Font;
  return undefined;
}

export function convertResourceError(
  event: BrowserResourceErrorSourceEvent,
): ResourceErrorConversionResult {
  const type = mapResourceType(event);
  if (type === undefined) return { success: false, unsupportedSource: true };
  return parseErrorEventBody({
    category: ErrorCategory.Resource,
    resource: { type, url: event.sourceUrl },
  });
}
