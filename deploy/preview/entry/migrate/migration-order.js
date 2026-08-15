const LEGACY_PRODUCTION_ORDER = Object.freeze([
  '1722500000000_event-inbox',
  '1722500000001_event-inbox-processing',
  '1722500000002_event-inbox-replay',
  '1722500000002_ingestion-client-credentials',
  '1722500000003_error-event-occurrences',
  '1722500000004_request-event-samples',
  '1722500000005_request-metric-aggregation',
  '1722500000006_performance-aggregate-and-sample',
  '1786233600000_create-platform-identity-tables',
  '1786242000000_organization-settings-version',
  '1786244000000_account-deletion',
  '1786300000000_project-governance',
  '1786500000000_private-tokens',
  '1786700000000_audit-extension',
  '1722500000007_error-occurrence-fingerprint',
  '1722500000008_issue-aggregate-and-samples',
  '1722500000009_issue-activities-notes',
  '1722500000010_alert-rules-and-instances',
  '1722500000011_error-occurrence-symbolizations',
  '1786245000000_account-cleanup-steps',
  '1786700000001_platform-admins',
  '1786700000002_platform-audit-events',
  '1786700000011_platform-resource-policies',
  '1786700000012_organization-policy-overrides',
  '1786700000013_project-policy-limits',
  '1787000000000_releases-and-source-maps',
  '1897000000001_notifications',
]);

function withoutExtension(name) {
  return name.replace(/\.(?:c|m)?(?:j|t)s$/u, '');
}

function timestampOf(name) {
  const match = /^(\d+)_/u.exec(name);
  if (match === null) {
    throw new Error(`migration filename has no numeric timestamp: ${name}`);
  }
  return BigInt(match[1]);
}

export function compareMigrationNames(left, right) {
  const leftTimestamp = timestampOf(left);
  const rightTimestamp = timestampOf(right);
  if (leftTimestamp < rightTimestamp) return -1;
  if (leftTimestamp > rightTimestamp) return 1;
  return left.localeCompare(right, undefined, {
    usage: 'sort',
    numeric: true,
    sensitivity: 'variant',
    ignorePunctuation: true,
  });
}

function assertUnique(names, label) {
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`${label} contains duplicate migration: ${name}`);
    }
    seen.add(name);
  }
}

function isPrefix(prefix, values) {
  return prefix.every((value, index) => values[index] === value);
}

export function analyzeMigrationOrder(sourceFilenames, executedNames) {
  const sourceNames = sourceFilenames.map(withoutExtension);
  assertUnique(sourceNames, 'migration sources');
  assertUnique(executedNames, 'migration ledger');

  const sourceSet = new Set(sourceNames);
  for (const name of executedNames) {
    if (!sourceSet.has(name)) {
      throw new Error(`executed migration is missing from release sources: ${name}`);
    }
  }

  const globallySorted = [...sourceNames].sort(compareMigrationNames);
  if (isPrefix(executedNames, globallySorted)) {
    return {
      compatibility: 'strict',
      checkOrder: true,
      pendingNames: globallySorted.slice(executedNames.length),
    };
  }

  if (!isPrefix(LEGACY_PRODUCTION_ORDER, executedNames)) {
    throw new Error(
      'migration ledger order is neither globally sorted nor the approved production legacy sequence',
    );
  }

  for (const name of LEGACY_PRODUCTION_ORDER) {
    if (!sourceSet.has(name)) {
      throw new Error(`approved production migration is missing from release sources: ${name}`);
    }
  }

  const legacyMaxTimestamp = LEGACY_PRODUCTION_ORDER.reduce((current, name) => {
    const timestamp = timestampOf(name);
    return timestamp > current ? timestamp : current;
  }, 0n);
  const futureNames = globallySorted.filter((name) => !LEGACY_PRODUCTION_ORDER.includes(name));
  const futureTimestamps = new Set();
  for (const name of futureNames) {
    const timestamp = timestampOf(name);
    if (timestamp <= legacyMaxTimestamp) {
      throw new Error(
        `new migration timestamp must be strictly greater than the frozen production baseline: ${name}`,
      );
    }
    if (futureTimestamps.has(timestamp)) {
      throw new Error(`duplicate future migration timestamp: ${name}`);
    }
    futureTimestamps.add(timestamp);
  }

  const executedFuture = executedNames.slice(LEGACY_PRODUCTION_ORDER.length);
  if (!isPrefix(executedFuture, futureNames)) {
    throw new Error('migrations after the production legacy baseline are not globally ordered');
  }

  return {
    compatibility: 'approved-production-legacy',
    checkOrder: false,
    pendingNames: futureNames.slice(executedFuture.length),
  };
}

export { LEGACY_PRODUCTION_ORDER };
