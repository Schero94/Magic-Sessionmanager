import { Fragment, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Accordion,
  Badge,
  Box,
  Flex,
  IconButton,
  Link,
  LinkButton,
  Searchbar,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Check, ChevronDown, ChevronUp, Cross } from '@strapi/icons';
import styled from 'styled-components';
import Alert from '../PersistentAlert';
import ReadableText from '../ReadableText';
import {
  PREVIEW_ACTIONS,
  buildMatrixRows,
  filterMatrixRows,
  groupOtherPermissions,
  summarizePreview,
} from '../../utils/adminPreviewModel.mjs';
import { shouldIsolateActionKey } from '../../pages/Dashboard/dashboardModel.mjs';
import { useBreakpoint } from '../../utils/useBreakpoint';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';

/**
 * A role badge that is also a link: the link box is at least 32 px tall so
 * it is a comfortable touch target (WCAG 2.5.8, plugin mobile rule).
 */
const RoleLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: ${({ theme }) => theme.spaces[7]};
`;

/** Show the search box from this many content types on. */
const SEARCH_FROM = 6;

/** Content Manager actions with their column label. */
const ACTION_LABELS = Object.freeze({
  create: ['impersonation.preview.action.create', 'Create'],
  read: ['impersonation.preview.action.read', 'Read'],
  update: ['impersonation.preview.action.update', 'Update'],
  delete: ['impersonation.preview.action.delete', 'Delete'],
  publish: ['impersonation.preview.action.publish', 'Publish'],
});

/** Strapi's built-in conditions with a translated label (others use Strapi's display name). */
const CONDITION_LABELS = Object.freeze({
  'admin::is-creator': ['impersonation.preview.condition.creator', 'entries they created'],
  'admin::has-same-role-as-creator': [
    'impersonation.preview.condition.sameRole',
    'entries created by someone with the same role',
  ],
});

/** Keeps Enter and Space on the row's button (the DS grid cell swallows them). */
const keepActionKeys = (event) => {
  if (shouldIsolateActionKey(event.key, true)) event.stopPropagation();
};

/**
 * One matrix cell: a check (allowed), a check with "Limited" (only some
 * fields, locales or entries), a cross (not allowed) or a dash (Publish on a
 * content type without Draft & Publish). Colour never carries the meaning
 * alone: every state has text for screen readers, "Limited" is visible.
 *
 * @param {{state: 'full'|'limited'|'none'|'n/a'}} props Cell state.
 * @returns {import('react').ReactElement} Cell content.
 */
const ActionCell = ({ state }) => {
  const { t } = useSettingsTranslate();
  if (state === 'n/a') {
    return (
      <Typography variant="omega" textColor="neutral600">
        <span aria-hidden="true">—</span>
        <VisuallyHidden>{t('impersonation.preview.cell.na', 'Not applicable')}</VisuallyHidden>
      </Typography>
    );
  }
  if (state === 'none') {
    return (
      <Flex alignItems="center" data-preview-cell="none">
        <Cross aria-hidden focusable={false} fill="neutral500" width="1.2rem" height="1.2rem" />
        <VisuallyHidden>{t('impersonation.preview.cell.none', 'Not allowed')}</VisuallyHidden>
      </Flex>
    );
  }
  return (
    <Flex alignItems="center" gap={1} data-preview-cell={state}>
      <Check aria-hidden focusable={false} fill="success600" width="1.4rem" height="1.4rem" />
      {state === 'limited' ? (
        <Typography variant="pi" textColor="neutral700">
          {t('impersonation.preview.cell.limited', 'Limited')}
        </Typography>
      ) : (
        <VisuallyHidden>{t('impersonation.preview.cell.full', 'Allowed')}</VisuallyHidden>
      )}
    </Flex>
  );
};

/**
 * What limits a content type's actions: field lists, locales and conditions.
 *
 * @param {{row: object, conditionNames: Record<string, string>}} props Matrix row.
 * @returns {import('react').ReactElement} Detail list.
 */
const RowDetails = ({ row, conditionNames }) => {
  const { t } = useSettingsTranslate();
  return (
    <Flex
      tag="ul"
      direction="column"
      alignItems="stretch"
      gap={2}
      margin={0}
      padding={0}
      style={{ listStyle: 'none' }}
      data-preview-details={row.uid}
    >
      {row.details.map((action) => {
        const label = ACTION_LABELS[action.action]
          ? t(...ACTION_LABELS[action.action])
          : action.action;
        const parts = [];
        if (action.fields !== null && action.fields !== undefined) {
          parts.push(
            action.fieldNames && action.fieldNames.length
              ? t('impersonation.preview.detail.fieldList', 'only the fields {fields}', {
                  fields: action.fieldNames.join(', '),
                })
              : t('impersonation.preview.detail.noFields', 'no fields')
          );
        }
        if (Array.isArray(action.locales) && action.locales.length) {
          parts.push(
            t('impersonation.preview.detail.locales', 'only the locales {locales}', {
              locales: action.locales.join(', '),
            })
          );
        }
        if (Array.isArray(action.conditions) && action.conditions.length) {
          parts.push(
            t('impersonation.preview.conditions.only', 'only {conditions}', {
              conditions: action.conditions
                .map((id) =>
                  CONDITION_LABELS[id] ? t(...CONDITION_LABELS[id]) : conditionNames?.[id] || id
                )
                .join(', '),
            })
          );
        }
        return (
          <Typography
            key={action.action}
            tag="li"
            variant="pi"
            textColor="neutral800"
            style={{ overflowWrap: 'anywhere' }}
          >
            <Typography variant="pi" fontWeight="semiBold" textColor="neutral800">
              {label}
            </Typography>
            {': '}
            {parts.join('; ')}
          </Typography>
        );
      })}
    </Flex>
  );
};

/**
 * Content Manager matrix like Strapi's role editor: one row per content
 * type, a column per action. Rows with limits open a detail row. Narrow
 * screens get one compact card per content type with the same states.
 *
 * @param {{rows: object[], conditionNames: Record<string, string>}} props Filtered rows.
 * @returns {import('react').ReactElement} Matrix.
 */
const ContentMatrix = ({ rows, conditionNames }) => {
  const { t } = useSettingsTranslate();
  const { isBelowMedium } = useBreakpoint();
  const [open, setOpen] = useState(() => new Set());
  const toggle = (uid) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  const toggleButton = (row) => {
    if (!row.details.length) return null;
    const expanded = open.has(row.uid);
    return (
      <IconButton
        variant="ghost"
        label={
          expanded
            ? t('impersonation.preview.detail.hide', 'Hide limits of {name}', { name: row.name })
            : t('impersonation.preview.detail.show', 'Show limits of {name}', { name: row.name })
        }
        aria-expanded={expanded}
        onClick={() => toggle(row.uid)}
      >
        {expanded ? <ChevronUp /> : <ChevronDown />}
      </IconButton>
    );
  };

  if (isBelowMedium) {
    return (
      <Flex
        tag="ul"
        direction="column"
        alignItems="stretch"
        gap={2}
        margin={0}
        padding={0}
        style={{ listStyle: 'none' }}
        data-preview-matrix="list"
      >
        {rows.map((row) => (
          <Box
            key={row.uid}
            tag="li"
            padding={3}
            hasRadius
            borderColor="neutral150"
            data-preview-type={row.uid}
          >
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Flex justifyContent="space-between" alignItems="center" gap={2}>
                <Typography
                  variant="omega"
                  fontWeight="semiBold"
                  textColor="neutral800"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {row.name}
                </Typography>
                {toggleButton(row)}
              </Flex>
              <Flex gap={3} wrap="wrap">
                {PREVIEW_ACTIONS.map((action) => (
                  <Flex key={action} gap={1} alignItems="center">
                    <Typography variant="pi" textColor="neutral600">
                      {t(...ACTION_LABELS[action])}
                    </Typography>
                    <ActionCell state={row.cells[action]} />
                  </Flex>
                ))}
              </Flex>
              {open.has(row.uid) ? <RowDetails row={row} conditionNames={conditionNames} /> : null}
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  }

  const columns = PREVIEW_ACTIONS.length + 2;
  return (
    <Table colCount={columns} rowCount={rows.length + 1} data-preview-matrix="table">
      <Thead>
        <Tr>
          <Th>
            <Typography variant="sigma" textColor="neutral600">
              {t('impersonation.preview.col.contentType', 'Content type')}
            </Typography>
          </Th>
          {PREVIEW_ACTIONS.map((action) => (
            <Th key={action}>
              <Typography variant="sigma" textColor="neutral600">
                {t(...ACTION_LABELS[action])}
              </Typography>
            </Th>
          ))}
          <Th>
            <VisuallyHidden>{t('impersonation.preview.col.limits', 'Limits')}</VisuallyHidden>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Fragment key={row.uid}>
            <Tr data-preview-type={row.uid}>
              <Td>
                <Typography
                  variant="omega"
                  fontWeight="semiBold"
                  textColor={row.hasAccess ? 'neutral800' : 'neutral600'}
                >
                  {row.name}
                </Typography>
              </Td>
              {PREVIEW_ACTIONS.map((action) => (
                <Td key={action}>
                  <ActionCell state={row.cells[action]} />
                </Td>
              ))}
              <Td>
                <Flex justifyContent="flex-end" onKeyDown={keepActionKeys}>
                  {toggleButton(row)}
                </Flex>
              </Td>
            </Tr>
            {open.has(row.uid) ? (
              <Tr>
                <Td colSpan={columns}>
                  <Box paddingTop={1} paddingBottom={2}>
                    <RowDetails row={row} conditionNames={conditionNames} />
                  </Box>
                </Td>
              </Tr>
            ) : null}
          </Fragment>
        ))}
      </Tbody>
    </Table>
  );
};

/**
 * The read-only answer to "what can this admin do, and why not X": summary,
 * roles with links, the Content Manager matrix and the grouped plugin and
 * settings permissions. Links end the preview first (`onLeave`).
 *
 * @param {{
 *   preview: object,
 *   adminId: number|string,
 *   canReadRoles: boolean,
 *   canReadUsers: boolean,
 *   onLeave: () => void,
 * }} props Preview DTO, what the viewer may open, and the end-on-leave callback.
 * @returns {import('react').ReactElement} Preview body.
 */
const AdminPreviewDetails = ({ preview, adminId, canReadRoles, canReadUsers, onLeave }) => {
  const { t } = useSettingsTranslate();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => buildMatrixRows(preview), [preview]);
  const visible = useMemo(() => filterMatrixRows(rows, query), [rows, query]);
  const groups = useMemo(
    () => groupOtherPermissions(preview?.otherPermissions),
    [preview?.otherPermissions]
  );
  const summary = useMemo(() => summarizePreview(preview), [preview]);
  const roles = preview?.admin?.roles || [];

  const summaryParts = summary.hasRoles
    ? [
        t(
          'impersonation.preview.summary.read',
          'Can open {read, number} of {total, plural, one {# content type} other {# content types}}',
          { read: summary.read, total: summary.total }
        ),
        t('impersonation.preview.summary.edit', 'can edit {count, number}', {
          count: summary.edit,
        }),
        t('impersonation.preview.summary.publish', 'can publish {count, number}', {
          count: summary.publish,
        }),
        summary.settings > 0
          ? t(
              'impersonation.preview.summary.settings',
              '{count, plural, one {# settings permission} other {# settings permissions}}',
              { count: summary.settings }
            )
          : t('impersonation.preview.summary.noSettings', 'no settings access'),
      ]
    : [];

  return (
    <Flex direction="column" alignItems="stretch" gap={6} data-preview-body="">
      {summary.hasRoles ? (
        <Typography
          variant="omega"
          fontWeight="semiBold"
          textColor="neutral800"
          tag="p"
          data-preview-summary=""
        >
          {summaryParts.join(' · ')}
        </Typography>
      ) : null}

      <Flex direction="column" alignItems="stretch" gap={2} data-preview-roles="">
        <Typography variant="delta" tag="h3" textColor="neutral800">
          {t('impersonation.preview.rolesTitle', 'Roles')}
        </Typography>
        {roles.length ? (
          <Flex gap={2} wrap="wrap">
            {roles.map((role) =>
              canReadRoles && role.id !== undefined ? (
                <RoleLink
                  key={role.id}
                  tag={RouterLink}
                  to={`/settings/roles/${role.id}`}
                  onClick={onLeave}
                  aria-label={t('impersonation.preview.role.open', 'Open the role {name}', {
                    name: role.name,
                  })}
                >
                  <Badge>{role.name}</Badge>
                </RoleLink>
              ) : (
                <Badge key={role.name}>{role.name}</Badge>
              )
            )}
          </Flex>
        ) : (
          <Alert
            variant="warning"
            title={t('impersonation.preview.noRole.title', 'No role')}
            closeLabel={t('common.close', 'Close')}
            action={
              canReadUsers ? (
                <LinkButton
                  tag={RouterLink}
                  to={`/settings/users/${adminId}`}
                  onClick={onLeave}
                  variant="secondary"
                  size="S"
                >
                  {t('impersonation.preview.noRole.link', 'Assign a role')}
                </LinkButton>
              ) : null
            }
            data-preview-no-role=""
          >
            <ReadableText variant="omega" textColor="neutral800" tag="span">
              {t(
                'impersonation.preview.noRole.body',
                'This admin has no role, so they cannot use the admin panel. Assign a role in Settings › Users.'
              )}
            </ReadableText>
          </Alert>
        )}
        {roles.length && canReadRoles ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('impersonation.preview.leaveHint', 'Opening a link ends this preview.')}
          </Typography>
        ) : null}
      </Flex>

      {summary.hasRoles ? (
        <Flex direction="column" alignItems="stretch" gap={4} data-preview-content="">
          <Flex direction="column" alignItems="stretch" gap={1}>
            <Typography variant="delta" tag="h3" textColor="neutral800">
              {t('impersonation.preview.contentManager', 'Content Manager')}
            </Typography>
            <Typography variant="pi" textColor="neutral600" tag="p">
              {t(
                'impersonation.preview.legend',
                'Limited means only some fields, locales or entries. Open the row to see the limits.'
              )}
            </Typography>
          </Flex>
          {rows.length >= SEARCH_FROM ? (
            <Searchbar
              name="preview-content-types"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              clearLabel={t('impersonation.preview.search.clear', 'Clear search')}
              placeholder={t('impersonation.preview.search.placeholder', 'Search content types')}
            >
              {t('impersonation.preview.search.label', 'Search content types')}
            </Searchbar>
          ) : null}
          {visible.length ? (
            <ContentMatrix rows={visible} conditionNames={preview?.conditionNames || {}} />
          ) : (
            <Typography variant="omega" textColor="neutral800" tag="p">
              {rows.length
                ? t('impersonation.preview.search.none', 'No content type matches your search.')
                : t(
                    'impersonation.preview.noContentTypes',
                    'This admin cannot open any content type in the Content Manager.'
                  )}
            </Typography>
          )}
        </Flex>
      ) : null}

      {summary.hasRoles ? (
        <Flex direction="column" alignItems="stretch" gap={4} data-preview-other="">
          <Typography variant="delta" tag="h3" textColor="neutral800">
            {t('impersonation.preview.pluginsSettings', 'Plugins and settings')}
          </Typography>
          {groups.length ? (
            <Accordion.Root size="M">
              {groups.map((group) => (
                <Accordion.Item key={group.key} value={group.key}>
                  <Accordion.Header>
                    <Accordion.Trigger
                      description={
                        group.section === 'settings'
                          ? t(
                              'impersonation.preview.group.settings',
                              'Settings · {count, plural, one {# permission} other {# permissions}}',
                              { count: group.items.length }
                            )
                          : t(
                              'impersonation.preview.group.plugin',
                              'Plugin · {count, plural, one {# permission} other {# permissions}}',
                              { count: group.items.length }
                            )
                      }
                    >
                      {group.label}
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content>
                    <Box padding={4}>
                      <Flex
                        tag="ul"
                        direction="column"
                        alignItems="stretch"
                        gap={2}
                        margin={0}
                        padding={0}
                        style={{ listStyle: 'none' }}
                      >
                        {group.items.map((item) => (
                          <Flex key={item.action} tag="li" gap={2} alignItems="center">
                            <Check
                              aria-hidden
                              focusable={false}
                              fill="success600"
                              width="1.4rem"
                              height="1.4rem"
                            />
                            <Typography variant="omega" textColor="neutral800">
                              {item.subCategory ? `${item.subCategory}: ${item.name}` : item.name}
                            </Typography>
                          </Flex>
                        ))}
                      </Flex>
                    </Box>
                  </Accordion.Content>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          ) : (
            <Typography variant="omega" textColor="neutral800" tag="p">
              {t('impersonation.preview.noOther', 'No plugin or settings permissions.')}
            </Typography>
          )}
        </Flex>
      ) : null}
    </Flex>
  );
};

export default AdminPreviewDetails;
