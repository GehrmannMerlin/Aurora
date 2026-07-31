import {
  createCore,
  type AuroraCore,
  type CoreConfigInput,
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
void core.getState();
void core.getConfig();
void core.getDiagnostics();
