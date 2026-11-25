/**
 * "View as admin" preview model (4.23.1): matrix rows, summary and grouping.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionState,
  buildMatrixRows,
  filterMatrixRows,
  groupOtherPermissions,
  summarizePreview,
} from '../admin/src/utils/adminPreviewModel.mjs';

const PREVIEW = {
  admin: { id: 4, name: 'Mia Multirole', roles: [{ name: 'Author' }, { name: 'Reviewer' }] },
  contentTypes: [
    {
      uid: 'api::article.article',
      name: 'Article',
      kind: 'collection',
      draftAndPublish: true,
      actions: [
        { action: 'create', fields: null, locales: null, conditions: [] },
        { action: 'read', fields: null, locales: null, conditions: ['admin::is-creator'] },
        { action: 'update', fields: 3, fieldNames: ['a', 'b', 'c'], locales: null, conditions: [] },
      ],
    },
    {
      uid: 'api::review.review',
      name: 'Review',
      kind: 'collection',
      draftAndPublish: false,
      actions: [{ action: 'read', fields: null, locales: null, conditions: [] }],
    },
  ],
  unavailableContentTypes: [
    { uid: 'api::page.page', name: 'Page', kind: 'collection', draftAndPublish: true },
    { uid: 'api::global.global', name: 'Global settings', kind: 'single', draftAndPublish: false },
  ],
  otherPermissions: [
    {
      action: 'plugin::upload.read',
      name: 'Access the Media Library',
      section: 'plugins',
      scope: 'upload',
    },
    {
      action: 'admin::webhooks.read',
      name: 'Read',
      section: 'settings',
      category: 'webhooks',
      subCategory: 'general',
    },
    {
      action: 'plugin::content-type-builder.read',
      name: 'Read',
      section: 'plugins',
      scope: 'content-type-builder',
    },
  ],
};

test('action states: full, limited, none and not applicable', () => {
  assert.equal(actionState({ fields: null, locales: null, conditions: [] }, 'read', true), 'full');
  assert.equal(actionState({ fields: 2, locales: null, conditions: [] }, 'read', true), 'limited');
  assert.equal(
    actionState({ fields: null, locales: null, conditions: ['x'] }, 'read', true),
    'limited'
  );
  assert.equal(
    actionState({ fields: null, locales: ['de'], conditions: [] }, 'read', true),
    'limited'
  );
  assert.equal(actionState(undefined, 'read', true), 'none');
  assert.equal(actionState(undefined, 'publish', false), 'n/a');
  assert.equal(actionState(undefined, 'publish', true), 'none');
});

test('matrix rows list every content type, accessible or not, by name', () => {
  const rows = buildMatrixRows(PREVIEW);
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Article', 'Global settings', 'Page', 'Review']
  );
  const article = rows[0];
  assert.deepEqual(article.cells, {
    create: 'full',
    read: 'limited',
    update: 'limited',
    delete: 'none',
    publish: 'none',
  });
  assert.equal(article.details.length, 2);
  assert.equal(rows[1].hasAccess, false);
  assert.equal(rows[1].cells.publish, 'n/a');
  assert.equal(rows[3].cells.publish, 'n/a');
  assert.deepEqual(
    filterMatrixRows(rows, ' glob ').map((row) => row.uid),
    ['api::global.global']
  );
  assert.equal(filterMatrixRows(rows, '').length, 4);
});

test('summary counts content types and settings; no role means no access', () => {
  assert.deepEqual(summarizePreview(PREVIEW), {
    total: 4,
    read: 2,
    edit: 1,
    publish: 0,
    settings: 1,
    plugins: 2,
    hasRoles: true,
  });
  const none = summarizePreview({ admin: { roles: [] }, contentTypes: [], otherPermissions: [] });
  assert.equal(none.hasRoles, false);
  assert.equal(none.total, 0);
});

test('other permissions are grouped by plugin first, then settings category', () => {
  const groups = groupOtherPermissions(PREVIEW.otherPermissions);
  assert.deepEqual(
    groups.map((group) => [group.section, group.label, group.items.length]),
    [
      ['plugins', 'Content-Type Builder', 1],
      ['plugins', 'Media Library', 1],
      ['settings', 'Webhooks', 1],
    ]
  );
  assert.equal(groups[2].items[0].subCategory, null, '"general" sub-category is not shown');
});

test('several roles: the widest grant wins and duplicates are listed once', () => {
  const rows = buildMatrixRows({
    contentTypes: [
      {
        uid: 'api::article.article',
        name: 'Article',
        draftAndPublish: true,
        actions: [
          { action: 'read', fields: 2, locales: null, conditions: [] },
          { action: 'read', fields: null, locales: null, conditions: [] },
        ],
      },
    ],
  });
  assert.equal(rows[0].cells.read, 'full');
  const groups = groupOtherPermissions([
    {
      action: 'plugin::upload.read',
      name: 'Access the Media Library',
      section: 'plugins',
      scope: 'upload',
    },
    {
      action: 'plugin::upload.read',
      name: 'Access the Media Library',
      section: 'plugins',
      scope: 'upload',
    },
  ]);
  assert.equal(groups[0].items.length, 1);
});
