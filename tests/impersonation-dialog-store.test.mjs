import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeImpersonationDialog,
  getImpersonationDialog,
  openImpersonationDialog,
  registerImpersonationPanel,
  saveImpersonationDraft,
  subscribeImpersonationDialogs,
} from '../admin/src/utils/impersonationDialogStore.mjs';

test('one mounted panel copy owns the dialog; it survives a re-mount and closes everywhere', () => {
  let changes = 0;
  const unsubscribe = subscribeImpersonationDialogs(() => {
    changes += 1;
  });
  const key = 'usersynthetic0000000001';
  const unregisterSidebar = registerImpersonationPanel(key, 'sidebar');
  const unregisterDrawer = registerImpersonationPanel(key, 'drawer');
  openImpersonationDialog(key, 'sidebar');
  assert.equal(getImpersonationDialog(key).owner, 'sidebar');
  saveImpersonationDraft(key, { reason: 'Ticket 1', result: { handoff: { type: 'token' } } });

  // The sidebar copy unmounts (narrow screen): the drawer copy takes over with the draft.
  unregisterSidebar();
  assert.equal(getImpersonationDialog(key).owner, 'drawer');
  assert.equal(getImpersonationDialog(key).draft.reason, 'Ticket 1');

  // The drawer unmounts too; a later copy re-mounts and becomes the owner.
  unregisterDrawer();
  assert.equal(getImpersonationDialog(key).owner, null);
  const unregisterAgain = registerImpersonationPanel(key, 'sidebar-2');
  assert.equal(getImpersonationDialog(key).owner, 'sidebar-2');
  assert.deepEqual(getImpersonationDialog(key).draft.result, { handoff: { type: 'token' } });

  // Closing forgets everything for every copy.
  closeImpersonationDialog(key);
  assert.equal(getImpersonationDialog(key), null);
  unregisterAgain();
  assert.ok(changes >= 4);
  unsubscribe();
});
