/**
 * C1 项目接入（`project.onboarding`）view-model（PLT-05）。
 *
 * 第一层接入链状态只来自 `diagnosticsGetDataStatus` 的服务端组合 `summary`；
 * 本模块只把该服务端状态映射为 C1 语境下的诚实展示文案。它**不**把 DAT-20
 * 状态重算为 PRD §4.4.6 接入枚举（`connected`/`connection_error`/`not_started`
 * 依赖未提供的后端能力），也不从时间戳或计数猜测业务状态。
 */
import type { DiagnosisSummary } from '../../monitoring/diagnosis.js';

export interface OnboardingStatusLine {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'danger' | 'warning';
  readonly note?: string;
}

/** Map the server-composed diagnosis summary to an honest C1 status line. */
export function onboardingStatusLine(summary: DiagnosisSummary): OnboardingStatusLine {
  switch (summary.status) {
    case 'blocked':
      return summary.primaryCause === 'credential_inactive'
        ? {
            label: '密钥不可用',
            tone: 'danger',
            note: '客户端上报密钥全部非激活；请先检查密钥状态再继续接入。',
          }
        : { label: '接收受阻', tone: 'danger', note: '当前接收受阻，接入链无法继续。' };
    case 'not_receiving':
      return summary.primaryCause === 'no_credential'
        ? {
            label: '尚未接入',
            tone: 'warning',
            note: '尚未创建客户端上报密钥；创建后 SDK 才能上报数据。',
          }
        : {
            label: '暂未收到数据',
            tone: 'warning',
            note: '最近窗口内未收到任何 SDK 上报；不直接判断为接入异常。',
          };
    case 'processing':
      return {
        label: '处理中',
        tone: 'warning',
        note: '已收到事件，仍在处理；接入成功需等待测试错误完成聚合。',
      };
    case 'receiving':
      return {
        label: '已接收并处理',
        tone: 'success',
        note: '服务端已接收并处理数据；接入成功仍要求测试错误生成问题。',
      };
    case 'unknown':
      return { label: '状态未知', tone: 'neutral', note: '诊断输入不完整，无法给出确定状态。' };
  }
}
