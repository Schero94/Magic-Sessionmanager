/**
 * "View as admin" preview model (4.23.1): turns the server preview DTO into
 * what the dialog shows — a summary, one Content Manager row per content
 * type with the state of each action, and the plugin and settings
 * permissions grouped like Strapi's role editor. Pure functions, so
 * `node --test` covers them without a bundler.
 */

/** Content Manager actions in the column order of Strapi's role editor. */
export const PREVIEW_ACTIONS = Object.freeze(['create', 'read', 'update', 'delete', 'publish']);

/** Known plugin names with the label Strapi shows; others are prettified. */
const PLUGIN_LABELS = Object.freeze({
  upload: 'Media Library',
  'content-manager': 'Content Manager',
  'content-type-builder': 'Content-Type Builder',
  'content-releases': 'Releases',
  'users-permissions': 'Users & Permissions',
  i18n: 'Internationalization',
  email: 'Email',
  'magic-sessionmanager': 'Session Manager',
  'review-workflows': 'Review Workflows',
});

/**
 * @param {string} value Raw label.
 * @returns {string} First letter upper case, hyphens and underscores as spaces.
 */
function prettify(value) {
  const text = String(value || '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * State of one action on one content type.
 *
 * @param {object|undefined} action Action entry from the DTO.
 * @param {string} name Action name.
 * @param {boolean} draftAndPublish Whether the content type has drafts.
 * @returns {'full'|'limited'|'none'|'n/a'} `n/a` for Publish without Draft & Publish.
 */
export function actionState(action, name, draftAndPublish) {
  if (name === 'publish' && !draftAndPublish && !action) return 'n/a';
  if (!action) return 'none';
  const limited =
    action.fields !== null && action.fields !== undefined
      ? true
      : (Array.isArray(action.locales) && action.locales.length > 0) ||
        (Array.isArray(action.conditions) && action.conditions.length > 0);
  return limited ? 'limited' : 'full';
}

/**
 * One row per content type, accessible ones and the ones the admin cannot
 * open, sorted by name.
 *
 * @param {object|null|undefined} preview Preview DTO.
 * @returns {Array<{uid: string, name: string, kind: string, draftAndPublish: boolean,
 *   cells: Record<string, 'full'|'limited'|'none'|'n/a'>, details: object[], hasAccess: boolean}>}
 */
export function buildMatrixRows(preview) {
  const rows = [];
  for (const type of preview?.contentTypes || []) {
    // Several roles can grant the same action with different limits; Strapi
    // allows the action when any of them applies, so the widest one wins.
    const byAction = new Map();
    for (const action of type.actions || []) {
      const list = byAction.get(action.action) || [];
      list.push(action);
      byAction.set(action.action, list);
    }
    const draftAndPublish = type.draftAndPublish === true || byAction.has('publish');
    const cells = {};
    for (const name of PREVIEW_ACTIONS) {
      const states = (byAction.get(name) || []).map((action) =>
        actionState(action, name, draftAndPublish)
      );
      cells[name] = states.includes('full')
        ? 'full'
        : states.includes('limited')
          ? 'limited'
          : actionState(undefined, name, draftAndPublish);
    }
    const details = (type.actions || []).filter(
      (action) =>
        (action.fields !== null && action.fields !== undefined) ||
        (Array.isArray(action.locales) && action.locales.length > 0) ||
        (Array.isArray(action.conditions) && action.conditions.length > 0)
    );
    rows.push({
      uid: type.uid,
      name: type.name,
      kind: type.kind,
      draftAndPublish,
      cells,
      details,
      hasAccess: true,
    });
  }
  for (const type of preview?.unavailableContentTypes || []) {
    const draftAndPublish = type.draftAndPublish === true;
    const cells = {};
    for (const name of PREVIEW_ACTIONS) cells[name] = actionState(undefined, name, draftAndPublish);
    rows.push({
      uid: type.uid,
      name: type.name,
      kind: type.kind,
      draftAndPublish,
      cells,
      details: [],
      hasAccess: false,
    });
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Rows whose name or uid contains the query (case-insensitive).
 *
 * @param {ReturnType<typeof buildMatrixRows>} rows Matrix rows.
 * @param {string} query Search text.
 * @returns {ReturnType<typeof buildMatrixRows>} Matching rows.
 */
export function filterMatrixRows(rows, query) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      String(row.name).toLowerCase().includes(needle) ||
      String(row.uid).toLowerCase().includes(needle)
  );
}

/**
 * Numbers for the summary line at the top of the preview.
 *
 * @param {object|null|undefined} preview Preview DTO.
 * @returns {{total: number, read: number, edit: number, publish: number, settings: number,
 *   plugins: number, hasRoles: boolean}} Counts.
 */
export function summarizePreview(preview) {
  const rows = buildMatrixRows(preview);
  const has = (name) => rows.filter((row) => ['full', 'limited'].includes(row.cells[name])).length;
  const other = preview?.otherPermissions || [];
  return {
    total: rows.length,
    read: has('read'),
    edit: has('update'),
    publish: has('publish'),
    settings: other.filter((permission) => permission.section === 'settings').length,
    plugins: other.filter((permission) => permission.section !== 'settings').length,
    hasRoles: (preview?.admin?.roles || []).length > 0,
  };
}

/**
 * Plugin and settings permissions grouped like Strapi's role editor:
 * settings by category, plugins by plugin. Labels are Strapi's display names.
 *
 * @param {Array<{action: string, name: string, section: string, scope?: string|null,
 *   category?: string|null, subCategory?: string|null}>|undefined} permissions Other permissions.
 * @returns {Array<{key: string, section: 'settings'|'plugins'|'other', label: string,
 *   items: Array<{action: string, name: string, subCategory: string|null}>}>} Groups.
 */
export function groupOtherPermissions(permissions) {
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const permission of permissions || []) {
    const section =
      permission.section === 'settings'
        ? 'settings'
        : permission.section === 'plugins'
          ? 'plugins'
          : 'other';
    const raw =
      section === 'settings'
        ? permission.category || permission.scope || 'general'
        : permission.scope || permission.category || 'general';
    const label = section === 'plugins' && PLUGIN_LABELS[raw] ? PLUGIN_LABELS[raw] : prettify(raw);
    const key = `${section}:${String(raw).toLowerCase()}`;
    const group = groups.get(key) || { key, section, label, items: [] };
    // Two roles can grant the same action; list it once.
    if (group.items.some((item) => item.action === permission.action)) {
      groups.set(key, group);
      continue;
    }
    group.items.push({
      action: permission.action,
      name: permission.name,
      subCategory:
        permission.subCategory && permission.subCategory !== 'general'
          ? prettify(permission.subCategory)
          : null,
    });
    groups.set(key, group);
  }
  const order = { plugins: 0, settings: 1, other: 2 };
  return [...groups.values()].sort(
    (a, b) => order[a.section] - order[b.section] || a.label.localeCompare(b.label)
  );
}
