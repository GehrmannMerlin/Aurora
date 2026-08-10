import { describe, expect, it } from 'vitest';
import {
  sectionToView,
  sectionViewLabel,
  toSectionView,
  type SectionResult,
} from '../../src/monitoring/section.js';

interface Evidence {
  readonly count: number;
}

describe('toSectionView', () => {
  it('loading wins over everything', () => {
    expect(
      toSectionView({ loading: true, error: 'e', section: { status: 'empty', reason: 'r' } }),
    ).toEqual({ kind: 'loading' });
  });

  it('error is shown when not loading', () => {
    expect(toSectionView({ loading: false, error: '加载失败', section: null })).toEqual({
      kind: 'error',
      message: '加载失败',
    });
  });

  it('a missing section without error is unavailable, never normal/zero', () => {
    expect(toSectionView({ loading: false, error: null, section: null })).toEqual({
      kind: 'unavailable',
      reason: '数据源未返回结果',
    });
  });

  it('passes the server section through', () => {
    const section: SectionResult<Evidence> = { status: 'available', data: { count: 3 } };
    expect(toSectionView({ loading: false, error: null, section })).toEqual({
      kind: 'available',
      data: { count: 3 },
    });
  });
});

describe('sectionToView', () => {
  it('maps every server status to the render union', () => {
    const cases: readonly [SectionResult<Evidence>, ReturnType<typeof sectionToView<Evidence>>][] =
      [
        [
          { status: 'available', data: { count: 1 } },
          { kind: 'available', data: { count: 1 } },
        ],
        [
          { status: 'empty', reason: 'no data' },
          { kind: 'empty', reason: 'no data' },
        ],
        [
          { status: 'partial', data: { count: 1 }, missing: 'x' },
          { kind: 'partial', data: { count: 1 }, missing: 'x' },
        ],
        [
          {
            status: 'stale',
            data: { count: 1 },
            freshAt: '2026-08-10T00:00:00.000Z',
            staleReason: 's',
          },
          {
            kind: 'stale',
            data: { count: 1 },
            freshAt: '2026-08-10T00:00:00.000Z',
            staleReason: 's',
          },
        ],
        [
          { status: 'unavailable', reason: 'deferred' },
          { kind: 'unavailable', reason: 'deferred' },
        ],
        [{ status: 'forbidden' }, { kind: 'forbidden' }],
      ];
    for (const [section, expected] of cases) {
      expect(sectionToView(section)).toEqual(expected);
    }
  });
});

describe('sectionViewLabel', () => {
  it('labels every render state in Chinese', () => {
    expect(sectionViewLabel({ kind: 'loading' })).toBe('正在加载');
    expect(sectionViewLabel({ kind: 'error', message: 'x' })).toBe('加载失败');
    expect(sectionViewLabel({ kind: 'empty', reason: 'x' })).toBe('无数据');
    expect(sectionViewLabel({ kind: 'unavailable', reason: 'x' })).toBe('不可用');
    expect(sectionViewLabel({ kind: 'forbidden' })).toBe('无权限');
    expect(sectionViewLabel({ kind: 'available', data: {} })).toBe('正常');
  });
});
