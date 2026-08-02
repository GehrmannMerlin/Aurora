import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  type BrowserPerformanceSourceEvent,
  type BrowserPerformanceSourceListener,
} from './performance-source-types.js';
import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import type {
  BrowserDestroyResult,
  BrowserSubscribeResult,
  BrowserSubscription,
  BrowserUnsubscribeResult,
} from './page-lifecycle.js';
import { callMethod, readMethod, readProperty } from './safe-access.js';

const SHIFT_GAP_MS = 1000;
const SESSION_WINDOW_MS = 5000;

interface LcpCandidate {
  readonly renderTime: number;
  readonly startTime: number;
}

interface ClsState {
  currentSessionValue: number;
  lastShiftStartTime: number | null;
  maxSessionValue: number;
}

interface InpState {
  currentInteractionId: number | null;
  currentInteractionMax: number;
  globalMax: number;
}

interface PerformanceRecord {
  readonly listener: BrowserPerformanceSourceListener;
  isActive: boolean;
  lcpCandidate: LcpCandidate | null;
  readonly cls: ClsState;
  readonly inp: InpState;
  readonly startedAt: number;
  emittedLcp: boolean;
  emittedCls: boolean;
  emittedInp: boolean;
}

export interface PerformanceObserverManager {
  subscribe(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

function readFiniteNumber(target: unknown, key: string): number | null {
  const value = readProperty(target, key);
  return value.ok && typeof value.value === 'number' && Number.isFinite(value.value)
    ? value.value
    : null;
}

function timeOriginMs(host: BrowserHostContext): number {
  const value = readFiniteNumber(host.performanceTarget, 'timeOrigin');
  return value ?? 0;
}

function readPageLoadFact(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserPerformanceSourceEvent | null {
  const getEntriesByType = readMethod(host.performanceTarget, 'getEntriesByType');
  if (!getEntriesByType.ok) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  const entries = callMethod(getEntriesByType.value, host.performanceTarget, ['navigation']);
  if (!entries.ok || !Array.isArray(entries.value) || entries.value.length === 0) return null;
  const entry: unknown = entries.value[0];
  const timeOrigin = readFiniteNumber(host.performanceTarget, 'timeOrigin');
  const startTime = readFiniteNumber(entry, 'startTime');
  const loadEventEnd = readFiniteNumber(entry, 'loadEventEnd');
  if (timeOrigin === null || startTime === null || loadEventEnd === null) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  const duration = loadEventEnd - startTime;
  if (duration < 0) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  if (loadEventEnd === 0) return null;
  const value = Math.round(duration);
  return Object.freeze({
    metricName: BrowserPerformanceMetricName.PageLoad,
    value,
    unit: BrowserPerformanceMetricUnit.Millisecond,
    startedAt: Math.round(timeOrigin + startTime),
    durationMs: value,
  });
}

function readEntries(
  list: unknown,
  diagnostics: BrowserDiagnosticStore,
  metricName: BrowserPerformanceMetricName,
): readonly unknown[] {
  const getEntries = readMethod(list, 'getEntries');
  if (!getEntries.ok) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: metricName,
    });
    return [];
  }
  const result = callMethod(getEntries.value, list, []);
  return result.ok && Array.isArray(result.value) ? result.value : [];
}

function updateLcp(record: PerformanceRecord, entries: readonly unknown[]): void {
  for (const raw of entries) {
    const renderTime = readFiniteNumber(raw, 'renderTime') ?? readFiniteNumber(raw, 'loadTime');
    const startTime = readFiniteNumber(raw, 'startTime');
    if (renderTime === null || renderTime <= 0 || startTime === null) continue;
    if (record.lcpCandidate === null || renderTime > record.lcpCandidate.renderTime) {
      record.lcpCandidate = { renderTime, startTime };
    }
  }
}

function updateCls(record: PerformanceRecord, entries: readonly unknown[]): void {
  for (const raw of entries) {
    const hadRecentInput = readProperty(raw, 'hadRecentInput');
    if (hadRecentInput.ok && hadRecentInput.value === true) continue;
    const value = readFiniteNumber(raw, 'value');
    const startTime = readFiniteNumber(raw, 'startTime');
    if (value === null || value < 0 || startTime === null) continue;
    const gapOk =
      record.cls.lastShiftStartTime === null ||
      startTime - record.cls.lastShiftStartTime <= SHIFT_GAP_MS;
    const windowOk =
      record.cls.lastShiftStartTime === null ||
      startTime - record.cls.lastShiftStartTime <= SESSION_WINDOW_MS;
    if (!gapOk || !windowOk) {
      record.cls.maxSessionValue = Math.max(
        record.cls.maxSessionValue,
        record.cls.currentSessionValue,
      );
      record.cls.currentSessionValue = 0;
    }
    record.cls.currentSessionValue += value;
    record.cls.lastShiftStartTime = startTime;
  }
}

function updateInp(record: PerformanceRecord, entries: readonly unknown[]): void {
  for (const raw of entries) {
    const entryType = readProperty(raw, 'entryType');
    const interactionIdValue = readProperty(raw, 'interactionId');
    const duration = readFiniteNumber(raw, 'duration');
    if (duration === null || duration < 0) continue;
    const rounded = Math.round(duration);
    if (interactionIdValue.ok && typeof interactionIdValue.value === 'number') {
      const id = interactionIdValue.value;
      if (Number.isSafeInteger(id) && id > 0) {
        if (record.inp.currentInteractionId !== id) {
          record.inp.globalMax = Math.max(record.inp.globalMax, record.inp.currentInteractionMax);
          record.inp.currentInteractionId = id;
          record.inp.currentInteractionMax = 0;
        }
        record.inp.currentInteractionMax = Math.max(record.inp.currentInteractionMax, rounded);
        continue;
      }
    }
    if (entryType.ok && entryType.value === 'first-input') {
      record.inp.globalMax = Math.max(record.inp.globalMax, rounded);
    }
  }
}

interface MetricObserver {
  readonly type: string;
  readonly observer: unknown;
  readonly disconnect: (() => unknown) | null;
}

function createMetricObserver(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
  type: string,
  onEntries: (list: unknown) => void,
): MetricObserver | undefined {
  const observerCtor = readProperty(host.windowTarget, 'PerformanceObserver');
  if (!observerCtor.ok || typeof observerCtor.value !== 'function') return undefined;
  let instance: unknown;
  try {
    instance = Reflect.construct(observerCtor.value as new () => unknown, [
      (list: unknown): void => {
        try {
          onEntries(list);
        } catch {
          diagnostics.append({
            code: BrowserDiagnosticCode.CallbackFailed,
            operation: BrowserDiagnosticOperation.Notify,
            capability: BrowserCapabilityName.PerformanceSource,
            eventType: type as BrowserPerformanceMetricName,
          });
        }
      },
    ]);
  } catch {
    return undefined;
  }
  const observe = readMethod(instance, 'observe');
  if (!observe.ok) return undefined;
  const observed = callMethod(observe.value, instance, [{ type, buffered: false }]);
  if (!observed.ok) return undefined;
  const disconnect = readMethod(instance, 'disconnect');
  return Object.freeze({
    type,
    observer: instance,
    disconnect: disconnect.ok ? disconnect.value : null,
  });
}

function disconnectObserver(metric: MetricObserver | undefined): void {
  if (metric?.disconnect === undefined || metric.disconnect === null) return;
  try {
    void callMethod(metric.disconnect, metric.observer, []);
  } catch {
    // disconnect 失败不得影响宿主
  }
}

export function createPerformanceObserverManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): PerformanceObserverManager {
  const records = new Set<PerformanceRecord>();
  let isDestroyed = false;
  let lcpObserver: MetricObserver | undefined;
  let clsObserver: MetricObserver | undefined;
  let inpObserver: MetricObserver | undefined;
  let installedPageHandlers = false;
  let onPageHide: (() => void) | null = null;
  let onVisibilityChange: (() => void) | null = null;

  function finalizeAll(): void {
    for (const record of [...records]) {
      if (!record.isActive) continue;
      finalize(record);
    }
  }

  function handlePageHide(): void {
    finalizeAll();
  }

  function handleVisibilityChange(): void {
    const visibility = readProperty(host.documentTarget, 'visibilityState');
    if (visibility.ok && visibility.value === 'hidden') finalizeAll();
  }

  function installPageHandlers(): void {
    if (installedPageHandlers) return;
    const add = readMethod(host.windowTarget, 'addEventListener');
    const docAdd = readMethod(host.documentTarget, 'addEventListener');
    if (!add.ok || !docAdd.ok) return;
    onPageHide = (): void => {
      try {
        handlePageHide();
      } catch {
        // 页面收尾不得破坏宿主
      }
    };
    onVisibilityChange = (): void => {
      try {
        handleVisibilityChange();
      } catch {
        // 页面收尾不得破坏宿主
      }
    };
    const pagehideResult = callMethod(add.value, host.windowTarget, ['pagehide', onPageHide]);
    const visibilityResult = callMethod(docAdd.value, host.documentTarget, [
      'visibilitychange',
      onVisibilityChange,
    ]);
    if (pagehideResult.ok || visibilityResult.ok) installedPageHandlers = true;
  }

  function removePageHandlers(): void {
    if (!installedPageHandlers) return;
    installedPageHandlers = false;
    const remove = readMethod(host.windowTarget, 'removeEventListener');
    const docRemove = readMethod(host.documentTarget, 'removeEventListener');
    if (remove.ok && onPageHide !== null) {
      try {
        void callMethod(remove.value, host.windowTarget, ['pagehide', onPageHide]);
      } catch {
        // 移除失败不得影响宿主
      }
    }
    if (docRemove.ok && onVisibilityChange !== null) {
      try {
        void callMethod(docRemove.value, host.documentTarget, [
          'visibilitychange',
          onVisibilityChange,
        ]);
      } catch {
        // 移除失败不得影响宿主
      }
    }
    onPageHide = null;
    onVisibilityChange = null;
  }

  function installObservers(): void {
    lcpObserver ??= createMetricObserver(host, diagnostics, 'largest-contentful-paint', (list) => {
      const entries = readEntries(list, diagnostics, BrowserPerformanceMetricName.Lcp);
      for (const record of [...records]) {
        if (record.isActive) updateLcp(record, entries);
      }
    });
    clsObserver ??= createMetricObserver(host, diagnostics, 'layout-shift', (list) => {
      const entries = readEntries(list, diagnostics, BrowserPerformanceMetricName.Cls);
      for (const record of [...records]) {
        if (record.isActive) updateCls(record, entries);
      }
    });
    if (inpObserver === undefined) {
      const eventObserver = createMetricObserver(host, diagnostics, 'event', (list) => {
        const entries = readEntries(list, diagnostics, BrowserPerformanceMetricName.Inp);
        for (const record of [...records]) {
          if (record.isActive) updateInp(record, entries);
        }
      });
      inpObserver =
        eventObserver ??
        createMetricObserver(host, diagnostics, 'first-input', (list) => {
          const entries = readEntries(list, diagnostics, BrowserPerformanceMetricName.Inp);
          for (const record of [...records]) {
            if (record.isActive) updateInp(record, entries);
          }
        });
    }
  }

  function emitTo(record: PerformanceRecord, event: BrowserPerformanceSourceEvent): void {
    // 收尾时 record.isActive 已为 false，但仍需发送最终候选；本函数不检查 isActive。
    try {
      record.listener(event);
    } catch {
      diagnostics.append({
        code: BrowserDiagnosticCode.CallbackFailed,
        operation: BrowserDiagnosticOperation.Notify,
        capability: BrowserCapabilityName.PerformanceSource,
        eventType: event.metricName,
      });
    }
  }

  function finalize(record: PerformanceRecord): void {
    const timeOrigin = timeOriginMs(host);
    if (record.lcpCandidate !== null && !record.emittedLcp) {
      record.emittedLcp = true;
      emitTo(record, {
        metricName: BrowserPerformanceMetricName.Lcp,
        value: Math.round(record.lcpCandidate.renderTime),
        unit: BrowserPerformanceMetricUnit.Millisecond,
        startedAt: Math.round(timeOrigin + record.lcpCandidate.startTime),
      });
    }
    const finalCls = Math.max(record.cls.currentSessionValue, record.cls.maxSessionValue);
    if (finalCls > 0 && !record.emittedCls) {
      record.emittedCls = true;
      emitTo(record, {
        metricName: BrowserPerformanceMetricName.Cls,
        value: finalCls,
        unit: BrowserPerformanceMetricUnit.Ratio,
        startedAt: record.startedAt,
      });
    }
    const finalInp = Math.max(record.inp.globalMax, record.inp.currentInteractionMax);
    if (finalInp > 0 && !record.emittedInp) {
      record.emittedInp = true;
      emitTo(record, {
        metricName: BrowserPerformanceMetricName.Inp,
        value: finalInp,
        unit: BrowserPerformanceMetricUnit.Millisecond,
        startedAt: record.startedAt,
      });
    }
  }

  function disconnectAll(): void {
    disconnectObserver(lcpObserver);
    disconnectObserver(clsObserver);
    disconnectObserver(inpObserver);
    lcpObserver = undefined;
    clsObserver = undefined;
    inpObserver = undefined;
    removePageHandlers();
  }

  function subscribe(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult {
    if (typeof listener !== 'function') {
      return Object.freeze({
        ok: false,
        code: 'invalid_listener' as const,
        diagnosticsAdded: 0,
      });
    }
    if (isDestroyed) {
      return Object.freeze({
        ok: false,
        code: 'destroyed' as const,
        diagnosticsAdded: 0,
      });
    }
    const record: PerformanceRecord = {
      listener,
      isActive: true,
      lcpCandidate: null,
      cls: { currentSessionValue: 0, lastShiftStartTime: null, maxSessionValue: 0 },
      inp: { currentInteractionId: null, currentInteractionMax: 0, globalMax: 0 },
      startedAt: Date.now(),
      emittedLcp: false,
      emittedCls: false,
      emittedInp: false,
    };
    records.add(record);
    const before = diagnostics.getTotalCount();
    installObservers();
    installPageHandlers();
    const pageLoad = readPageLoadFact(host, diagnostics);
    if (pageLoad !== null) emitTo(record, pageLoad);
    if (diagnostics.getTotalCount() - before > 0) {
      record.isActive = false;
      records.delete(record);
      if (records.size === 0) disconnectAll();
      return Object.freeze({
        ok: false,
        code: 'listener_registration_failed' as const,
        diagnosticsAdded: diagnostics.getTotalCount() - before,
      });
    }
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe: (): BrowserUnsubscribeResult => {
        if (!record.isActive) {
          return Object.freeze({
            ok: true,
            code: 'already_unsubscribed' as const,
            diagnosticsAdded: 0,
          });
        }
        record.isActive = false;
        records.delete(record);
        finalize(record);
        if (records.size === 0) disconnectAll();
        return Object.freeze({
          ok: true,
          code: 'unsubscribed' as const,
          diagnosticsAdded: 0,
        });
      },
    });
    return Object.freeze({
      ok: true,
      code: 'subscribed' as const,
      subscription,
      diagnosticsAdded: 0,
    });
  }

  function destroy(): BrowserDestroyResult {
    if (isDestroyed) {
      return Object.freeze({
        ok: true,
        code: 'already_destroyed' as const,
        diagnosticsAdded: 0,
      });
    }
    isDestroyed = true;
    for (const record of [...records]) {
      record.isActive = false;
      finalize(record);
    }
    records.clear();
    disconnectAll();
    return Object.freeze({
      ok: true,
      code: 'destroyed' as const,
      diagnosticsAdded: 0,
    });
  }

  return Object.freeze({ subscribe, destroy });
}
