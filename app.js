const views = [...document.querySelectorAll('[data-view]')];
const navigation = document.querySelectorAll('nav a');

function showView(moveFocus = false) {
  const requested = location.hash.slice(1);
  if (requested === 'main') return;

  const active = views.find((view) => view.id === requested) ?? views[0];
  for (const view of views) view.hidden = view !== active;
  for (const link of navigation) {
    if (link.hash === '#' + active.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (moveFocus) active.querySelector('h1').focus();
}

showView();
window.addEventListener('hashchange', () => showView(true));
document.querySelector('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('[data-view]:not([hidden]) h1').focus();
});

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(active) {
  for (const tab of tabs) {
    const selected = tab === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    // Right-to-left tab order.
    const destination = {
      ArrowLeft: (index + 1) % tabs.length,
      ArrowRight: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    selectTab(tabs[destination]);
    tabs[destination].focus();
  });
}

const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const tool = document.getElementById('tool');
const ink = document.getElementById('ink');
const thickness = document.getElementById('thickness');
const background = document.getElementById('background');
const undo = document.getElementById('undo');
const redo = document.getElementById('redo');
const clear = document.getElementById('clear');
const save = document.getElementById('export');
const loadImage = document.getElementById('import');
const imageFile = document.getElementById('image-file');
const status = document.getElementById('board-status');

if (context) {
  const { width, height } = canvas;
  const drawing = document.createElement('canvas');
  drawing.width = width;
  drawing.height = height;
  const paint = drawing.getContext('2d');
  const past = [];
  const future = [];
  const share = document.getElementById('share-board');
  const openPeer = document.getElementById('open-board-peer');
  const leave = document.getElementById('leave-board');
  const sharingStatus = document.getElementById('sharing-status');
  const sharingLimits = document.getElementById('sharing-limits');
  const requestedRoom = new URL(location.href).searchParams.get('board');
  const joining = whiteboardRoomPattern.test(requestedRoom);
  let shared = null;
  let privateBoard;
  let importing = false;
  let gesture = null;
  let pointer = null;
  let cursor = { x: width / 2, y: height / 2 };
  let keyboardActive = false;
  let hasDrawing = false;

  function stroke(target, mark) {
    const first = mark.points[0];
    const last = mark.points.at(-1);
    target.save();
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.lineWidth = mark.width;
    target.strokeStyle = mark.color;
    target.fillStyle = mark.color;
    target.beginPath();

    switch (mark.tool) {
      case 'rectangle':
        target.rect(first.x, first.y, last.x - first.x, last.y - first.y);
        break;
      case 'circle':
        target.arc(first.x, first.y, Math.hypot(last.x - first.x, last.y - first.y), 0, 2 * Math.PI);
        break;
      case 'line':
        target.moveTo(first.x, first.y);
        target.lineTo(last.x, last.y);
        break;
      default:
        if (mark.tool === 'eraser') target.globalCompositeOperation = 'destination-out';
        if (mark.points.length === 1) {
          target.arc(first.x, first.y, mark.width / 2, 0, 2 * Math.PI);
          target.fill();
          target.restore();
          return;
        }
        target.moveTo(first.x, first.y);
        for (const point of mark.points.slice(1)) target.lineTo(point.x, point.y);
    }
    target.stroke();
    target.restore();
  }

  function drawBackground(target) {
    // Draw the paper underneath existing ink, including erased areas.
    target.save();
    target.globalCompositeOperation = 'destination-over';
    if (background.value !== 'plain') {
      target.strokeStyle = '#dae5ec';
      target.lineWidth = 1;
      target.beginPath();
      for (let y = 24; y < height; y += 24) {
        target.moveTo(0, y + .5);
        target.lineTo(width, y + .5);
      }
      if (background.value === 'grid') {
        for (let x = 24; x < width; x += 24) {
          target.moveTo(x + .5, 0);
          target.lineTo(x + .5, height);
        }
      }
      target.stroke();
    }
    target.fillStyle = '#fff';
    target.fillRect(0, 0, width, height);
    target.restore();
  }

  function render() {
    context.clearRect(0, 0, width, height);
    context.drawImage(drawing, 0, 0);
    if (gesture) stroke(context, gesture);
    drawBackground(context);
    if (keyboardActive) {
      context.beginPath();
      context.arc(cursor.x, cursor.y, 9, 0, 2 * Math.PI);
      context.strokeStyle = '#9c3b09';
      context.lineWidth = 3;
      context.stroke();
    }
  }

  function updateControls() {
    undo.disabled = Boolean(shared) || past.length === 0;
    redo.disabled = Boolean(shared) || future.length === 0;
    loadImage.disabled = Boolean(shared) || importing;
    share.disabled = !sharingAvailable || importing;
    clear.disabled = !hasDrawing;
    ink.disabled = tool.value === 'eraser';
  }

  function snapshot() {
    return { image: paint.getImageData(0, 0, width, height), hasDrawing };
  }

  function applyOperation(operation) {
    switch (operation.type) {
      case 'stroke':
        stroke(paint, operation.mark);
        hasDrawing = true;
        break;
      case 'clear':
        paint.clearRect(0, 0, width, height);
        hasDrawing = false;
        break;
      case 'background':
        background.value = operation.background;
        break;
    }
  }

  function applySharedOperations(operations, replay) {
    if (replay) {
      applyOperation({ type: 'clear' });
      background.value = 'plain';
    }
    for (const operation of operations) applyOperation(operation);
    updateControls();
    render();
  }

  function commitOperation(operation) {
    if (shared) {
      shared.publish(operation);
    } else {
      if (operation.type !== 'background') remember();
      applyOperation(operation);
    }
  }

  function remember() {
    past.push(snapshot());
    if (past.length > 16) past.shift();
    future.length = 0;
  }

  function restore(from, to, message) {
    if (!from.length) return;
    to.push(snapshot());
    const previous = from.pop();
    paint.putImageData(previous.image, 0, 0);
    hasDrawing = previous.hasDrawing;
    updateControls();
    render();
    status.textContent = message;
  }

  function begin(point) {
    gesture = { tool: tool.value, color: ink.value, width: Number(thickness.value), points: [point] };
  }

  function extend(point) {
    if (gesture.tool === 'pen' || gesture.tool === 'eraser') {
      if (gesture.points.length < 2048) gesture.points.push(point);
    }
    else gesture.points[1] = point;
  }

  function finish() {
    if (!gesture) return;
    const mark = gesture;
    gesture = null;
    const isFreehand = mark.tool === 'pen' || mark.tool === 'eraser';
    const first = mark.points[0];
    const last = mark.points.at(-1);
    const moved = first.x !== last.x || first.y !== last.y;
    if ((isFreehand || moved) && (mark.tool !== 'eraser' || hasDrawing)) {
      commitOperation({ type: 'stroke', mark });
    }
    updateControls();
  }

  function position(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, (event.clientX - bounds.left - canvas.clientLeft) * width / canvas.clientWidth)),
      y: Math.max(0, Math.min(height, (event.clientY - bounds.top - canvas.clientTop) * height / canvas.clientHeight)),
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointer !== null) return;
    finish();
    keyboardActive = false;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    begin(position(event));
    render();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    extend(position(event));
    render();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointer) return;
    const end = position(event);
    const last = gesture.points.at(-1);
    if (last.x !== end.x || last.y !== end.y) extend(end);
    pointer = null;
    finish();
    render();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      gesture = null;
      render();
    });
  }

  const directions = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  canvas.addEventListener('keydown', (event) => {
    if (pointer !== null) return;
    const direction = directions[event.key];
    if (!Array.isArray(direction) && event.key !== ' ' && event.key !== 'Escape') return;
    event.preventDefault();
    keyboardActive = true;
    if (event.key === 'Escape') {
      gesture = null;
      status.textContent = 'أُلغي الرسم الجاري';
    } else if (event.key === ' ') {
      if (event.repeat) return;
      if (gesture) {
        finish();
        status.textContent = 'اكتمل الرسم';
      } else {
        begin(cursor);
        status.textContent = 'بدأ الرسم';
      }
    } else {
      cursor = {
        x: Math.max(0, Math.min(width, cursor.x + direction[0] * 12)),
        y: Math.max(0, Math.min(height, cursor.y + direction[1] * 12)),
      };
      if (gesture) extend(cursor);
    }
    render();
  });
  canvas.addEventListener('blur', () => {
    if (pointer === null) finish();
    keyboardActive = false;
    render();
  });

  tool.addEventListener('change', updateControls);
  background.addEventListener('change', () => {
    commitOperation({ type: 'background', background: background.value });
    render();
  });
  undo.addEventListener('click', () => restore(past, future, 'تم التراجع'));
  redo.addEventListener('click', () => restore(future, past, 'تمت الإعادة'));
  clear.addEventListener('click', () => {
    if (!window.confirm('هل تريد مسح جميع الرسوم من السبورة؟ يمكنك التراجع بعد المسح.')) return;
    commitOperation({ type: 'clear' });
    updateControls();
    render();
    status.textContent = 'مُسحت السبورة';
  });
  save.addEventListener('click', () => {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const output = image.getContext('2d');
    output.drawImage(drawing, 0, 0);
    drawBackground(output);
    image.toBlob((blob) => {
      if (!blob) {
        status.textContent = 'تعذّر إنشاء صورة السبورة';
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'afaq-whiteboard.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'صورة السبورة جاهزة للتنزيل';
    }, 'image/png');
  });
  loadImage.addEventListener('click', () => imageFile.click());
  imageFile.addEventListener('change', async () => {
    const file = imageFile.files[0];
    imageFile.value = '';
    if (!file || shared || importing) return;
    importing = true;
    updateControls();
    try {
      const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('Invalid PNG');
      const image = await createImageBitmap(file);
      const scale = Math.min(width / image.width, height / image.height);
      const fittedWidth = image.width * scale;
      const fittedHeight = image.height * scale;
      remember();
      paint.clearRect(0, 0, width, height);
      paint.drawImage(image, (width - fittedWidth) / 2, (height - fittedHeight) / 2, fittedWidth, fittedHeight);
      image.close();
      hasDrawing = true;
      updateControls();
      render();
      status.textContent = 'استُوردت الصورة إلى السبورة';
    } catch {
      status.textContent = 'تعذّر استيراد الصورة. اختر ملف PNG صالحاً.';
    } finally {
      importing = false;
      updateControls();
    }
  });

  function showPresence(count) {
    const message = count > 0 ? 'مشارك تجريبي متصل في تبويب آخر.' : 'بانتظار تبويب مشارك محلي.';
    if (sharingStatus.textContent !== message) sharingStatus.textContent = message;
  }

  const sharingAvailable = typeof BroadcastChannel === 'function' && typeof window.crypto?.randomUUID === 'function';
  share.disabled = !sharingAvailable;
  if (!sharingAvailable) sharingStatus.textContent = 'مشاركة التبويبات غير متاحة هنا. السبورة الفردية جاهزة.';
  if (joining) share.textContent = 'انضم إلى المشاركة المحلية';

  share.addEventListener('click', () => {
    finish();
    const room = joining ? requestedRoom : crypto.randomUUID();
    try {
      shared = openWhiteboardSession(room, applySharedOperations, showPresence);
    } catch {
      sharingStatus.textContent = 'تعذّر إنشاء المشاركة المحلية في هذا المتصفح.';
      return;
    }
    privateBoard = { ...snapshot(), background: background.value };
    applySharedOperations([], true);
    const url = new URL(location.href);
    url.searchParams.set('board', room);
    url.hash = 'classroom';
    openPeer.href = url.href;
    openPeer.hidden = false;
    leave.hidden = false;
    share.hidden = true;
    sharingLimits.hidden = false;
    showPresence(0);
    openPeer.focus();
  });

  function leaveSharedBoard(moveFocus = false) {
    if (!shared) return;
    const previousSession = shared;
    shared = null;
    paint.putImageData(privateBoard.image, 0, 0);
    background.value = privateBoard.background;
    hasDrawing = privateBoard.hasDrawing;
    privateBoard = null;
    share.hidden = false;
    openPeer.hidden = true;
    leave.hidden = true;
    sharingLimits.hidden = true;
    sharingStatus.textContent = 'السبورة في الوضع الفردي.';
    updateControls();
    render();
    previousSession.close();
    if (moveFocus) share.focus();
  }

  leave.addEventListener('click', () => leaveSharedBoard(true));
  window.addEventListener('pagehide', () => leaveSharedBoard());
  render();
} else {
  for (const control of document.querySelectorAll('.board select, .board button')) control.disabled = true;
  document.getElementById('board-help').textContent = 'الرسم غير متاح في هذا المتصفح.';
  document.getElementById('sharing-status').textContent = 'مشاركة السبورة غير متاحة في هذا المتصفح.';
}
