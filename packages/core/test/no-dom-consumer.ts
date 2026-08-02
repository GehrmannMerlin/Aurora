import {
  createCore,
  type AuroraCore,
  type CoreConfigInput,
  type CoreEventDraft,
  type CoreEventProviders,
  type CorePlugin,
} from '../src/index.js';

const input: CoreConfigInput = { maxDiagnosticEntries: 10 };
const core: AuroraCore = createCore();
const plugin: CorePlugin = {
  name: 'compile-plugin',
  initialize: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  destroy: () => undefined,
};
void core.initialize(input);
void core.registerPlugin(plugin);
void core.submitEvent({ protocolVersion: 1 });
void core.submitEventDraft({ eventType: 'error', body: null });
void core.getState();
void core.getConfig();
void core.getDiagnostics();
const providers: CoreEventProviders = {
  eventIdProvider: { createEventId: (): string => 'compile-event' },
  eventTimeProvider: { now: (): number => 1 },
};
const draft: CoreEventDraft = { eventType: 'error', body: null };
void [providers, draft];
