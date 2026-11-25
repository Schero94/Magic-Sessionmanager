import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  IconButton,
  Modal,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Pencil, Plus, Trash } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import Alert from '../../components/PersistentAlert';
import { RowActions } from '../../components/ui';
import { useElementWidth } from '../../utils/useElementWidth';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import {
  ROLE_RULE_RANGES,
  removeRoleRule,
  toRoleRule,
  upsertRoleRule,
  validateRoleRule,
} from '../../utils/policyForm.mjs';
import { shouldIsolateActionKey } from '../Dashboard/dashboardModel.mjs';
import { AdvancedSection, ProtectedNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const TABLE_MIN_WIDTH = 640;

/** Keeps Enter and Space on the row's buttons (the DS grid cell swallows them). */
const keepActionKeys = (event) => {
  if (shouldIsolateActionKey(event.key, true)) event.stopPropagation();
};

const EMPTY_DRAFT = Object.freeze({
  role: '',
  maxSessionsPerUser: undefined,
  inactivityTimeout: undefined,
  maxFailedLoginsPerAccount: undefined,
});

/**
 * Value of a rule, or "General setting" when the rule leaves it empty.
 *
 * @param {{value: number|null|undefined, unit: string}} props Value and unit text.
 * @returns {import('react').ReactElement} Cell text.
 */
const RuleValue = ({ value, format }) => {
  const { t } = useSettingsTranslate();
  if (value === null || value === undefined) {
    return (
      <Typography variant="omega" textColor="neutral600">
        {t('settings.roleRules.general', 'General setting')}
      </Typography>
    );
  }
  return (
    <Typography variant="omega" textColor="neutral800">
      {format(value)}
    </Typography>
  );
};

/**
 * "Different rules for some roles" (Sessions tab, collapsed): per
 * Users & Permissions role, a different session limit, inactivity timeout
 * and account lockout threshold. Edits change the settings draft; the page's
 * Save stores them. Add and Edit open one dialog; Remove takes no
 * confirmation because nothing is stored before Save (Discard restores it).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Collapsed section.
 */
const RoleRulesSection = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { get } = useFetchClient();
  const { settings, handleChange } = form;
  const locked = form.canChangeProtected === false;
  const rules = Array.isArray(settings.roleRules) ? settings.roleRules : [];
  const [roles, setRoles] = useState(null);
  const [rolesError, setRolesError] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const addRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [widthRef, width] = useElementWidth();

  useEffect(() => {
    let active = true;
    get(`/${pluginId}/roles`)
      .then(({ data }) => {
        if (!active) return;
        if (!Array.isArray(data?.data)) throw new Error('Invalid role list');
        setRoles(data.data);
      })
      .catch((err) => {
        if (!active || isCancelledRequest(err)) return;
        logSafeAdminError('roles', err);
        setRolesError(true);
      });
    return () => {
      active = false;
    };
  }, [get]);

  const roleName = (documentId) =>
    roles?.find((role) => role.documentId === documentId)?.name ||
    t('settings.roleRules.unknownRole', 'Removed role');
  const minutes = (value) =>
    t('settings.roleRules.minutes', '{count, plural, one {# minute} other {# minutes}}', {
      count: value,
    });
  const sessions = (value) =>
    value === 0
      ? t('settings.roleRules.noLimit', 'No limit')
      : t('settings.roleRules.sessions', '{count, plural, one {# session} other {# sessions}}', {
          count: value,
        });
  const failures = (value) =>
    value === 0
      ? t('settings.roleRules.noAccountLock', 'Off')
      : t('settings.roleRules.failures', '{count, plural, one {# failure} other {# failures}}', {
          count: value,
        });

  const open = (rule, trigger) => {
    returnFocusRef.current = trigger || addRef.current;
    setShowErrors(false);
    setDraft(
      rule
        ? {
            role: rule.role,
            maxSessionsPerUser: rule.maxSessionsPerUser ?? undefined,
            inactivityTimeout: rule.inactivityTimeout ?? undefined,
            maxFailedLoginsPerAccount: rule.maxFailedLoginsPerAccount ?? undefined,
          }
        : EMPTY_DRAFT
    );
    setDialog({ editing: rule ? rule.role : null });
  };

  const close = () => {
    setDialog(null);
    window.requestAnimationFrame?.(() => {
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : addRef.current;
      target?.focus?.();
    });
  };

  const taken = rules.map((rule) => rule.role).filter((role) => role !== dialog?.editing);
  const draftErrors = validateRoleRule(draft, taken);
  const submit = () => {
    if (Object.keys(draftErrors).length > 0) {
      setShowErrors(true);
      return;
    }
    handleChange('roleRules', upsertRoleRule(rules, toRoleRule(draft), dialog?.editing));
    close();
  };
  const fieldError = (key) => (showErrors ? tError(draftErrors[key]) : undefined);
  const availableRoles = (roles || []).filter((role) => !taken.includes(role.documentId));
  const asTable = width === 0 || width >= TABLE_MIN_WIDTH;

  const actions = (rule) => {
    const name = roleName(rule.role);
    return (
      <RowActions onKeyDown={keepActionKeys}>
        <IconButton
          variant="ghost"
          disabled={locked}
          label={t('settings.roleRules.edit', 'Edit the rule for {role}', { role: name })}
          onClick={(event) => open(rule, event.currentTarget)}
        >
          <Pencil />
        </IconButton>
        <IconButton
          variant="ghost"
          disabled={locked}
          label={t('settings.roleRules.remove', 'Remove the rule for {role}', { role: name })}
          onClick={() => {
            handleChange('roleRules', removeRoleRule(rules, rule.role));
            window.requestAnimationFrame?.(() => addRef.current?.focus?.());
          }}
        >
          <Trash />
        </IconButton>
      </RowActions>
    );
  };

  return (
    <AdvancedSection
      label={t('settings.roleRules.title', 'Different rules for some roles')}
      hasError={Object.keys(form.errors || {}).some((key) => key.startsWith('roleRules'))}
    >
      <ReadableText variant="pi" textColor="neutral600" tag="p">
        {t(
          'settings.roleRules.intro',
          'Give a Users & Permissions role its own session limit, inactivity timeout or account lockout. Empty values use the general setting. The overview still counts sessions as idle by the general timeout.'
        )}
      </ReadableText>
      {locked ? <ProtectedNotice /> : null}
      {rolesError ? (
        <Alert
          variant="warning"
          closeLabel={t('common.close', 'Close')}
          title={t('settings.roleRules.rolesError', 'Roles could not be loaded.')}
        >
          {t(
            'settings.roleRules.rolesErrorBody',
            'Existing rules still apply. Reload the page to add or edit rules.'
          )}
        </Alert>
      ) : null}
      <div ref={widthRef}>
        {rules.length === 0 ? (
          <Typography variant="omega" textColor="neutral600" tag="p">
            {t(
              'settings.roleRules.empty',
              'No role has its own rules. Every role uses the general settings.'
            )}
          </Typography>
        ) : asTable ? (
          <Box hasRadius borderColor="neutral150" data-role-rules-table="">
            <Table colCount={5} rowCount={rules.length + 1}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma" textColor="neutral600">
                      {t('settings.roleRules.col.role', 'Role')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma" textColor="neutral600">
                      {t('settings.roleRules.col.sessions', 'Session limit')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma" textColor="neutral600">
                      {t('settings.roleRules.col.idle', 'Inactivity timeout')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma" textColor="neutral600">
                      {t('settings.roleRules.col.lockout', 'Account lockout')}
                    </Typography>
                  </Th>
                  <Th>
                    <VisuallyHidden>
                      {t('settings.roleRules.col.actions', 'Actions')}
                    </VisuallyHidden>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {rules.map((rule) => (
                  <Tr key={rule.role} data-role-rule={rule.role}>
                    <Td>
                      <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                        {roleName(rule.role)}
                      </Typography>
                    </Td>
                    <Td>
                      <RuleValue value={rule.maxSessionsPerUser} format={sessions} />
                    </Td>
                    <Td>
                      <RuleValue value={rule.inactivityTimeout} format={minutes} />
                    </Td>
                    <Td>
                      <RuleValue value={rule.maxFailedLoginsPerAccount} format={failures} />
                    </Td>
                    <Td>{actions(rule)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        ) : (
          <Flex direction="column" alignItems="stretch" gap={2} tag="ul">
            {rules.map((rule) => (
              <Box
                key={rule.role}
                tag="li"
                padding={4}
                hasRadius
                borderColor="neutral150"
                data-role-rule={rule.role}
              >
                <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
                  <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                    <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                      {roleName(rule.role)}
                    </Typography>
                    {[
                      [
                        'settings.roleRules.col.sessions',
                        'Session limit',
                        rule.maxSessionsPerUser,
                        sessions,
                      ],
                      [
                        'settings.roleRules.col.idle',
                        'Inactivity timeout',
                        rule.inactivityTimeout,
                        minutes,
                      ],
                      [
                        'settings.roleRules.col.lockout',
                        'Account lockout',
                        rule.maxFailedLoginsPerAccount,
                        failures,
                      ],
                    ].map(([id, label, value, format]) => (
                      <Typography key={id} variant="pi" textColor="neutral600">
                        {t('settings.roleRules.line', '{label}: {value}', {
                          label: t(id, label),
                          value:
                            value === null || value === undefined
                              ? t('settings.roleRules.general', 'General setting')
                              : format(value),
                        })}
                      </Typography>
                    ))}
                  </Flex>
                  {actions(rule)}
                </Flex>
              </Box>
            ))}
          </Flex>
        )}
      </div>
      <Flex gap={3} wrap="wrap" alignItems="center">
        <Button
          ref={addRef}
          variant="secondary"
          startIcon={<Plus />}
          disabled={locked || (roles !== null && availableRoles.length === 0 && !dialog)}
          onClick={() => open(null, addRef.current)}
        >
          {t('settings.roleRules.add', 'Add rule')}
        </Button>
        {roles !== null && roles.length > 0 && availableRoles.length === 0 ? (
          <Typography variant="pi" textColor="neutral600" data-role-rules-full="">
            {t(
              'settings.roleRules.allRoles',
              'Every role already has a rule. Edit a rule to change it.'
            )}
          </Typography>
        ) : null}
      </Flex>

      <Modal.Root open={Boolean(dialog)} onOpenChange={(next) => (next ? null : close())}>
        <Modal.Content aria-describedby={undefined}>
          <Modal.Header closeLabel={t('common.close', 'Close')}>
            <Modal.Title>
              {dialog?.editing
                ? t('settings.roleRules.dialog.editTitle', 'Edit the rule for {role}', {
                    role: roleName(dialog.editing),
                  })
                : t('settings.roleRules.dialog.addTitle', 'Add a rule for a role')}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={5}>
              <FormField
                id="role-rule-role"
                name="role"
                label={t('settings.roleRules.col.role', 'Role')}
                error={fieldError('role')}
                required
              >
                <SingleSelect
                  value={draft.role || undefined}
                  placeholder={t('settings.roleRules.dialog.rolePlaceholder', 'Choose a role')}
                  onChange={(value) => setDraft((previous) => ({ ...previous, role: value }))}
                >
                  {(roles || [])
                    .filter(
                      (role) => role.documentId === draft.role || !taken.includes(role.documentId)
                    )
                    .map((role) => (
                      <SingleSelectOption key={role.documentId} value={role.documentId}>
                        {role.name}
                      </SingleSelectOption>
                    ))}
                </SingleSelect>
              </FormField>
              {[
                [
                  'maxSessionsPerUser',
                  'role-rule-sessions',
                  t('settings.config.sessionLimit.max.label', 'Open sessions per user'),
                  t('settings.roleRules.dialog.sessionsHint', '0 means no limit for this role.'),
                  t('settings.roleRules.dialog.sessionsSuffix', 'sessions'),
                ],
                [
                  'inactivityTimeout',
                  'role-rule-idle',
                  t('settings.config.sessions.inactivity.label', 'Inactivity timeout'),
                  t('settings.roleRules.dialog.idleHint', 'From 1 to 1440 minutes.'),
                  t('settings.config.failed.minutes.suffix', 'minutes'),
                ],
                [
                  'maxFailedLoginsPerAccount',
                  'role-rule-lockout',
                  t('settings.config.failed.account.label', 'Lock an account after'),
                  t(
                    'settings.roleRules.dialog.lockoutHint',
                    '0 turns the account lockout off for this role.'
                  ),
                  t('settings.config.failed.lockout.suffix', 'failed sign-ins'),
                ],
              ].map(([key, id, label, hint, suffix]) => (
                <FormField
                  key={key}
                  id={id}
                  name={key}
                  label={label}
                  description={`${hint} ${t('settings.roleRules.dialog.emptyHint', 'Leave empty to use the general setting.')}`}
                  suffix={suffix}
                  error={fieldError(key)}
                >
                  <NumberInput
                    value={draft[key]}
                    onValueChange={(value) =>
                      setDraft((previous) => ({ ...previous, [key]: value }))
                    }
                    min={ROLE_RULE_RANGES[key].min}
                    max={ROLE_RULE_RANGES[key].max}
                    step={1}
                  />
                </FormField>
              ))}
              {showErrors && draftErrors.form ? (
                <Typography variant="pi" textColor="danger600" tag="p" role="alert">
                  {tError(draftErrors.form)}
                </Typography>
              ) : null}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel', 'Cancel')}</Button>
            </Modal.Close>
            <Button onClick={submit}>
              {dialog?.editing
                ? t('settings.roleRules.dialog.apply', 'Apply')
                : t('settings.roleRules.dialog.add', 'Add rule')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </AdvancedSection>
  );
};

export default RoleRulesSection;
