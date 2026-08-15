<script setup lang="ts">
/**
 * D1 通知中心（`account.notifications`，PLT-09）。
 *
 * 账号级页面，只消费公开 `notificationsListAndUnread` 查询与 `notificationsMarkRead`
 * 命令。URL `?read=all|unread` 权威；keyset 加载更多；单条"标为已读"（成功后刷新
 * 列表与未读角标）；行点击打开受约束 Route Target（失效目标安全留在列表页）。未读
 * 数量未知显示 unavailable 而非 0；不伪造数据、不直连后端。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RouteTargetId } from '@aurora/platform-contract';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import { fetchNotifications, type NotificationItem } from '../../monitoring/queries.js';
import { markNotificationRead } from '../../monitoring/commands.js';
import { formatUtc } from '../../monitoring/format.js';
import { useSessionStore } from '../../stores/session.js';
import { useNavigationStore } from '../../stores/navigation.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import {
  buildNotificationsView,
  notificationTypeLabel,
  type NotificationsSection,
  type UnreadCountProjection,
} from './notifications-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

type ReadFilter = 'all' | 'unread';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const navigation = useNavigationStore();

/** URL `?read=all|unread` is authoritative; any other value means all. */
const readFilter = computed<ReadFilter>(() => (route.query.read === 'unread' ? 'unread' : 'all'));

const section = ref<NotificationsSection | null>(null);
const accumulatedItems = ref<readonly NotificationItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const markingRead = ref<ReadonlySet<string>>(new Set());
const actionError = ref<string | null>(null);
const unreadCount = ref<UnreadCountProjection>({ status: 'unavailable' });

function describeNotificationsError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authentication') return '登录状态已失效，请重新登录。';
    if (caught.code === 'authorization') return '你没有查看通知的权限。';
    if (caught.code === 'structural_error' || caught.code === 'field_validation') {
      return '通知查询条件无效，请刷新页面后重试。';
    }
  }
  return describeRequestError(caught);
}

/** The flat notifications section; the view-model maps it to a render state. */
function currentSection(): NotificationsSection | null {
  return section.value;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchNotifications({ readState: readFilter.value, limit: 50 });
    section.value = data.notifications;
    accumulatedItems.value = data.notifications.items;
    unreadCount.value = data.unreadCount;
  } catch (caught) {
    error.value = describeNotificationsError(caught);
    section.value = null;
    accumulatedItems.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const cursor = state.value.nextCursor;
  if (cursor === undefined || loading.value) return;
  loading.value = true;
  actionError.value = null;
  try {
    const next = await fetchNotifications({
      readState: readFilter.value,
      cursor,
      limit: 50,
    });
    const existing = section.value?.items ?? [];
    section.value = { ...next.notifications, items: [...existing, ...next.notifications.items] };
    accumulatedItems.value = section.value.items;
    unreadCount.value = next.unreadCount;
  } catch (caught) {
    actionError.value = describeNotificationsError(caught);
  } finally {
    loading.value = false;
  }
}

const state = computed(() =>
  buildNotificationsView({
    loading: loading.value,
    error: error.value,
    section: currentSection(),
    unreadCount: unreadCount.value,
    markingRead: markingRead.value,
    actionError: actionError.value,
  }),
);

async function onMarkRead(item: NotificationItem): Promise<void> {
  if (item.readAt !== undefined || markingRead.value.has(item.notificationId)) return;
  actionError.value = null;
  markingRead.value = new Set([...markingRead.value, item.notificationId]);
  try {
    await markNotificationRead(item.notificationId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    });
    invalidateScope({ type: 'account' });
    await load();
  } catch (caught) {
    actionError.value =
      caught instanceof ApiError && caught.code === 'authorization'
        ? '你没有权限操作该通知。'
        : describeRequestError(caught);
  } finally {
    const next = new Set(markingRead.value);
    next.delete(item.notificationId);
    markingRead.value = next;
  }
}

function openTarget(item: NotificationItem): void {
  const resolved = resolveRouteTarget(
    item.target as {
      routeId: RouteTargetId;
      pathParams: Readonly<Record<string, string>>;
      query: Readonly<Record<string, string>>;
    },
  );
  if (resolved.error !== undefined || resolved.path === undefined) return;
  void router.push(resolved.path);
}

onMounted(() => {
  void load();
});

watch(readFilter, () => {
  void load();
});

// Sync the authoritative unread count into the TopBar badge after every load.
watch(unreadCount, (value) => {
  navigation.applyUnreadCount(value?.value, value?.status ?? 'unavailable');
});
</script>

<template>
  <div class="notifications-page" data-testid="notifications-view">
    <AppPageHeader
      title="通知中心"
      description="按服务端提供的状态查看通知；筛选条件保存在地址中。"
    />
    <div class="notifications-tabs" role="tablist" aria-label="通知筛选">
      <RouterLink
        :to="{ path: '/notifications', query: { read: 'all' } }"
        class="notifications-tab"
        :class="{ 'notifications-tab--active': readFilter === 'all' }"
        role="tab"
        :aria-selected="readFilter === 'all'"
      >
        全部
      </RouterLink>
      <RouterLink
        :to="{ path: '/notifications', query: { read: 'unread' } }"
        class="notifications-tab"
        :class="{ 'notifications-tab--active': readFilter === 'unread' }"
        role="tab"
        :aria-selected="readFilter === 'unread'"
      >
        未读
      </RouterLink>
    </div>

    <SectionNotice :view="state.list" />

    <ul v-if="state.list.kind === 'available'" class="notifications-list">
      <li
        v-for="item in state.list.data"
        :key="item.notificationId"
        class="notifications-item"
        :class="{ 'notifications-item--unread': item.readAt === undefined }"
      >
        <button
          type="button"
          class="notifications-open"
          :aria-label="`打开 ${item.title}`"
          @click="openTarget(item)"
        >
          <span class="notifications-type" data-testid="notification-type">
            {{ notificationTypeLabel(item.type) }}
          </span>
          <span class="notifications-title">{{ item.title }}</span>
          <span v-if="item.summary !== undefined" class="notifications-summary">
            {{ item.summary }}
          </span>
          <span class="notifications-meta">
            <time :datetime="item.occurredAt">{{ formatUtc(item.occurredAt) }}</time>
          </span>
        </button>
        <span
          v-if="item.readAt === undefined"
          class="notifications-unread-dot"
          aria-hidden="true"
        />
        <span v-if="item.readAt === undefined" class="notifications-unread-state">未读</span>
        <button
          v-if="item.readAt === undefined"
          type="button"
          class="notifications-mark"
          :disabled="markingRead.has(item.notificationId)"
          data-testid="mark-read"
          @click.stop="onMarkRead(item)"
        >
          {{ markingRead.has(item.notificationId) ? '处理中…' : '标为已读' }}
        </button>
        <span v-else class="notifications-read-at">已读 {{ formatUtc(item.readAt) }}</span>
      </li>
    </ul>

    <p v-if="actionError !== null" class="notifications-action-error" role="alert">
      {{ actionError }}
    </p>

    <button
      v-if="state.list.kind === 'available' && state.nextCursor !== undefined"
      type="button"
      class="notifications-more"
      :disabled="loading"
      data-testid="load-more"
      @click="loadMore()"
    >
      {{ loading ? '加载中…' : '加载更多' }}
    </button>
  </div>
</template>

<style scoped>
.notifications-page {
  max-width: 840px;
  margin: 0 auto;
}
.notifications-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border, #e5e0d6);
}
.notifications-tab {
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-secondary);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  background-image: none;
}
.notifications-tab--active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-context-active-indicator);
}
.notifications-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.notifications-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background-color: var(--color-surface-bg);
}
.notifications-item--unread {
  border-left: 3px solid var(--color-status-info);
}
.notifications-open {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.notifications-type {
  font-size: 0.75rem;
  color: var(--color-context-active-indicator);
  font-weight: 600;
}
.notifications-title {
  font-weight: 600;
  color: var(--color-text-primary);
}
.notifications-summary {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notifications-meta {
  display: flex;
  gap: var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}
.notifications-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-status-info);
}
.notifications-unread-state {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
.notifications-mark {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-bg);
  cursor: pointer;
}
.notifications-read-at {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}
.notifications-action-error {
  color: var(--color-danger, #c0392b);
  margin: var(--space-3) 0;
}
.notifications-more {
  display: block;
  margin: var(--space-4) auto 0;
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-bg);
  cursor: pointer;
}
</style>
