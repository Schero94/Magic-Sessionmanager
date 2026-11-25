import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Flex, Typography } from '@strapi/design-system';
import { SignOut, User } from '@strapi/icons';
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import pluginPermissions from '../../permissions';
import { ConfirmAction } from '../ui';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';
import ImpersonateUserModal from './ImpersonateUserModal';
import {
  closeImpersonationDialog,
  getImpersonationDialog,
  openImpersonationDialog,
  registerImpersonationPanel,
  subscribeImpersonationDialogs,
} from '../../utils/impersonationDialogStore.mjs';

/**
 * Moves focus back to this user's visible Impersonate / End button. Strapi
 * can keep a hidden copy of the panel mounted (drawer), so the button of the
 * copy that owned the dialog may not be visible.
 *
 * @param {string} documentId User documentId.
 * @param {HTMLElement|null} fallback Button of the owning copy.
 * @returns {void}
 */
const focusVisibleTrigger = (documentId, fallback) => {
  const candidates = [
    ...document.querySelectorAll(
      `[data-impersonation-trigger="${globalThis.CSS?.escape ? globalThis.CSS.escape(documentId) : documentId}"]`
    ),
  ];
  const visible = candidates.find((node) => node.getClientRects().length > 0);
  (visible || fallback)?.focus?.();
};

/**
 * Impersonation block of the user's Sessions panel in the Content Manager
 * (4.20). Renders nothing unless the admin holds "Impersonate app users" and
 * the Impersonation switch is on. Shows "Impersonate…" (opens the dialog)
 * or, while an impersonation of this user runs, its end time and End.
 *
 * @param {{documentId: string, userLabel: string}} props Target user.
 * @returns {import('react').ReactElement|null} Block.
 */
const ImpersonationPanelSection = ({ documentId, userLabel }) => {
  const { t } = useSettingsTranslate();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { formatDate } = useSessionFormatters();
  const {
    isLoading,
    allowedActions: { canUsers },
  } = useRBAC(pluginPermissions.impersonateUsers);
  const [status, setStatus] = useState(null);
  const [active, setActive] = useState(null);
  const instance = useId();
  const dialog = useSyncExternalStore(subscribeImpersonationDialogs, () =>
    getImpersonationDialog(documentId)
  );
  // Only one mounted copy of the panel renders the dialog (see the store).
  const open = dialog?.open === true && dialog.owner === instance;
  useEffect(() => registerImpersonationPanel(documentId, instance), [documentId, instance]);
  const triggerRef = useRef(null);
  const endTriggerRef = useRef(null);

  const requestRef = useRef(0);

  /**
   * Applies one status-and-list result unless a newer request was started.
   *
   * @param {number} request Request number.
   * @param {Promise<[object, object]>} pending Status and list requests.
   * @returns {Promise<void>}
   */
  const apply = useCallback(
    async (request, pending) => {
      try {
        const [statusResponse, listResponse] = await pending;
        if (request !== requestRef.current) return;
        setStatus(statusResponse?.data?.data || null);
        const rows = Array.isArray(listResponse?.data?.data) ? listResponse.data.data : [];
        setActive(
          rows.find((row) => row.targetType === 'user' && row.targetId === documentId) || null
        );
      } catch (err) {
        if (isCancelledRequest(err) || request !== requestRef.current) return;
        logSafeAdminError('impersonation.panel', err);
        setStatus(null);
      }
    },
    [documentId]
  );

  const fetchState = useCallback(
    () =>
      Promise.all([
        get(`/${pluginId}/impersonation/status`),
        get(`/${pluginId}/impersonation/active`),
      ]),
    [get]
  );

  const load = useCallback(() => apply(++requestRef.current, fetchState()), [apply, fetchState]);

  useEffect(() => {
    if (isLoading || !canUsers || !documentId) return;
    apply(++requestRef.current, fetchState());
  }, [apply, canUsers, documentId, fetchState, isLoading]);

  if (isLoading || !canUsers || !status?.enabled) return null;

  /**
   * Ends the running impersonation; throws so the dialog stays open on failure.
   *
   * @returns {Promise<void>}
   */
  const end = async () => {
    try {
      await post(`/${pluginId}/impersonation/${active.id}/end`, {});
      toggleNotification({
        type: 'success',
        message: t('impersonation.ended', 'Impersonation ended.'),
      });
    } catch (err) {
      logSafeAdminError('impersonation.end', err);
      toggleNotification({
        type: 'danger',
        message: t('impersonation.error.end', 'The impersonation could not be ended.'),
      });
      throw err;
    } finally {
      await load();
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-panel-impersonation="">
      <Typography variant="sigma" textColor="neutral600" tag="h3">
        {t('impersonation.panel.title', 'Impersonation')}
      </Typography>
      {active ? (
        <>
          <Typography variant="pi" textColor="neutral800" tag="p">
            {t('impersonation.panel.running', 'Running until {time}.', {
              time: formatDate(active.expiresAt, { hour: '2-digit', minute: '2-digit' }),
            })}
          </Typography>
          <ConfirmAction
            title={t('impersonation.confirm.title', 'End the impersonation of {user}?', {
              user: userLabel,
            })}
            body={t(
              'impersonation.confirm.body',
              'The short-lived sign-in stops working at once. This is recorded in the security log.'
            )}
            confirmLabel={t('impersonation.end', 'End impersonation')}
            onConfirm={end}
            fallbackFocusRef={triggerRef}
            trigger={
              <Button
                ref={endTriggerRef}
                data-impersonation-trigger={documentId}
                fullWidth
                size="S"
                variant="danger-light"
                startIcon={<SignOut aria-hidden focusable={false} />}
                type="button"
              >
                {t('impersonation.end', 'End impersonation')}
              </Button>
            }
          />
        </>
      ) : (
        <Button
          ref={triggerRef}
          data-impersonation-trigger={documentId}
          fullWidth
          size="S"
          variant="secondary"
          startIcon={<User aria-hidden focusable={false} />}
          onClick={() => openImpersonationDialog(documentId, instance)}
          type="button"
        >
          {t('impersonation.panel.start', 'Impersonate…')}
        </Button>
      )}
      {open ? (
        <ImpersonateUserModal
          open
          onOpenChange={(next) => {
            if (!next) {
              closeImpersonationDialog(documentId);
              load();
              // The dialog unmounts at once, so Radix may not restore focus;
              // move it to this user's visible button after the close.
              window.setTimeout(
                () => focusVisibleTrigger(documentId, triggerRef.current || endTriggerRef.current),
                0
              );
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusVisibleTrigger(documentId, triggerRef.current || endTriggerRef.current);
          }}
          user={{ documentId, label: userLabel }}
          status={status}
          onChanged={load}
        />
      ) : null}
    </Flex>
  );
};

export default ImpersonationPanelSection;
