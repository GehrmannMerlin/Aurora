import { describe, expect, it } from 'vitest';
import {
  buildNotificationsView,
  notificationSectionToItems,
  notificationTypeLabel,
  type NotificationsSection,
} from '../../../src/views/account/notifications-view-model.js';
import type { NotificationItem } from '../../../src/monitoring/queries.js';

const item: NotificationItem = {
  notificationId: 'notif_1',
  type: 'new_issue',
  title: '新问题出现',
  occurredAt: '2026-08-12T08:00:00.000Z',
  target: {
    routeId: 'project.issue-detail',
    pathParams: { organizationId: 'org_1', projectId: 'prj_1', issueId: '7' },
    query: {},
  },
};

const availableSection: NotificationsSection = {
  status: 'available',
  items: [item],
  pagination: { nextCursor: 'cursor-2', totalCount: 1, totalCountStatus: 'available' },
};

describe('buildNotificationsView', () => {
  it('maps an available section with accumulated items and the next cursor', () => {
    const view = buildNotificationsView({
      loading: false,
      error: null,
      section: availableSection,
      unreadCount: { value: 1, status: 'available' },
      markingRead: new Set(),
      actionError: null,
    });
    expect(view.list).toEqual({ kind: 'available', data: [item] });
    expect(view.nextCursor).toBe('cursor-2');
    expect(view.unreadCount).toEqual({ value: 1, status: 'available' });
  });

  it('surfaces loading, error and missing-list honestly', () => {
    const loading = buildNotificationsView({
      loading: true,
      error: null,
      section: null,
      unreadCount: { status: 'unavailable' },
      markingRead: new Set(),
      actionError: null,
    });
    expect(loading.list.kind).toBe('loading');

    const errorView = buildNotificationsView({
      loading: false,
      error: '加载失败',
      section: null,
      unreadCount: { status: 'unavailable' },
      markingRead: new Set(),
      actionError: null,
    });
    expect(errorView.list.kind).toBe('error');

    const unavailable = buildNotificationsView({
      loading: false,
      error: null,
      section: null,
      unreadCount: { status: 'unavailable' },
      markingRead: new Set(),
      actionError: null,
    });
    expect(unavailable.list.kind).toBe('unavailable');
  });

  it('keeps an unknown unread count unavailable instead of fabricating zero', () => {
    const view = buildNotificationsView({
      loading: false,
      error: null,
      section: availableSection,
      unreadCount: { status: 'unavailable' },
      markingRead: new Set(),
      actionError: null,
    });
    expect(view.unreadCount).toEqual({ status: 'unavailable' });
  });
});

describe('notificationSectionToItems', () => {
  it('maps empty and unavailable flat sections', () => {
    expect(
      notificationSectionToItems({
        status: 'empty',
        items: [],
        pagination: { totalCount: 0, totalCountStatus: 'available' },
      }).kind,
    ).toBe('empty');
    expect(
      notificationSectionToItems({
        status: 'unavailable',
        reason: '后端不可用',
        items: [],
        pagination: { totalCount: 0, totalCountStatus: 'unavailable' },
      }).kind,
    ).toBe('unavailable');
  });
});

describe('notificationTypeLabel', () => {
  it('maps all PRD §11.4 first-increment types', () => {
    expect(notificationTypeLabel('alert_triggered')).toBe('告警触发');
    expect(notificationTypeLabel('alert_recovered')).toBe('告警恢复');
    expect(notificationTypeLabel('new_issue')).toBe('新问题');
    expect(notificationTypeLabel('issue_reappeared')).toBe('问题再次出现');
    expect(notificationTypeLabel('issue_assigned_to_me')).toBe('分配给我');
  });
});
