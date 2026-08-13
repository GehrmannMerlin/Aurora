/**
 * D2 平台资源策略格式化（PLT-10c）。
 *
 * 纯函数：把策略来源枚举、传播状态和配置值转成页面可渲染的中文/带单位文本。
 * 配置值格式化只做展示，不做任何策略判断；单位与上下限的权威校验在服务端。
 */
import type { PlatformPolicyFields } from '../../monitoring/queries.js';

/** 可格式化的资源策略配置键（PRD §15.8 五字段 + 项目级 resourceLimit）。 */
export type PolicyConfigKey = keyof PlatformPolicyFields | 'resourceLimit';

/** 千分位整数计数（确定性 en-US 分组，不随宿主 locale 变化）。 */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * 配置值展示格式化：quota 带「事件/月」、warningRatio/hardLimit 为百分比、
 * 保留天数带「天」、项目 resourceLimit 为纯千分位计数、degradationEnabled 为开启/关闭。
 */
export function formatConfigValue(key: PolicyConfigKey, value: number | boolean): string {
  switch (key) {
    case 'defaultPeriodQuota':
      return `${formatCount(value as number)} 事件/月`;
    case 'warningRatio':
    case 'hardLimit':
      return `${String(value)}%`;
    case 'highValueRetentionDays':
      return `${String(value)} 天`;
    case 'resourceLimit':
      return formatCount(value as number);
    case 'degradationEnabled':
      return value ? '开启' : '关闭';
  }
}

/** 策略来源中文标签（ADR-035 source 枚举）。 */
export function policySourceLabel(source: string): string {
  switch (source) {
    case 'system_default':
      return '系统默认';
    case 'platform_admin':
      return '平台管理员配置';
    case 'inherited_from_organization':
      return '继承自组织';
    case 'inherited_from_platform':
      return '继承自平台默认';
    default:
      return source;
  }
}

/** 传播状态中文标签：第一版恒 unknown，如实展示"未确认"，绝不宣称已生效。 */
export function propagationLabel(status: string): string {
  if (status === 'unknown') return '传播状态未知/未确认';
  return status;
}
