import { useRef, useState } from 'react';
import { Button, Dialog } from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';
import { pickFocusTarget } from '../../utils/restoreDialogFocus.mjs';

/**
 * Confirms a destructive action with Strapi's ConfirmDialog. Never use
 * window.confirm. Focus returns to the trigger after the dialog closes; when
 * the trigger is gone or disabled (for example a deleted row, or "End all
 * sessions" once no session is left), it moves to `fallbackFocusRef` instead
 * of being lost on <body>.
 *
 * Without a `trigger` the dialog is controlled through `isOpen` and
 * `onOpenChange`, for actions started from a menu item; focus then returns
 * to `returnFocusRef` (the menu button), else to `fallbackFocusRef`.
 *
 * @param {object} props
 * @param {import('react').ReactElement} [props.trigger] A single DS Button/IconButton (receives ref and onClick).
 * @param {import('react').ReactNode} props.title Dialog title.
 * @param {import('react').ReactNode} props.body Dialog body (string or node).
 * @param {import('react').ReactNode} props.confirmLabel Label of the confirming button.
 * @param {() => (void|Promise<void>)} props.onConfirm Runs the action; the dialog stays open if it throws.
 * @param {'danger'|'danger-light'|'default'|'secondary'} [props.variant] Confirm button variant.
 * @param {boolean} [props.disabled] Disable the trigger.
 * @param {{current: HTMLElement|null}} [props.fallbackFocusRef] Focus target when the trigger was removed.
 * @param {boolean} [props.isOpen] Controlled open state (only without `trigger`).
 * @param {(open: boolean) => void} [props.onOpenChange] Controlled state change (only without `trigger`).
 * @param {{current: HTMLElement|null}} [props.returnFocusRef] Focus target after a controlled dialog closes.
 * @returns {import('react').ReactElement} Trigger with its confirmation dialog.
 */
const ConfirmAction = ({
  trigger,
  title,
  body,
  confirmLabel,
  onConfirm,
  variant = 'danger',
  disabled = false,
  fallbackFocusRef,
  isOpen,
  onOpenChange,
  returnFocusRef,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);
  const controlled = !trigger;
  const open = controlled ? Boolean(isOpen) : internalOpen;

  const restoreFocus = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const ownTrigger = controlled ? returnFocusRef?.current : triggerRef.current;
      const target = pickFocusTarget(ownTrigger, fallbackFocusRef?.current);
      if (target) target.focus();
    });
  };

  const setOpen = (next) => {
    if (controlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };

  const handleOpenChange = (next) => {
    if (busy) return;
    setOpen(next);
    if (!next) restoreFocus();
  };

  const handleConfirm = async (event) => {
    event?.preventDefault?.();
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
      restoreFocus();
    } catch {
      // The caller reports the error (useNotification); keep the dialog open to retry or cancel.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <Dialog.Trigger ref={triggerRef} disabled={disabled}>
          {trigger}
        </Dialog.Trigger>
      ) : null}
      <ConfirmDialog
        title={title}
        variant={variant}
        endAction={
          <Button fullWidth variant={variant} onClick={handleConfirm} loading={busy} disabled={busy}>
            {confirmLabel}
          </Button>
        }
      >
        {body}
      </ConfirmDialog>
    </Dialog.Root>
  );
};

export default ConfirmAction;
