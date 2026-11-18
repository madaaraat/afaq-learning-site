(() => {
  const get = (name) => document.getElementById('media-' + name);
  const mode = get('mode');
  const preview = get('preview');
  const connect = get('connect');
  const end = get('end');
  const mic = get('mic');
  const camera = get('camera');
  const localVideo = get('local-video');
  const remoteVideo = get('remote-video');
  const remoteAudio = get('audio');
  const status = get('status');
  let session = null;

  const captureAvailable = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  const peerAvailable = typeof RTCPeerConnection === 'function';

  function updateControls() {
    const audio = session?.stream?.getAudioTracks()[0];
    const video = session?.stream?.getVideoTracks()[0];
    mode.disabled = Boolean(session) || !captureAvailable;
    preview.disabled = Boolean(session) || !captureAvailable;
    connect.disabled = !audio || Boolean(session?.sender) || !peerAvailable;
    end.disabled = !session;
    get('devices').hidden = !audio;
    get('local').hidden = !video;
    camera.hidden = !video;
    mic.setAttribute('aria-pressed', String(Boolean(audio?.enabled)));
    camera.setAttribute('aria-pressed', String(Boolean(video?.enabled)));
  }

  function stop(message) {
    const active = session;
    session = null;
    if (active) {
      clearTimeout(active.timeout);
      active.sender?.close();
      active.receiver?.close();
      active.stream?.getTracks().forEach((track) => track.stop());
      active.remote?.getTracks().forEach((track) => track.stop());
    }
    for (const element of [localVideo, remoteVideo, remoteAudio]) {
      element.srcObject = null;
    }
    get('remote').hidden = true;
    get('listen').hidden = true;
    status.textContent = message;
    updateControls();
  }

  preview.addEventListener('click', async () => {
    if (session || !captureAvailable) return;
    const video = mode.value === 'video';
    const active = {};
    session = active;
    status.textContent = 'بانتظار إذن المتصفح…';
    updateControls();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      if (session !== active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      active.stream = stream;
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (session === active) stop('توقف أحد الأجهزة. يمكنك بدء معاينة جديدة.');
        });
      }
      if (video) localVideo.srcObject = stream;
      status.textContent = video ? 'معاينة محلية بالكاميرا والميكروفون.' : 'معاينة محلية. الميكروفون جاهز.';
      if (!peerAvailable) status.textContent += ' اتصال WebRTC غير متاح في هذا المتصفح.';
      updateControls();
    } catch (error) {
      if (session !== active) return;
      const message = {
        NotAllowedError: 'رُفض إذن الوصول للأجهزة. راجع أذونات المتصفح ثم حاول مجدداً.',
        NotFoundError: 'لم يجد المتصفح ميكروفوناً أو كاميرا للوضع المختار.',
        NotReadableError: 'تعذّر تشغيل الجهاز. تحقق مما إذا كان مستخدَماً في تطبيق آخر.',
      }[error.name];
      stop(message ?? 'تعذّر بدء المعاينة. تحقق من الأجهزة وأذونات المتصفح.');
    }
  });

  connect.addEventListener('click', async () => {
    const active = session;
    if (!active?.stream || active.sender || !peerAvailable) return;
    const fail = () => {
      if (session === active) stop('تعذّر الاتصال التجريبي داخل الصفحة. ابدأ معاينة جديدة للمحاولة.');
    };

    try {
      // Exchange signaling and ICE candidates between the two peers in this page.
      const sender = active.sender = new RTCPeerConnection({ iceServers: [] });
      const receiver = active.receiver = new RTCPeerConnection({ iceServers: [] });
      const toSender = [];
      const toReceiver = [];
      const relay = (peer, queue) => ({ candidate }) => {
        if (!candidate || session !== active) return;
        if (peer.remoteDescription) peer.addIceCandidate(candidate).catch(fail);
        else queue.push(candidate);
      };
      sender.onicecandidate = relay(receiver, toReceiver);
      receiver.onicecandidate = relay(sender, toSender);
      active.remote = new MediaStream();
      receiver.ontrack = ({ track }) => {
        if (session !== active) return;
        active.remote.addTrack(track);
      };
      const reportConnection = () => {
        if (session !== active) return;
        const states = [sender.connectionState, receiver.connectionState];
        if (states.includes('failed')) {
          fail();
        } else if (states.every((state) => state === 'connected')) {
          clearTimeout(active.timeout);
          status.textContent = 'الاتصال التجريبي قائم داخل الصفحة.';
          remoteVideo.srcObject = active.remote;
          remoteAudio.srcObject = active.remote;
          get('remote').hidden = active.remote.getVideoTracks().length === 0;
          get('listen').hidden = false;
        } else if (states.includes('disconnected')) {
          status.textContent = 'انقطع الاتصال التجريبي مؤقتاً.';
          clearTimeout(active.timeout);
          active.timeout = setTimeout(fail, 15000);
        }
      };
      sender.onconnectionstatechange = reportConnection;
      receiver.onconnectionstatechange = reportConnection;
      status.textContent = 'جارٍ إنشاء الاتصال التجريبي…';
      updateControls();
      active.timeout = setTimeout(fail, 15000);

      for (const track of active.stream.getTracks()) sender.addTrack(track, active.stream);
      await sender.setLocalDescription(await sender.createOffer());
      await receiver.setRemoteDescription(sender.localDescription);
      await Promise.all(toReceiver.splice(0).map((candidate) => receiver.addIceCandidate(candidate)));
      await receiver.setLocalDescription(await receiver.createAnswer());
      await sender.setRemoteDescription(receiver.localDescription);
      await Promise.all(toSender.splice(0).map((candidate) => sender.addIceCandidate(candidate)));
    } catch {
      fail();
    }
  });

  function toggle(kind) {
    const track = session?.stream?.getTracks().find((item) => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    updateControls();
  }

  mic.addEventListener('click', () => toggle('audio'));
  camera.addEventListener('click', () => toggle('video'));
  end.addEventListener('click', () => {
    stop('انتهت التجربة وتوقفت مسارات الكاميرا والميكروفون.');
    preview.focus();
  });
  window.addEventListener('hashchange', () => {
    if (session && document.getElementById('classroom').hidden) stop('أُوقفت المعاينة عند مغادرة الفصل.');
  });
  window.addEventListener('pagehide', () => {
    if (session) stop('المعاينة متوقفة.');
  });

  if (!captureAvailable) {
    status.textContent = 'وصول المتصفح إلى الأجهزة غير متاح هنا. افتح العرض عبر localhost أو HTTPS في متصفح يدعم الوسائط.';
  }
  updateControls();
})();
