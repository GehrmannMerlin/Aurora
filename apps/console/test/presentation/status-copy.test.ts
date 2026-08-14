import { describe, expect, it } from 'vitest';
import { statusLabel } from '../../src/presentation/status-copy';

describe('statusLabel', () => {
  it.each([
    ['not_receiving', '尚未接收到数据'],
    ['no_received_events', '当前项目还没有已接收事件'],
    ['batch_partial', '部分操作未完成'],
    ['receiving', '正在接收数据'],
    ['processing', '正在处理'],
  ])('maps %s to readable Chinese copy', (key, expected) => {
    expect(statusLabel(key)).toBe(expected);
  });

  it('uses a safe unknown label instead of echoing an internal key', () => {
    expect(statusLabel('future_internal_key')).toBe('状态未知');
  });
});
