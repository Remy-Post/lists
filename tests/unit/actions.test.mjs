// actions.test.mjs — verbs the app and the MCP bridge share (docs/MCP-PLAN.md §10). Run: node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/js/store.js';
import * as O from '../../src/js/ops.js';

// state.js reads matchMedia at load; the bridge shims it the same way before importing actions.js.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const A = await import('../../src/js/actions.js');

function fresh() {
  S.hydrate([]);
  S.patch(S.INBOX, { kind: 'inbox', title: 'Inbox', pos: { parent: S.ROOT, key: 'a0', prev: null } });
  const list = A.newList('Groceries');
  const parent = A.createAt(list, 0, { title: 'Party', notes: 'party notes' });
  const child = A.createAt(parent, 0, { title: 'child secret', notes: 'child notes' });
  const kept = A.createAt(parent, 1, { title: 'kept child' });
  return { list, parent, child, kept };
}

test('Delete forever reaches children trashed on their own before the parent (audit 06, S2)', () => {
  const { parent, child, kept } = fresh();
  A.trash([child]);
  A.trash([parent]);
  assert.deepEqual(S.qTrash(), [parent], 'the child sits inside its trashed parent');
  A.destroy(S.qTrash()); // what "Empty Trash" does
  assert.deepEqual(S.qTrash(), [], 'Trash is empty');
  for (const id of [parent, child, kept]) {
    assert.equal(S.val(id, 'deleted'), 'void', id);
    assert.equal(S.val(id, 'title'), '', id);
    assert.equal(S.val(id, 'notes'), '', id);
  }
  assert.deepEqual(S.children(S.INBOX), [], 'nothing resurfaces in the Inbox');
  assert.equal(O.peekUndo().label, 'Delete forever');
  O.undo(); // one step brings the whole subtree back
  assert.deepEqual([parent, child, kept].map((id) => S.val(id, 'title')), ['Party', 'child secret', 'kept child']);
  assert.deepEqual(S.qTrash(), [parent]);
});

test('Delete forever skips reserved, unknown and already-void ids', () => {
  const { list, parent, child } = fresh();
  A.trash([parent]);
  A.destroy([S.ROOT, S.INBOX, 'nope', parent, parent]);
  assert.equal(S.val(S.INBOX, 'deleted'), false, 'the Inbox is never deleted');
  assert.equal(S.recs.has('nope'), false, 'unknown ids create nothing');
  assert.equal(S.val(list, 'deleted'), false, 'root is not a way to delete every list');
  assert.equal(S.val(child, 'deleted'), 'void');
  const v = S.recs.get(child).v;
  A.destroy([child]);
  assert.equal(S.recs.get(child).v, v, 'an already-void id is not written again');
});

test('Restore skips void ids', () => {
  const { parent, child } = fresh();
  A.trash([parent]);
  A.destroy([child]);
  A.restore([parent, child]);
  assert.equal(S.val(parent, 'deleted'), false);
  assert.equal(S.val(child, 'deleted'), 'void', 'a blanked item stays gone');
});

test('Undoing a create voids the item and blanks its text; redo brings it back (bridge request)', () => {
  const { list } = fresh();
  const id = A.createAt(list, 0, { title: 'call the bank', notes: 'account 1234' });
  O.undo();
  assert.equal(S.val(id, 'deleted'), 'void');
  assert.equal(S.val(id, 'title'), '', 'no text left in the voided record to sync');
  assert.equal(S.val(id, 'notes'), '');
  O.redo();
  assert.equal(S.val(id, 'deleted'), false);
  assert.deepEqual([S.val(id, 'title'), S.val(id, 'notes')], ['call the bank', 'account 1234']);
});

test('Completing a repeating item with an unreadable rule writes one log and no half step (audit c7 t5/t6)', () => {
  const { list } = fresh();
  const id = A.createAt(list, 0, { title: 'weird', notes: 'secret', rrule: 'garbage', when: '2026-01-01' });
  const logs = () => S.children(list).filter((c) => S.val(c, 'kind') === 'log').length;
  A.toggleDone([id]);
  assert.equal(logs(), 1);
  assert.equal(S.val(id, 'when'), null, 'no next date for a rule it can’t read');
  assert.equal(O.peekUndo().label, 'Complete');
  O.undo();
  assert.equal(logs(), 0, 'one undo takes the whole completion back');
});
