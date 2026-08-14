import CredentialModule from '@alicloud/credentials';
import DmModule, { SingleSendMailRequest } from '@alicloud/dm20151123';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { RuntimeOptions } from '@darabonba/typescript';
import type {
  DirectMailClientPort,
  DirectMailSingleSendRequest,
} from './aliyun-direct-mail-adapter.js';

export interface AliyunDirectMailClientOptions {
  readonly regionId: string;
  readonly endpoint?: string;
}

function sdkRequest(request: DirectMailSingleSendRequest): SingleSendMailRequest {
  return new SingleSendMailRequest({
    accountName: request.accountName,
    addressType: request.addressType,
    replyToAddress: request.replyToAddress,
    toAddress: request.toAddress,
    subject: request.subject,
    htmlBody: request.htmlBody,
    textBody: request.textBody,
    fromAlias: request.fromAlias,
    clickTrace: '0',
  });
}

/**
 * Create the official SDK wrapper with Alibaba Cloud's default credential
 * chain. Credential values are never accepted, read or exposed here.
 */
export function createAliyunDirectMailClient(
  options: AliyunDirectMailClientOptions,
): DirectMailClientPort {
  const credential = new CredentialModule.default();
  const config = new $OpenApiUtil.Config({
    credential,
    regionId: options.regionId,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  });
  const client = new DmModule.default(config);

  return {
    async singleSendMail(request, timeoutMs) {
      const runtime = new RuntimeOptions({
        autoretry: false,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      const response = await client.singleSendMailWithOptions(sdkRequest(request), runtime);
      return {
        ...(response.body?.requestId === undefined ? {} : { requestId: response.body.requestId }),
      };
    },
  };
}
