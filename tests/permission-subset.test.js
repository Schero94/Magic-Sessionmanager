'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPermissionCovered,
  toEnforced,
  uncoveredPermissions,
} = require('../server/src/utils/permission-subset');

const read = (extra = {}) => ({
  action: 'plugin::content-manager.explorer.read',
  subject: 'api::article.article',
  properties: {},
  conditions: [],
  ...extra,
});

test('same action and subject are required', () => {
  assert.equal(isPermissionCovered(read(), [read()]), true);
  assert.equal(isPermissionCovered(read(), [read({ subject: 'api::page.page' })]), false);
  assert.equal(
    isPermissionCovered(read(), [{ ...read(), action: 'plugin::content-manager.explorer.update' }]),
    false
  );
  assert.equal(
    isPermissionCovered({ action: 'plugin::upload.read', subject: null }, [
      { action: 'plugin::upload.read' },
    ]),
    true
  );
});

test('fields: unrestricted covers all; a parent covers nested fields; more fields escalate', () => {
  const fields = (list) => read({ properties: { fields: list } });
  assert.equal(isPermissionCovered(fields(['title']), [read()]), true);
  assert.equal(isPermissionCovered(read(), [fields(['title'])]), false);
  assert.equal(isPermissionCovered(fields(['title']), [fields(['title', 'slug'])]), true);
  assert.equal(isPermissionCovered(fields(['title', 'body']), [fields(['title'])]), false);
  assert.equal(isPermissionCovered(fields(['seo.title']), [fields(['seo'])]), true);
  assert.equal(isPermissionCovered(fields(['seo']), [fields(['seo.title'])]), false);
  // A permission with no fields grants nothing, so it never escalates.
  assert.equal(isPermissionCovered(fields([]), []), true);
});

test('fields can be covered by several held permissions together', () => {
  const held = [
    read({ properties: { fields: ['title'] } }),
    read({ properties: { fields: ['body'] } }),
  ];
  assert.equal(
    isPermissionCovered(read({ properties: { fields: ['title', 'body'] } }), held),
    true
  );
});

test('locales: unrestricted covers all; a list must contain every requested locale', () => {
  const locales = (list) => read({ properties: { locales: list } });
  assert.equal(isPermissionCovered(locales(['en']), [locales(null)]), true);
  assert.equal(isPermissionCovered(locales(['en', 'de']), [locales(['en'])]), false);
  assert.equal(isPermissionCovered(locales(null), [locales(['en'])]), false);
});

test('conditions are OR-ed: fewer conditions are broader', () => {
  const creator = read({ conditions: ['admin::is-creator'] });
  const role = read({ conditions: ['admin::has-same-role-as-creator'] });
  assert.equal(isPermissionCovered(creator, [read()]), true, 'unconditional covers conditional');
  assert.equal(isPermissionCovered(read(), [creator]), false, 'conditional does not cover all');
  assert.equal(isPermissionCovered(creator, [creator]), true);
  assert.equal(isPermissionCovered(creator, [role]), false);
  assert.equal(
    isPermissionCovered(
      read({ conditions: ['admin::is-creator', 'admin::has-same-role-as-creator'] }),
      [creator]
    ),
    false,
    'two OR-ed conditions are broader than one'
  );
});

test('action parameters must match', () => {
  const withParams = (actionParameters) => read({ actionParameters });
  assert.equal(
    isPermissionCovered(withParams({ a: ['x', 'y'] }), [withParams({ a: ['y', 'x'] })]),
    true
  );
  assert.equal(isPermissionCovered(withParams({ a: ['x'] }), [read()]), false);
  assert.equal(isPermissionCovered(read(), [withParams({ a: ['x'] })]), false);
});

test('uncoveredPermissions lists exactly what the actor lacks', () => {
  const update = { ...read(), action: 'plugin::content-manager.explorer.update' };
  assert.deepEqual(uncoveredPermissions([read(), update], [read()]), [update]);
  assert.deepEqual(uncoveredPermissions([read()], [read(), update]), []);
});

test('toEnforced: unregistered conditions and missing locales as the engine enforces them', () => {
  const context = {
    isConditionRegistered: (id) => id === 'admin::is-creator',
    appliesLocales: (permission) => permission.subject === 'api::article.article',
  };
  const enforced = toEnforced(
    [
      read({ conditions: ['plugin::gone.condition'] }),
      read({ conditions: ['admin::is-creator', 'plugin::gone.condition'] }),
      read(),
      { action: 'plugin::upload.read', subject: null, properties: { locales: ['en'] } },
    ],
    context
  );
  assert.equal(enforced.length, 3, 'a permission with only unknown conditions grants nothing');
  assert.deepEqual(enforced[0].conditions, ['admin::is-creator']);
  assert.deepEqual(enforced[1].properties.locales, [], 'missing locales mean no locale');
  assert.equal(
    'locales' in enforced[2].properties,
    false,
    'locales removed where they do not apply'
  );
  // An actor whose read has no locale cannot cover a target with a locale.
  assert.equal(
    isPermissionCovered(read({ properties: { locales: ['en'] } }), [enforced[1]]),
    false
  );
});

test('parity with Strapi 5.63 isPermissionWithinCeiling on permissions without action parameters', (t) => {
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(
    __dirname,
    '..',
    'node_modules/@strapi/admin/dist/server/server/src/domain/permission/ceiling.js'
  );
  if (!fs.existsSync(file)) {
    // Strapi before 5.63 has no ceiling module; the rules above still apply.
    t.diagnostic('ceiling.js not installed; parity not checked on this Strapi version');
    return;
  }
  const ceiling = require(file).default;
  const subjects = ['api::article.article', null];
  const fieldSets = [undefined, [], ['title'], ['title', 'body'], ['seo'], ['seo.title']];
  const localeSets = [undefined, null, ['en'], ['en', 'de']];
  const conditionSets = [
    [],
    ['admin::is-creator'],
    ['admin::is-creator', 'admin::has-same-role-as-creator'],
  ];
  const make = (subject, fields, locales, conditions) => {
    const properties = {};
    if (fields !== undefined) properties.fields = fields;
    if (locales !== undefined) properties.locales = locales;
    return { action: 'plugin::content-manager.explorer.read', subject, properties, conditions };
  };
  const all = [];
  for (const subject of subjects)
    for (const fields of fieldSets)
      for (const locales of localeSets)
        for (const conditions of conditionSets)
          all.push(make(subject, fields, locales, conditions));
  let compared = 0;
  for (const requested of all) {
    for (const held of all) {
      const ours = isPermissionCovered(requested, [held]);
      const strapis = ceiling.isPermissionWithinCeiling(requested, [held]);
      assert.equal(ours, strapis, `${JSON.stringify(requested)} within ${JSON.stringify(held)}`);
      compared += 1;
    }
  }
  assert.ok(compared > 10000);
});
