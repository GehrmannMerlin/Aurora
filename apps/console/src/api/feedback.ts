import { ApiError } from './errors.js';

/**
 * Map an unknown request failure to a safe, user-facing message. Public auth
 * commands (register/login/request-reset/confirm) never reveal account
 * existence; rate-limit and authority failures are stated plainly while
 * server-authored titles are only surfaced when they cannot leak existence
 * (e.g. business_validation on register).
 */
export function describeRequestError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      case 'structural_error':
      case 'field_validation':
        return '输入内容不符合要求，请检查后重试。';
      default:
        return caught.message;
    }
  }
  return '发生未知错误，请稍后重试。';
}
