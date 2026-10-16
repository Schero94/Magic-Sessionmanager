import assert from 'node:assert/strict';
import test from 'node:test';

test('clipboard helper waits for a successful write and does not retain copied data', async () => {
  const { copyText } = await import('../admin/src/utils/copyText.mjs');
  const copiedValues = [];
  const clipboard = {
    async writeText(value) {
      copiedValues.push(value);
    },
  };

  await copyText('synthetic sensitive value', clipboard);

  assert.deepEqual(copiedValues, ['synthetic sensitive value']);
  assert.equal(Object.keys(clipboard).includes('lastCopiedValue'), false);
});

test('clipboard helper reports unavailable or rejected writes instead of claiming success', async () => {
  const { copyText } = await import('../admin/src/utils/copyText.mjs');
  const failure = new Error('clipboard denied');

  await assert.rejects(copyText('value', null), { message: 'clipboard_unavailable' });
  await assert.rejects(copyText('value', { writeText: async () => { throw failure; } }), (error) => error === failure);
});
