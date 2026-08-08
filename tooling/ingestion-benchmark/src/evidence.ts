import type { IngestionBenchmarkReport } from './types.js';

/**
 * Build a sanitized summary Markdown from a report. Only environment, profile,
 * per-scenario configuration, measured results, correctness results and
 * limitations are included. No client key, secret, digest, database URL, event
 * body, SQL or HTTP headers ever appear. The raw JSON is never copied in full.
 */
export function renderEvidenceMarkdown(report: IngestionBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Aurora 数据接入本地基准证据（2026-08-02）');
  lines.push('');
  lines.push(
    '> 本摘要只记录当前本机、当前 PostgreSQL、当前配置的测量结果，**不构成生产容量、生产成本、生产 SLO 达标或最终推荐配置的证据**。',
  );
  lines.push('');
  lines.push('## 环境');
  lines.push('');
  lines.push(`- runId: \`${report.run.runId}\``);
  lines.push(`- profile: \`${report.run.profile}\``);
  lines.push(`- success: \`${String(report.run.success)}\``);
  lines.push(`- Node.js: \`${report.environment.nodeVersion}\``);
  lines.push(`- pnpm: \`${report.environment.pnpmVersion}\``);
  lines.push(`- OS: \`${report.environment.platform} ${report.environment.arch}\``);
  lines.push(
    `- CPU: \`${report.environment.cpuModel}\`（${String(report.environment.logicalCores)} 逻辑核心）`,
  );
  lines.push(`- 总内存: ${formatBytes(report.environment.totalMemoryBytes)}`);
  lines.push(
    `- PostgreSQL server_version_num: \`${String(report.environment.postgresServerVersionNum)}\``,
  );
  lines.push(`- PostgreSQL client: \`${report.environment.pgClientVersion}\``);
  lines.push(`- API Pool max: ${String(report.environment.apiPoolMax)}`);
  lines.push(`- Worker Pool max: ${String(report.environment.workerPoolMax)}`);
  lines.push('');
  lines.push('## 各场景配置');
  lines.push('');
  lines.push('| 场景 | warmup | measured | batch | http并发 | worker并发 | claimBatch |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const scenario of report.scenarios) {
    const c = scenario.config;
    lines.push(
      `| ${c.name} | ${String(c.warmupEvents)} | ${String(c.measuredEvents)} | ${String(c.batchSize)} | ${String(c.httpConcurrency)} | ${String(c.workerConcurrency)} | ${String(c.claimBatchSize)} |`,
    );
  }
  lines.push('');
  lines.push('## 测量结果');
  lines.push('');
  lines.push(
    '| 场景 | 请求数 | 事件数 | accepted | duplicate | rejected | 请求/秒 | 事件/秒 | HTTP p50 (ms) | HTTP p95 (ms) | HTTP p99 (ms) | 处理 p50 (ms) | 处理 p95 (ms) | 处理 p99 (ms) | drain (ms) |',
  );
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.config.name} | ${String(scenario.requests)} | ${String(scenario.events)} | ${String(scenario.accepted)} | ${String(scenario.duplicate)} | ${String(scenario.rejected)} | ${scenario.throughput.requestsPerSecond.toFixed(1)} | ${scenario.throughput.eventsPerSecond.toFixed(1)} | ${scenario.httpLatencyMs.p50.toFixed(1)} | ${scenario.httpLatencyMs.p95.toFixed(1)} | ${scenario.httpLatencyMs.p99.toFixed(1)} | ${scenario.processingLatencyMs.p50.toFixed(1)} | ${scenario.processingLatencyMs.p95.toFixed(1)} | ${scenario.processingLatencyMs.p99.toFixed(1)} | ${scenario.drainDurationMs.toFixed(1)} |`,
    );
  }
  lines.push('');
  lines.push('## 正确性结果');
  lines.push('');
  for (const scenario of report.scenarios) {
    const failed = Object.entries(scenario.correctness).filter(([, passed]) => !passed);
    lines.push(
      `- **${scenario.config.name}**: ${failed.length === 0 ? '全部通过' : `失败项：${failed.map(([name]) => name).join(', ')}`}`,
    );
  }
  lines.push('');
  lines.push('## 局限性');
  lines.push('');
  lines.push('- 只代表当前本机、当前 PostgreSQL、当前配置；');
  lines.push('- 不表示生产容量、AWS/RDS 性能、生产 SLO 达标、生产成本或最终推荐配置；');
  lines.push('- synthetic processor 不模拟真实业务处理器（Source Map、聚合、告警等）。');
  lines.push('');
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, unitIndex);
  const unit = units[unitIndex] ?? 'B';
  return `${value.toFixed(1)} ${unit}`;
}
