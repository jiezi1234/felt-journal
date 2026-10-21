// Coordinate the native board snapshot with the card's shared photo layer.
// All of this state is transient; opening a card never moves a saved placement.
function boardOf(host) { return host.selectComponent && (host.selectComponent('#today-board') || host.selectComponent('#board')); }
function cardOf(host) { return host.selectComponent && host.selectComponent('#memory-card'); }
function cancel(host) { host.memoryOpenToken = (host.memoryOpenToken || 0) + 1; host.memoryOpening = false; }
function open(host, id) {
  const board = boardOf(host), date = host.date, token = host.memoryOpenToken = (host.memoryOpenToken || 0) + 1;
  const show = source => {
    if (host.disposed || token !== host.memoryOpenToken || host.date !== date || host.data.memoryCardId || host.data.shareBoardId || host.data.editorOpen || host.photoTask) return;
    host.setData({ memoryCardId:id, memoryCardSource:source, drawer:'' });
    if (host.syncNavigation) host.syncNavigation();
  };
  if (!board || !board.preparePickup) { show(null); return; }
  host.memoryOpening = true;
  return board.preparePickup(id).then(show, () => show(null)).finally(() => { if (token === host.memoryOpenToken) host.memoryOpening = false; });
}
async function lift(host, event) {
  const id = event.detail.id, card = cardOf(host), board = boardOf(host);
  if (!card || host.data.memoryCardId !== id) return;
  const ok = !!board && await board.setPickupHidden(id);
  if (host.disposed || card !== cardOf(host) || host.data.memoryCardId !== id) { if (board && board.pickupId === id) board.setPickupHidden(''); return; }
  card.pickupLifted(ok);
}
async function returnSource(host, event) {
  const id = event.detail.id, card = cardOf(host), board = boardOf(host);
  if (!card || host.data.memoryCardId !== id) return;
  const rect = board && await board.pickupRect(id);
  if (!host.disposed && card === cardOf(host) && host.data.memoryCardId === id) card.pickupReturn(rect || null, () => {
    // Submit the native motion before painting/exporting the full board. The
    // capture then overlaps travel without blocking its first visible frame.
    if (!host.disposed && card === cardOf(host) && host.data.memoryCardId === id && board && board.preparePickupReturn) board.preparePickupReturn();
  });
}
function restore(host) {
  const board = boardOf(host);
  if (board && board.pickupReturn) return board.commitPickupReturn();
  return board && board.pickupId ? board.setPickupHidden('') : null;
}
function close(host) {
  const id = host.data.memoryCardId;
  const finish = () => {
    if (host.disposed || host.data.memoryCardId !== id) return;
    host.setData({ memoryCardId:'', memoryCardSource:null }); host.refresh();
    if (host.syncNavigation) host.syncNavigation();
  };
  const pending = restore(host); if (pending) return pending.then(finish, finish);
  finish();
}
module.exports = { open, lift, returnSource, restore, close, cancel };
