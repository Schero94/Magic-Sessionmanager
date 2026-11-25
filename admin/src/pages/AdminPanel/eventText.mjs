import { groupChangedSettings } from './adminActivityModel.mjs';

/**
 * Text of the admin event lists: who an event belongs to, address, device,
 * the second line of the event cell, changed settings and content types.
 * Plain functions of a translator `t(id, defaultMessage, values)`, so the
 * tables, the stacked rows and the details dialog say the same thing and
 * `node --test` covers them without a browser.
 */

/**
 * One group of changed settings: "Login protection: Lock for, Trusted addresses".
 * Unknown keys keep their raw name and have no tab prefix.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {{label: {messageId: string, defaultMessage: string}|null,
 *   fields: Array<{key: string, label: {messageId: string, defaultMessage: string}|null}>}} group
 *   Group from groupChangedSettings.
 * @returns {string} Text.
 */
const settingsGroupText = (t, group) => {
  const fields = group.fields
    .map((field) =>
      field.label ? t(field.label.messageId, field.label.defaultMessage) : field.key
    )
    .join(', ');
  return group.label
    ? t('adminPanel.activity.settingsGroup', '{tab}: {fields}', {
        tab: t(group.label.messageId, group.label.defaultMessage),
        fields,
      })
    : fields;
};

/**
 * Changed settings of a `settings.updated` event in the Settings page's own
 * words, grouped by tab: "Login protection: Lock an IP address after, Lock for ·
 * Admin activity: Record admin sign-ins". With `limit`, at most that many
 * settings are named and the rest is counted ("… and 2 more").
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {unknown} keys Changed key names.
 * @param {{limit?: number}} [options] Most settings to name.
 * @returns {string} Text, or '' without keys.
 */
export const changedSettingsText = (t, keys, { limit } = {}) => {
  const groups = groupChangedSettings(keys);
  const total = groups.reduce((sum, group) => sum + group.fields.length, 0);
  if (!total) return '';
  let budget = limit && limit > 0 ? limit : total;
  const shown = [];
  for (const group of groups) {
    if (budget <= 0) break;
    shown.push({ ...group, fields: group.fields.slice(0, budget) });
    budget -= Math.min(budget, group.fields.length);
  }
  const named = shown.reduce((sum, group) => sum + group.fields.length, 0);
  const text = shown.map((group) => settingsGroupText(t, group)).join(' · ');
  return named < total
    ? t('adminPanel.activity.settingsMore', '{names} and {count, number} more', {
        names: text,
        count: total - named,
      })
    : text;
};

/**
 * Changed settings as one line per tab, for the details dialog.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {unknown} keys Changed key names.
 * @returns {string[]} Lines.
 */
export const changedSettingsLines = (t, keys) =>
  groupChangedSettings(keys).map((group) => settingsGroupText(t, group));

/**
 * Text when an event belongs to no admin account: "System" for retention
 * runs, otherwise "Unknown account" (a failed sign-in with an email that is
 * not an admin, or a deleted admin).
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {object} [row] Event row.
 * @returns {string} Text.
 */
export const noAdminText = (t, row) =>
  row?.event === 'security-log.retention.purged'
    ? t('adminPanel.activity.system', 'System')
    : t('adminPanel.activity.unknownAccount', 'Unknown account');

/**
 * Translated "Chrome 131 on macOS", one of them, or ''.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {{browser?: string|null, os?: string|null}} row Event row.
 * @returns {string} Device text.
 */
export const deviceText = (t, row) => {
  if (row.browser && row.os) {
    return t('adminPanel.activity.browserOnOs', '{browser} on {os}', {
      browser: row.browser,
      os: row.os,
    });
  }
  return row.browser || row.os || '';
};

/**
 * IP address with the "(anonymised)" note, or ''.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {{ipAddress?: string|null, ipAnonymized?: boolean}} row Event row.
 * @returns {string} Address text.
 */
export const ipText = (t, row) => {
  if (!row.ipAddress) return '';
  return row.ipAnonymized
    ? t('adminPanel.activity.ipAnonymized', '{ip} (anonymised)', { ip: row.ipAddress })
    : row.ipAddress;
};

/**
 * Second line of the event cell: the reason or scope, the number of
 * counted attempts and, when "Done by" has no column, who did it.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {object} row Sign-in row.
 * @param {object} presentation Event presentation.
 * @param {boolean} withActor Append "by {name}".
 * @returns {string} Text, or ''.
 */
export const eventDetailText = (t, row, presentation, withActor) => {
  const parts = [];
  if (presentation.detail) {
    parts.push(t(presentation.detail.messageId, presentation.detail.defaultMessage));
  }
  if (Number.isInteger(row.attempts) && row.attempts > 1) {
    parts.push(
      t(
        'adminPanel.activity.attempts',
        '{count, plural, one {# attempt} other {# attempts}} within 5 minutes',
        { count: row.attempts }
      )
    );
  }
  const changed = changedSettingsText(t, row.change?.keys, { limit: 3 });
  if (changed) parts.push(changed);
  if (Number.isInteger(row.purge?.count)) {
    parts.push(
      Number.isInteger(row.purge?.retentionDays)
        ? t(
            'adminPanel.activity.purgedDetail',
            '{count, plural, one {# event} other {# events}}, older than {days, plural, one {# day} other {# days}}',
            { count: row.purge.count, days: row.purge.retentionDays }
          )
        : t('adminPanel.activity.purgedCount', '{count, plural, one {# event} other {# events}}', {
            count: row.purge.count,
          })
    );
  }
  if (withActor && row.actor?.name) {
    parts.push(t('adminPanel.activity.byAdmin', 'by {name}', { name: row.actor.name }));
  }
  return parts.join(' · ');
};

/**
 * "Article · de" (content type and locale), or ''.
 *
 * @param {object} row Activity row.
 * @returns {string} Text.
 */
export const contentTypeText = (row) =>
  [row.contentType?.name, row.entry?.locale].filter(Boolean).join(' · ');
