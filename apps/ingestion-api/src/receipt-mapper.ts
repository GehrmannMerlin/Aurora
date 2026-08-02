import type { IngestionEventReceipt, IngestionReceiptState } from '@aurora/event-schema';
import type { InboxEventPersistResult } from '@aurora/ingestion-inbox';

/**
 * Map @aurora/ingestion-inbox persistence outcomes to public event receipt
 * semantics. inserted → accepted; duplicate → duplicate_accepted. Both are
 * non-retryable, consistent with the ingestion receipt contract.
 */
export function mapPersistResultsToEventReceipts(
  results: readonly InboxEventPersistResult[],
): readonly IngestionEventReceipt[] {
  return results.map((result) => {
    const state: IngestionReceiptState =
      result.outcome === 'inserted' ? 'accepted' : 'duplicate_accepted';
    const receipt: IngestionEventReceipt = {
      eventId: result.eventId,
      state,
      retryable: false,
    };
    return receipt;
  });
}
