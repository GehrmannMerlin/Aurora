import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorResourceType } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertResourceError } from '../src/resource-error-converter.js';

function resource(
  tagName: string | null,
  sourceUrl: string | null,
  rel: string | null = null,
  as: string | null = null,
) {
  return {
    type: BrowserErrorSourceEventType.Resource,
    tagName,
    sourceUrl,
    rel,
    as,
  } as const;
}

describe('resource error conversion', () => {
  it.each([
    [resource('script', 'https://static.example.test/app.js'), ErrorResourceType.Script],
    [
      resource('link', 'https://static.example.test/app.css', 'stylesheet'),
      ErrorResourceType.Stylesheet,
    ],
    [resource('img', 'https://static.example.test/a.png'), ErrorResourceType.Image],
    [
      resource('link', 'https://static.example.test/a.woff2', 'preload', 'font'),
      ErrorResourceType.Font,
    ],
  ] as const)('maps the supported resource %#', (input, type) => {
    expect(convertResourceError(input)).toMatchObject({
      success: true,
      data: { resource: { type } },
    });
  });

  it('uses event-schema to remove query and fragment', () => {
    expect(
      convertResourceError(
        resource('script', 'https://static.example.test/app.js?token=private#fragment'),
      ),
    ).toMatchObject({
      success: true,
      data: { resource: { url: 'https://static.example.test/app.js' } },
    });
  });

  it('returns explicit unsupported source instead of inventing other', () => {
    expect(convertResourceError(resource('video', 'https://static.example.test/a.mp4'))).toEqual({
      success: false,
      unsupportedSource: true,
    });
  });

  it.each([null, 'file:///app.js', '/relative.js'])(
    'rejects missing or unsafe URL %s through the public parser',
    (url) => {
      const result = convertResourceError(resource('script', url));
      expect(result.success).toBe(false);
      expect('unsupportedSource' in result).toBe(false);
    },
  );
});
