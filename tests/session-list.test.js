'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_LIST_OFFSET,
  buildSessionWhere,
  decodeExportCursor,
  encodeExportCursor,
  exportQuerySchema,
  isPaginatedListQuery,
  listQuerySchema,
  parseQuery,
  statsQuerySchema,
} = require('../server/src/utils/session-list-query');
const {
  clearSessionStatsCache,
  exportSessionBatch,
  getSessionStats,
  listSessionPage,
} = require('../server/src/utils/session-list');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const cutoff = new Date('2026-11-10T10:00:00.000Z');

/**
 * Strapi double that records Query Engine calls on the session table.
 *
 * @param {{rows?: object[], total?: number, nativeTable?: boolean, nativeActive?: string[], jwtManagement?: string}} [options]
 */
function createStrapi({
  rows = [],
  total = rows.length,
  nativeTable = false,
  nativeActive = [],
  jwtManagement,
} = {}) {
  const calls = { findMany: [], count: [], native: [] };
  const strapi = {
    config: {
      get: (key, fallback) =>
        key === 'plugin::users-permissions.jwtManagement' && jwtManagement
          ? jwtManagement
          : fallback,
    },
    contentTypes: nativeTable ? { 'admin::session': {} } : {},
    db: {
      query(uid) {
        if (uid === 'admin::session') {
          return {
            findMany: async (args) => {
              calls.native.push(args);
              return nativeActive.map((sessionId) => ({ sessionId }));
            },
          };
        }
        assert.equal(uid, SESSION_UID);
        return {
          count: async (args) => {
            calls.count.push(args);
            return total;
          },
          findMany: async (args) => {
            calls.findMany.push(args);
            return rows;
          },
        };
      },
      metadata: {
        get: () => ({
          tableName: 'magic_sessions',
          attributes: {
            user: {
              joinTable: {
                name: 'magic_sessions_user_lnk',
                joinColumn: { name: 'session_id' },
                inverseJoinColumn: { name: 'user_id' },
              },
            },
          },
        }),
      },
      connection: createKnexDouble(calls),
    },
  };
  return { strapi, calls };
}

/** Minimal knex double for the distinct-user count. */
function createKnexDouble(calls) {
  const knex = (table) => {
    calls.knexTable = table;
    const builder = {
      join: () => builder,
      where: () => builder,
      andWhere: () => builder,
      countDistinct: (spec) => {
        calls.countDistinct = spec;
        return builder;
      },
      first: async () => ({ count: '3' }),
    };
    return builder;
  };
  knex.raw = (sql) => sql;
  return knex;
}

test('list query: strict whitelist, bounds and coercion', () => {
  const ok = parseQuery(listQuerySchema, { page: '2', pageSize: '50', status: 'idle' });
  assert.deepEqual(ok, {
    ok: true,
    value: {
      page: 2,
      pageSize: 50,
      sort: 'loginTime:desc',
      status: 'idle',
      reason: 'all',
      search: '',
    },
  });

  const rejected = [
    { page: '0' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { pageSize: '101' },
    { pageSize: '0' },
    { status: 'deleted' },
    { reason: 'hacked' },
    { sort: 'tokenHash:asc' },
    { sort: 'loginTime' },
    { search: 'x'.repeat(101) },
    { search: ['a'] },
    { page: '1', unknown: 'field' },
    { page: '1', filters: { token: { $null: false } } },
  ];
  for (const query of rejected) {
    const result = parseQuery(listQuerySchema, { page: '1', ...query });
    assert.equal(result.ok, false, JSON.stringify(query));
    assert.ok(result.errors.every((error) => !JSON.stringify(error).includes('xxxxxxxx')));
  }
});

test('list query: pages past the offset window are refused (deep OFFSET DoS)', () => {
  const lastAllowed = Math.floor((MAX_LIST_OFFSET - 1) / 100) + 1;
  assert.equal(
    parseQuery(listQuerySchema, { page: String(lastAllowed), pageSize: '100' }).ok,
    true
  );
  const tooDeep = parseQuery(listQuerySchema, {
    page: String(lastAllowed + 1),
    pageSize: '100',
  });
  assert.equal(tooDeep.ok, false);
  assert.match(tooDeep.errors[0].message, /Narrow the filter or use the export/);
});

test('paginated mode starts only with page or pageSize; other endpoints accept no stray params', () => {
  assert.equal(isPaginatedListQuery({}), false);
  assert.equal(isPaginatedListQuery({ status: 'active' }), false);
  assert.equal(isPaginatedListQuery({ page: '1' }), true);
  assert.equal(isPaginatedListQuery({ pageSize: '25' }), true);
  assert.equal(parseQuery(statsQuerySchema, {}).ok, true);
  assert.equal(parseQuery(statsQuerySchema, { debug: '1' }).ok, false);
  assert.equal(parseQuery(exportQuerySchema, { limit: '1001' }).ok, false);
  assert.equal(parseQuery(exportQuerySchema, { limit: '1000' }).ok, true);
});

test('status filters mirror the enhancer: active and idle split on the inactivity cutoff', () => {
  assert.deepEqual(buildSessionWhere({}, { cutoff }), {});
  assert.deepEqual(buildSessionWhere({ status: 'open' }, { cutoff }), {
    $and: [{ isActive: true }],
  });
  assert.deepEqual(buildSessionWhere({ status: 'active' }, { cutoff }), {
    $and: [
      { isActive: true },
      {
        $or: [
          { lastActive: { $gt: cutoff } },
          { $and: [{ lastActive: { $null: true } }, { loginTime: { $gt: cutoff } }] },
        ],
      },
    ],
  });
  assert.deepEqual(buildSessionWhere({ status: 'idle' }, { cutoff }).$and[1], {
    $or: [
      { lastActive: { $lte: cutoff } },
      { $and: [{ lastActive: { $null: true } }, { loginTime: { $lte: cutoff } }] },
    ],
  });
  assert.deepEqual(buildSessionWhere({ status: 'ended', reason: 'logout' }, { cutoff }), {
    $and: [{ isActive: false }, { terminationReason: 'logout' }],
  });
  assert.deepEqual(buildSessionWhere({ status: 'ended', reason: 'unrecorded' }, { cutoff }), {
    $and: [
      { isActive: false },
      {
        $or: [
          { terminationReason: { $null: true } },
          { terminationReason: { $notIn: ['logout', 'idle', 'expired', 'manual', 'blocked'] } },
        ],
      },
    ],
  });
  // A reason without the ended status is ignored.
  assert.deepEqual(buildSessionWhere({ status: 'open', reason: 'logout' }, { cutoff }), {
    $and: [{ isActive: true }],
  });
});

test('search uses bound $containsi on whitelisted fields only (no raw SQL, wildcards escaped by Strapi)', () => {
  const where = buildSessionWhere({ search: "50%_' OR 1=1 --" }, { cutoff });
  const fields = where.$and[0].$or.map((condition) => JSON.stringify(condition));
  assert.deepEqual(fields, [
    `{"user":{"email":{"$containsi":"50%_' OR 1=1 --"}}}`,
    `{"user":{"username":{"$containsi":"50%_' OR 1=1 --"}}}`,
    `{"ipAddress":{"$containsi":"50%_' OR 1=1 --"}}`,
    `{"browserName":{"$containsi":"50%_' OR 1=1 --"}}`,
    `{"osName":{"$containsi":"50%_' OR 1=1 --"}}`,
    `{"deviceType":{"$containsi":"50%_' OR 1=1 --"}}`,
  ]);
  assert.doesNotMatch(JSON.stringify(where), /token|refresh/i);
});

test('export cursor round-trips and rejects tampering', () => {
  const cursor = encodeExportCursor({ loginTime: '2026-11-10T09:00:00.000Z', id: 42 });
  assert.deepEqual(decodeExportCursor(cursor), {
    loginTime: new Date('2026-11-10T09:00:00.000Z'),
    id: 42,
  });
  assert.equal(decodeExportCursor(undefined), null);
  for (const bad of [
    'not base64!',
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('["x",1]').toString('base64url'),
    Buffer.from('["2026-11-10T09:00:00.000Z",-1]').toString('base64url'),
    Buffer.from('["2026-11-10T09:00:00.000Z",1.5]').toString('base64url'),
    Buffer.from('{"__proto__":{"admin":true}}').toString('base64url'),
  ]) {
    assert.equal(decodeExportCursor(bad), false, bad);
  }
});

test('listSessionPage reads one page with an exact COUNT, no token columns and enriches only that page', async () => {
  const rows = [
    {
      id: 7,
      documentId: 'doc-7',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      loginTime: new Date(Date.now() - 60_000),
      lastActive: new Date(Date.now() - 30_000),
      isActive: true,
      user: { documentId: 'user-1', email: 'user@example.test', username: 'user' },
    },
  ];
  const { strapi, calls } = createStrapi({ rows, total: 12_345 });
  const page = await listSessionPage(
    strapi,
    { page: 3, pageSize: 25, status: 'all', reason: 'all', search: '', sort: 'lastActive:asc' },
    { inactivityTimeout: 15 * 60 * 1000 }
  );

  assert.deepEqual(page.pagination, { page: 3, pageSize: 25, total: 12_345, pageCount: 494 });
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.count.length, 1);
  const [args] = calls.findMany;
  assert.equal(args.offset, 50);
  assert.equal(args.limit, 25);
  assert.deepEqual(args.orderBy, [{ lastActive: 'asc' }, { id: 'asc' }]);
  assert.ok(!args.select.some((field) => /token/i.test(field)), 'tokens are never selected');
  assert.deepEqual(args.populate, { user: { select: ['documentId', 'email', 'username'] } });
  assert.equal(page.rows[0].id, 'doc-7');
  assert.equal(page.rows[0].isTrulyActive, true);
  assert.equal(page.rows[0].browserName.startsWith('Chrome'), true);
});

test('refresh mode: one query on Strapi sessions reconciles the page, ended native sessions show as ended', async () => {
  const rows = [
    { id: 1, documentId: 'a', isActive: true, nativeSessionId: 'n-live', loginTime: new Date() },
    { id: 2, documentId: 'b', isActive: true, nativeSessionId: 'n-gone', loginTime: new Date() },
    { id: 3, documentId: 'c', isActive: false, nativeSessionId: 'n-old', loginTime: new Date() },
  ];
  const { strapi, calls } = createStrapi({
    rows,
    nativeTable: true,
    nativeActive: ['n-live'],
    jwtManagement: 'refresh',
  });
  const page = await listSessionPage(
    strapi,
    { page: 1, pageSize: 25, status: 'all', reason: 'all', search: '', sort: 'loginTime:desc' },
    { inactivityTimeout: 15 * 60 * 1000 }
  );
  assert.equal(calls.native.length, 1, 'one batched lookup, no per-user scan');
  assert.deepEqual(calls.native[0].where.sessionId, { $in: ['n-live', 'n-gone'] });
  assert.equal(calls.native[0].where.origin, 'users-permissions');
  assert.equal(calls.native[0].where.status, 'active');
  assert.deepEqual(
    page.rows.map((row) => row.isActive),
    [true, false, false]
  );
});

test('stats are counts only, computed with COUNT queries and cached per process for a few seconds', async () => {
  clearSessionStatsCache();
  const { strapi, calls } = createStrapi({ total: 10 });
  const first = await getSessionStats(strapi, { inactivityTimeout: 900_000 });
  assert.deepEqual(Object.keys(first).sort(), [
    'active',
    'ended',
    'idle',
    'loggedOut',
    'nativeOnly',
    'nativeOnlyAfterTracking',
    'open',
    'otherReasons',
    'timedOut',
    'total',
    'usersOnline',
  ]);
  const { nativeOnlyAfterTracking, ...counts } = first;
  assert.ok(Object.values(counts).every((value) => Number.isInteger(value)));
  assert.equal(nativeOnlyAfterTracking, null, 'unknown without native refresh mode');
  assert.equal(first.usersOnline, 3);
  assert.equal(calls.findMany.length, 0, 'no session rows are read');
  const countsAfterFirst = calls.count.length;

  await getSessionStats(strapi, { inactivityTimeout: 900_000 });
  assert.equal(calls.count.length, countsAfterFirst, 'second call is served from the cache');

  clearSessionStatsCache();
  await getSessionStats(strapi, { inactivityTimeout: 900_000 });
  assert.equal(calls.count.length, countsAfterFirst * 2, 'clearing the cache recounts');
});

test('export batches use a keyset cursor (no OFFSET) and stop when a batch is short', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: 100 - index,
    documentId: `d${index}`,
    isActive: false,
    loginTime: new Date(`2026-11-0${index + 1}T00:00:00.000Z`),
  }));
  const { strapi, calls } = createStrapi({ rows });
  const full = await exportSessionBatch(
    strapi,
    { limit: 3, status: 'ended', reason: 'all', search: '' },
    null,
    { inactivityTimeout: 900_000 }
  );
  assert.equal(calls.findMany[0].offset, undefined);
  assert.equal(calls.findMany[0].limit, 3);
  assert.ok(full.nextCursor, 'a full batch returns a cursor');
  assert.deepEqual(decodeExportCursor(full.nextCursor), {
    loginTime: new Date('2026-11-03T00:00:00.000Z'),
    id: 98,
  });

  await exportSessionBatch(
    strapi,
    { limit: 3, status: 'ended', reason: 'all', search: '' },
    decodeExportCursor(full.nextCursor),
    { inactivityTimeout: 900_000 }
  );
  const keyset = calls.findMany[1].where.$and.at(-1);
  assert.deepEqual(keyset, {
    $or: [
      { loginTime: { $lt: new Date('2026-11-03T00:00:00.000Z') } },
      { $and: [{ loginTime: new Date('2026-11-03T00:00:00.000Z') }, { id: { $lt: 98 } }] },
    ],
  });

  const short = await exportSessionBatch(
    strapi,
    { limit: 10, status: 'all', reason: 'all', search: '' },
    null,
    { inactivityTimeout: 900_000 }
  );
  assert.equal(short.nextCursor, null);
});

test('analytics aggregate every session; SQLite averages the session length in keyset batches', async () => {
  clearSessionStatsCache();
  const { getSessionAnalytics } = require('../server/src/utils/session-list');
  const now = Date.now();
  const timeRows = [
    {
      id: 1,
      isActive: false,
      loginTime: new Date(now - 60 * 60_000),
      logoutTime: new Date(now - 30 * 60_000),
    },
    {
      id: 2,
      isActive: true,
      loginTime: new Date(now - 20 * 60_000),
      lastActive: new Date(now - 10 * 60_000),
    },
    { id: 3, isActive: false, loginTime: new Date(now - 5 * 60_000) },
  ];
  const findManyCalls = [];
  const grouped = {
    device_type: [
      { value: 'desktop', count: '2' },
      { value: null, count: '1' },
    ],
    browser_name: [{ value: 'Chrome 120', count: '3' }],
  };
  const knex = (table) => {
    const builder = {
      _column: null,
      select(spec) {
        builder._column = spec.value;
        return builder;
      },
      count: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: async () => grouped[builder._column] || [],
      countDistinct: () => builder,
      first: async () => ({ count: table === 'magic_sessions_user_lnk' ? '2' : '0' }),
      join: () => builder,
      where: () => builder,
      andWhere: () => builder,
    };
    return builder;
  };
  const strapi = {
    config: { get: (_key, fallback) => fallback },
    contentTypes: {},
    db: {
      dialect: { client: 'sqlite' },
      connection: knex,
      metadata: {
        get: () => ({
          tableName: 'magic_sessions',
          attributes: {
            deviceType: { columnName: 'device_type' },
            browserName: { columnName: 'browser_name' },
            user: {
              joinTable: {
                name: 'magic_sessions_user_lnk',
                joinColumn: { name: 'session_id' },
                inverseJoinColumn: { name: 'user_id' },
              },
            },
          },
        }),
      },
      query: () => ({
        count: async () => 3,
        findMany: async (args) => {
          findManyCalls.push(args);
          return timeRows.filter((row) => row.id > args.where.id.$gt);
        },
      }),
    },
  };

  const analytics = await getSessionAnalytics(strapi, { inactivityTimeout: 15 * 60_000 });
  assert.equal(analytics.totalSessions, 3);
  assert.equal(analytics.uniqueUsers, 2);
  assert.deepEqual(analytics.devices, [
    { value: 'desktop', count: 2 },
    { value: null, count: 1 },
  ]);
  // (30 + 10) / 2 rows with an end; the third row has neither logout nor lastActive.
  assert.equal(analytics.avgSessionDuration, 20);
  assert.deepEqual(findManyCalls[0].select, [
    'id',
    'loginTime',
    'lastActive',
    'logoutTime',
    'isActive',
  ]);
  assert.deepEqual(findManyCalls[0].orderBy, [{ id: 'asc' }]);
  assert.equal(findManyCalls[0].limit, 5000);
});
