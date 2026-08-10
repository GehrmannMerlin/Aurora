import { createSdkControlPlane, parseSdkConfig, type SdkEventDraft } from '../src/index.js';

const parsed = parseSdkConfig({ clientKey: 'no-dom-consumer' });
if (!parsed.ok) throw new TypeError('invalid config');
const plane = createSdkControlPlane(parsed.config, { pageOrigin: 'https://example.com' });

const draft: SdkEventDraft = { eventType: 'error', body: { message: 'x' } };
const result = plane.processEvent(draft);
if (!result.ok) throw new TypeError('pipeline rejected a valid draft');
