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
const ink = document.getElementById('ink');
const clear = document.getElementById('clear');
const status = document.getElementById('board-status');

if (context) {
  // Keep the cursor on a separate bitmap layer so it does not become ink.
  const drawing = document.createElement('canvas');
  drawing.width = canvas.width;
  drawing.height = canvas.height;
  const paint = drawing.getContext('2d');
  paint.lineCap = 'round';
  paint.lineWidth = 5;
  let pointer = null;
  let lastPoint;
  let cursor = { x: canvas.width / 2, y: canvas.height / 2 };
  let penDown = false;
  let keyboardActive = false;

  function render() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(drawing, 0, 0);
    if (keyboardActive) {
      context.beginPath();
      context.arc(cursor.x, cursor.y, 9, 0, 2 * Math.PI);
      context.strokeStyle = '#9c3b09';
      context.lineWidth = 3;
      context.stroke();
    }
  }

  function draw(from, to) {
    paint.strokeStyle = ink.value;
    paint.beginPath();
    paint.moveTo(from.x, from.y);
    paint.lineTo(to.x, to.y);
    paint.stroke();
  }

  function position(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointer !== null) return;
    keyboardActive = false;
    penDown = false;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    lastPoint = position(event);
    draw(lastPoint, { x: lastPoint.x + 0.01, y: lastPoint.y });
    render();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    const point = position(event);
    draw(lastPoint, point);
    lastPoint = point;
    render();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === pointer) pointer = null;
    });
  }

  canvas.addEventListener('keydown', (event) => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!Array.isArray(direction) && event.key !== ' ') return;
    event.preventDefault();
    keyboardActive = true;
    if (event.key === ' ') {
      if (!event.repeat) {
        penDown = !penDown;
        status.textContent = penDown ? 'بدأ الرسم' : 'توقف الرسم';
      }
    } else {
      const next = {
        x: Math.max(0, Math.min(canvas.width, cursor.x + direction[0] * 12)),
        y: Math.max(0, Math.min(canvas.height, cursor.y + direction[1] * 12)),
      };
      if (penDown) draw(cursor, next);
      cursor = next;
    }
    render();
  });
  canvas.addEventListener('blur', () => {
    keyboardActive = false;
    penDown = false;
    render();
  });
  clear.addEventListener('click', () => {
    paint.clearRect(0, 0, drawing.width, drawing.height);
    status.textContent = 'مُسحت السبورة';
    render();
  });
} else {
  clear.disabled = true;
  ink.disabled = true;
  document.getElementById('board-help').textContent = 'الرسم غير متاح في هذا المتصفح.';
}
