import { useRef, useState } from 'react';
import { Button, Dialog } from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';

/**
 * Confirms a destructive action with Strapi's ConfirmDialog. Never use
 * window.confirm. Focus returns to the trigger after the dialog closes; when
 * the trigger is gone (for example a deleted row), it moves to
 * `fallbackFocusRef` instead of being lost on <body>.
 *
 * @param {object} props
 * @param {import('react').ReactElement} props.trigger A single DS Button/IconButton (receives ref and onClick).
 * @param {import('react').ReactNode} props.title Dialog title.
 * @param {import('react').ReactNode} props.body Dialog body (string or node).
 * @param {import('react').ReactNode} props.confirmLabel Label of the confirming button.
 * @param {() => (void|Promise<void>)} props.onConfirm Runs the action; the dialog stays open if it throws.
 * @param {'danger'|'danger-light'|'default'|'secondary'} [props.variant] Confirm button variant.
 * @param {boolean} [props.disabled] Disable the trigger.
 * @param {{current: HTMLElement|null}} [props.fallbackFocusRef] Focus target when the trigger was removed.
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
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);

  const restoreFocus = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const target = triggerRef.current?.isConnected ? triggerRef.current : fallbackFocusRef?.current;
      if (target?.isConnected && typeof target.focus === 'function') target.focus();
    });
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
      <Dialog.Trigger ref={triggerRef} disabled={disabled}>
        {trigger}
      </Dialog.Trigger>
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
