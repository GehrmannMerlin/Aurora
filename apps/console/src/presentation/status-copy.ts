const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  not_receiving: '尚未接收到数据',
  no_received_events: '当前项目还没有已接收事件',
  batch_partial: '部分操作未完成',
  receiving: '正在接收数据',
  processing: '正在处理',
});

const UNKNOWN_STATUS_LABEL = '状态未知';

export function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? UNKNOWN_STATUS_LABEL;
}
