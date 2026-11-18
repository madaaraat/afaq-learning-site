const whiteboardRoomPattern = /^[a-f0-9-]{36}$/;

function validWhiteboardOperation(operation) {
  if (!operation || typeof operation.actor !== 'string' || !whiteboardRoomPattern.test(operation.actor) ||
      !Number.isSafeInteger(operation.order) || operation.order < 1 || operation.order > 1000000000) return false;

  switch (operation.type) {
    case 'clear':
      return true;
    case 'background':
      return ['plain', 'grid', 'ruled'].includes(operation.background);
    case 'stroke': {
      const mark = operation.mark;
      return Boolean(mark && ['pen', 'eraser', 'line', 'rectangle', 'circle'].includes(mark.tool) &&
        typeof mark.color === 'string' && /^#[0-9a-f]{6}$/i.test(mark.color) && [3, 6, 12].includes(mark.width) &&
        Array.isArray(mark.points) && mark.points.length > 0 && mark.points.length <= 2048 &&
        mark.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
          Math.abs(point.x) <= 4096 && Math.abs(point.y) <= 4096));
    }
    default:
      return false;
  }
}

function compareWhiteboardOperations(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  if (a.actor === b.actor) return 0;
  return a.actor < b.actor ? -1 : 1;
}

function createWhiteboardModel(onOperations) {
  const actor = crypto.randomUUID();
  const seen = new Set();
  const operations = [];
  let clock = 0;

  function merge(batch) {
    const incoming = [];
    const last = operations.at(-1);
    for (const operation of batch) {
      if (!validWhiteboardOperation(operation)) continue;
      const id = operation.actor + ':' + operation.order;
      if (seen.has(id)) continue;
      seen.add(id);
      clock = Math.max(clock, operation.order);
      incoming.push(operation);
    }
    if (!incoming.length) return;
    incoming.sort(compareWhiteboardOperations);
    for (const operation of incoming) operations.push(operation);
    const replay = Boolean(last && compareWhiteboardOperations(incoming[0], last) < 0);
    if (replay) operations.sort(compareWhiteboardOperations);
    onOperations(replay ? operations : incoming, replay);
  }

  return {
    actor,
    operations,
    merge,
    create(payload) {
      const operation = { ...payload, actor, order: ++clock };
      if (!validWhiteboardOperation(operation)) throw new Error('Invalid whiteboard operation');
      merge([operation]);
      return operation;
    },
  };
}

function openWhiteboardSession(room, onOperations, onPresence) {
  const model = createWhiteboardModel(onOperations);
  const { actor, operations, merge } = model;
  const channel = new BroadcastChannel('afaq-whiteboard-v1:' + room);
  const peers = new Map();
  function send(type, data = {}) {
    channel.postMessage({ type, room, actor, ...data });
  }

  channel.onmessage = ({ data }) => {
    if (!data || data.room !== room || data.actor === actor ||
        typeof data.actor !== 'string' || !whiteboardRoomPattern.test(data.actor)) return;
    if (data.type === 'leave') {
      peers.delete(data.actor);
    } else {
      peers.set(data.actor, Date.now());
      if (data.type === 'join') {
        send('history', { recipient: data.actor, operations });
      } else if (data.type === 'history' && data.recipient === actor && Array.isArray(data.operations)) {
        merge(data.operations);
      } else if (data.type === 'operation' && data.operation?.actor === data.actor) {
        merge([data.operation]);
      }
    }
    onPresence(peers.size);
  };

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [peer, lastSeen] of peers) {
      if (now - lastSeen > 12000) peers.delete(peer);
    }
    onPresence(peers.size);
    send('presence');
  }, 3000);
  send('join');

  return {
    publish(payload) {
      const operation = model.create(payload);
      send('operation', { operation });
    },
    close() {
      clearInterval(heartbeat);
      send('leave');
      channel.close();
    },
  };
}
