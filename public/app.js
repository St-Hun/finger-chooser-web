(() => {
  const stage = document.getElementById('stage');
  const circlesLayer = document.getElementById('circles');
  const participantTray = document.getElementById('participantTray');
  const statusEl = document.getElementById('status');
  const subStatusEl = document.getElementById('subStatus');
  const touchSupportEl = document.getElementById('touchSupport');
  const timerRing = document.getElementById('timerRing');

  const flowModeEl = document.getElementById('flowMode');
  const resultModeEl = document.getElementById('resultMode');
  const durationEl = document.getElementById('duration');
  const minFingersEl = document.getElementById('minFingers');
  const groupMaxEl = document.getElementById('groupMax');
  const stableHoldEl = document.getElementById('stableHold');

  const settingsBtn = document.getElementById('settingsBtn');
  const carouselPrevBtn = document.getElementById('carouselPrevBtn');
  const carouselNextBtn = document.getElementById('carouselNextBtn');
  const carouselCounter = document.getElementById('carouselCounter');

  const resetBtn = document.getElementById('resetBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const runRegisteredBtn = document.getElementById('runRegisteredBtn');
  const nextGroupBtn = document.getElementById('nextGroupBtn');
  const clearParticipantsBtn = document.getElementById('clearParticipantsBtn');

  const hues = [352, 28, 48, 87, 147, 176, 205, 241, 274, 314, 18, 118, 196, 260, 335];
  const colorWords = ['빨간', '주황', '노란', '라임', '초록', '청록', '파란', '남색', '보라', '분홍', '살구', '민트', '하늘', '자주', '장미'];
  const emojiWords = [
    ['🐳', '고래'], ['⚡', '번개'], ['👻', '유령'], ['🌵', '선인장'], ['🤖', '로봇'],
    ['🐯', '호랑이'], ['🥷', '닌자'], ['🌙', '달'], ['🐙', '문어'], ['🦊', '여우'],
    ['🦈', '상어'], ['🐧', '펭귄'], ['🐉', '용'], ['🛰️', '위성'], ['🚀', '로켓'],
    ['🦁', '사자'], ['🐢', '거북이'], ['🧊', '얼음'], ['🍀', '클로버'], ['🦄', '유니콘'],
    ['🦖', '공룡'], ['🎲', '주사위'], ['🧩', '퍼즐'], ['🍄', '버섯'], ['🦅', '독수리'],
    ['🐻', '곰'], ['🦋', '나비'], ['🛸', 'UFO'], ['🍋', '레몬'], ['🏝️', '섬']
  ];

  const activeTouches = new Map(); // id -> { id, x, y, hue, bornAt, participant?, preview? }
  const domCircles = new Map();
  const participants = [];
  let reviewCircles = []; // Frozen labels shown after a group is registered.

  let state = 'idle'; // idle | counting | result | registeredReview
  let animationFrame = 0;
  let countdownStartedAt = 0;
  let currentSignature = '';
  let winnerTouchId = null;
  let quickOrderMap = new Map();
  let participantWinnerId = null;
  let participantOrderMap = new Map();
  let lastVibeAt = 0;
  let quickColorCursor = 0;
  let orderSequence = [];
  let orderCarouselIndex = 0;

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function reportedMaxTouchPoints() {
    const reported = Number(navigator.maxTouchPoints ?? 0);
    return Number.isFinite(reported) && reported > 0 ? reported : 5;
  }

  function settings() {
    const supported = Math.max(1, Math.min(10, reportedMaxTouchPoints()));
    const requestedGroupMax = clampNumber(groupMaxEl.value, 1, 10, Math.min(5, supported));
    return {
      flowMode: flowModeEl.value,
      resultMode: resultModeEl.value,
      durationMs: clampNumber(durationEl.value, 1, 12, 3) * 1000,
      minFingers: clampNumber(minFingersEl.value, 2, 10, 2),
      groupMax: requestedGroupMax,
      supportedGroupMax: supported,
      stableHold: Boolean(stableHoldEl.checked),
    };
  }

  function setStatus(main, sub = '') {
    statusEl.textContent = main;
    subStatusEl.textContent = sub;
  }

  function vibrate(pattern) {
    if (typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch (_) { /* no-op */ }
    }
  }

  function seededRandomIndex(length) {
    const bytes = new Uint32Array(1);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return bytes[0] % length;
    }
    return Math.floor(Math.random() * length);
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = seededRandomIndex(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function makeParticipantById(id) {
    const hueIndex = (id - 1) % hues.length;
    const pair = emojiWords[(id - 1) % emojiWords.length];
    const colorWord = colorWords[hueIndex];
    return {
      id,
      hue: hues[hueIndex],
      colorWord,
      emoji: pair[0],
      noun: pair[1],
      label: `${colorWord} ${pair[1]}`,
    };
  }

  function makeNextParticipant() {
    return makeParticipantById(participants.length + 1);
  }

  function nextQuickHue() {
    const hue = hues[quickColorCursor % hues.length];
    quickColorCursor += 1;
    return hue;
  }

  function initialTouchHue() {
    return settings().flowMode === 'register' ? makeNextParticipant().hue : nextQuickHue();
  }

  function signature() {
    return Array.from(activeTouches.keys()).sort((a, b) => String(a).localeCompare(String(b))).join('|');
  }

  function orderedActiveEntries() {
    return Array.from(activeTouches.values()).sort((a, b) => a.bornAt - b.bornAt || String(a.id).localeCompare(String(b.id)));
  }

  function setFlowBody() {
    const s = settings();
    document.body.dataset.flow = s.flowMode;
    document.body.dataset.state = state;
    document.body.dataset.result = s.resultMode;
    runRegisteredBtn.classList.toggle('primary', participants.length > 0);
  }

  function updateSupportText() {
    const maxPoints = navigator.maxTouchPoints ?? 0;
    if (settings().flowMode === 'register') {
      touchSupportEl.textContent = `최대 지원값: ${maxPoints} · 현재 ${activeTouches.size} · 등록 ${participants.length}`;
    } else {
      touchSupportEl.textContent = `최대 지원값: ${maxPoints} · 현재 ${activeTouches.size}`;
    }
  }

  function viewportPointToStage(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function assignRegisterPreviews() {
    if (settings().flowMode !== 'register') return;
    const ordered = orderedActiveEntries();
    ordered.forEach((touch, idx) => {
      if (touch.participant) return;
      const preview = makeParticipantById(participants.length + idx + 1);
      touch.preview = preview;
      touch.hue = preview.hue;
    });
  }

  function syncTouchList(touchList) {
    if (state === 'result') return;

    const seen = new Set();
    const now = performance.now();

    for (const touch of Array.from(touchList)) {
      const id = `t-${touch.identifier}`;
      const point = viewportPointToStage(touch.clientX, touch.clientY);
      seen.add(id);
      const existing = activeTouches.get(id);
      if (existing) {
        existing.x = point.x;
        existing.y = point.y;
      } else if (state !== 'registeredReview') {
        activeTouches.set(id, {
          id,
          x: point.x,
          y: point.y,
          hue: initialTouchHue(),
          bornAt: now,
        });
      }
    }

    for (const id of Array.from(activeTouches.keys())) {
      if (!seen.has(id)) activeTouches.delete(id);
    }

    if (state === 'registeredReview') {
      const lifted = activeTouches.size === 0;
      nextGroupBtn.disabled = !lifted;
      if (lifted) {
        setStatus('이름표 확인 완료', '확인 후 다음 조 등록 버튼을 누르세요');
      } else {
        setStatus('이름표 확인 중', '손가락을 모두 떼면 다음 조 등록 버튼이 활성화됩니다');
      }
      render();
      return;
    }

    assignRegisterPreviews();
    maybeResetOnSignatureChange();
    render();
    updateGameState();
  }

  // Desktop/laptop fallback for quick testing. Real phone play uses Touch Events above.
  function syncPointerEvent(event, isDown) {
    if (window.TouchEvent && event.pointerType === 'touch') return;
    if (state === 'result') return;

    const id = `p-${event.pointerId}`;

    if (state === 'registeredReview') {
      if (!isDown) activeTouches.delete(id);
      nextGroupBtn.disabled = activeTouches.size !== 0;
      render();
      return;
    }

    if (isDown) {
      stage.setPointerCapture?.(event.pointerId);
      const existing = activeTouches.get(id);
      const point = viewportPointToStage(event.clientX, event.clientY);
      if (existing) {
        existing.x = point.x;
        existing.y = point.y;
      } else {
        activeTouches.set(id, {
          id,
          x: point.x,
          y: point.y,
          hue: initialTouchHue(),
          bornAt: performance.now(),
        });
      }
    } else {
      activeTouches.delete(id);
    }

    assignRegisterPreviews();
    maybeResetOnSignatureChange();
    render();
    updateGameState();
  }

  function maybeResetOnSignatureChange() {
    if (state !== 'counting') return;
    const s = settings();
    const sig = signature();
    if (s.stableHold && sig !== currentSignature) {
      countdownStartedAt = performance.now();
      currentSignature = sig;
      if (s.flowMode === 'register') {
        setStatus('다시 안정화 중', '손가락 구성이 바뀌어서 이 조 등록 카운트를 다시 시작합니다');
      } else {
        setStatus('다시 안정화 중', '손가락 구성이 바뀌어서 카운트를 다시 시작합니다');
      }
    }
  }

  function updateGameState() {
    const s = settings();
    if (state === 'result' || state === 'registeredReview') return;

    const count = activeTouches.size;

    if (s.flowMode === 'register') {
      if (count === 0) {
        stopCountdown(false);
        const guide = participants.length === 0 ? '첫 조가 화면에 손가락을 올리면 등록 카운트가 시작됩니다' : '다음 조가 손가락을 올리면 추가 등록됩니다';
        setStatus(`${participants.length}명 등록됨`, `${guide} · 한 조 최대 ${s.groupMax}명`);
        return;
      }
      if (count > s.groupMax) {
        stopCountdown(false);
        setStatus(`${count}개 인식 중`, `현재 한 조 최대값은 ${s.groupMax}명입니다. 설정을 올리거나 손가락 수를 줄여주세요`);
        return;
      }

      if (state === 'idle') startCountdown();
      return;
    }

    if (count < s.minFingers) {
      stopCountdown(false);
      const needed = s.minFingers - count;
      setStatus(`${count}개 인식 중`, `${needed}개 더 올리면 시작합니다`);
      return;
    }

    if (state === 'idle') startCountdown();
  }

  function startCountdown() {
    state = 'counting';
    countdownStartedAt = performance.now();
    currentSignature = signature();
    lastVibeAt = 0;
    document.body.classList.add('isCounting');
    tick();
  }

  function stopCountdown(clearText = true) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (state !== 'result' && state !== 'registeredReview') state = 'idle';
    document.body.classList.remove('isCounting');
    timerRing.style.setProperty('--timer-opacity', '0');
    timerRing.style.setProperty('--timer-scale', '0.9');
    if (clearText) {
      if (settings().flowMode === 'register') {
        setStatus(`${participants.length}명 등록됨`, `한 조 최대 ${settings().groupMax}명씩 손가락을 올려주세요`);
      } else {
        setStatus('모두 화면에 손가락을 올려주세요', '계속 누르고 있어야 참가됩니다');
      }
    }
    render();
  }

  function tick() {
    if (state !== 'counting') return;

    const s = settings();
    const now = performance.now();
    const elapsed = now - countdownStartedAt;
    const remaining = Math.max(0, s.durationMs - elapsed);
    const progress = Math.min(1, elapsed / s.durationMs);
    const seconds = Math.ceil(remaining / 1000);

    timerRing.style.setProperty('--timer-opacity', String(0.16 + progress * 0.44));
    timerRing.style.setProperty('--timer-scale', String(0.86 + progress * 0.32));

    if (s.flowMode === 'register') {
      setStatus(`${seconds}`, `${activeTouches.size}명 이 조에 등록 중 · 각자 원의 이름표를 확인하세요`);
    } else {
      setStatus(`${seconds}`, `${activeTouches.size}개 손가락 인식 중 · 떼지 말고 유지`);
    }

    if (now - lastVibeAt > 420) {
      vibrate([24]);
      lastVibeAt = now;
    }

    assignRegisterPreviews();
    render();

    if (remaining <= 0) {
      finishCountdown();
      return;
    }

    animationFrame = requestAnimationFrame(tick);
  }

  function finishCountdown() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    document.body.classList.remove('isCounting');
    timerRing.style.setProperty('--timer-opacity', '0');
    timerRing.style.setProperty('--timer-scale', '1.2');

    if (settings().flowMode === 'register') {
      registerActiveGroup();
    } else {
      finishQuickRound();
    }
  }

  function finishQuickRound() {
    state = 'result';
    const entries = orderedActiveEntries();
    if (entries.length === 0) {
      resetCurrentTouches();
      return;
    }

    if (settings().resultMode === 'order') {
      quickOrderMap = new Map();
      shuffle(entries).forEach((touch, idx) => quickOrderMap.set(touch.id, idx + 1));
      winnerTouchId = null;
      setStatus('순서 결정', '원 안의 숫자가 플레이 순서입니다');
      vibrate([60, 40, 60, 40, 120]);
    } else {
      quickOrderMap = new Map();
      winnerTouchId = entries[seededRandomIndex(entries.length)].id;
      setStatus('선택 완료', '크게 빛나는 원이 선택되었습니다');
      vibrate([80, 50, 180]);
    }

    render();
  }

  function registerActiveGroup() {
    assignRegisterPreviews();
    const entries = orderedActiveEntries().slice(0, settings().groupMax);
    if (entries.length === 0) {
      resetCurrentTouches();
      return;
    }

    reviewCircles = [];
    for (const touch of entries) {
      const participant = touch.preview ?? makeParticipantById(participants.length + 1);
      participants.push(participant);
      touch.participant = participant;
      touch.hue = participant.hue;
      reviewCircles.push({
        id: `review-${participant.id}`,
        x: touch.x,
        y: touch.y,
        hue: participant.hue,
        bornAt: touch.bornAt,
        participant,
        review: true,
      });
    }

    state = 'registeredReview';
    participantWinnerId = null;
    participantOrderMap = new Map();
    orderSequence = [];
    orderCarouselIndex = 0;
    nextGroupBtn.disabled = activeTouches.size !== 0;
    setStatus(`${entries.length}명 등록 완료`, `각자 이름표를 확인하세요 · 총 ${participants.length}명 등록됨`);
    vibrate([70, 40, 110]);
    render();
  }

  function runRegisteredResult() {
    if (settings().flowMode !== 'register') return;
    if (participants.length === 0) {
      setStatus('등록된 사람이 없습니다', '먼저 한 조씩 손가락을 올려 참가자를 등록하세요');
      return;
    }

    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    state = 'result';
    activeTouches.clear();
    reviewCircles = [];
    winnerTouchId = null;
    quickOrderMap = new Map();
    timerRing.style.setProperty('--timer-opacity', '0');
    timerRing.style.setProperty('--timer-scale', '0.9');

    if (settings().resultMode === 'order') {
      participantWinnerId = null;
      participantOrderMap = new Map();
      orderSequence = shuffle(participants);
      orderSequence.forEach((p, idx) => participantOrderMap.set(p.id, idx + 1));
      orderCarouselIndex = 0;
      setStatus('전체 순서 결정', '좌우 화면을 툭 터치해서 순서를 넘겨보세요');
      vibrate([60, 40, 60, 40, 120]);
    } else {
      orderSequence = [];
      orderCarouselIndex = 0;
      participantOrderMap = new Map();
      participantWinnerId = participants[seededRandomIndex(participants.length)].id;
      const winner = participants.find(p => p.id === participantWinnerId);
      setStatus(`${winner.id}번 ${winner.emoji} ${winner.label}`, '선택 완료');
      vibrate([80, 50, 180]);
    }

    render();
  }

  function render() {
    renderCircles();
    renderParticipants();
    updateSupportText();
    setFlowBody();
  }

  function renderCircles() {
    assignRegisterPreviews();
    const visibleCircles = state === 'registeredReview' ? [...reviewCircles] : [...activeTouches.values()];
    const activeIds = new Set(visibleCircles.map(t => t.id));

    for (const id of Array.from(domCircles.keys())) {
      if (!activeIds.has(id)) {
        domCircles.get(id).remove();
        domCircles.delete(id);
      }
    }

    for (const touch of visibleCircles) {
      let el = domCircles.get(touch.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'fingerCircle';
        el.innerHTML = '<span class="circleMain"></span><span class="circleSub"></span>';
        circlesLayer.appendChild(el);
        domCircles.set(touch.id, el);
      }

      el.style.setProperty('--x', `${touch.x}px`);
      el.style.setProperty('--y', `${touch.y}px`);
      el.style.setProperty('--h', String(touch.hue));

      const isQuickWinner = state === 'result' && touch.id === winnerTouchId;
      const quickOrder = quickOrderMap.get(touch.id);
      const participant = touch.participant;
      const preview = touch.preview;
      const shouldDim = state === 'result' && winnerTouchId !== null && touch.id !== winnerTouchId;

      el.classList.toggle('counting', state === 'counting');
      el.classList.toggle('winner', isQuickWinner);
      el.classList.toggle('dimmed', shouldDim);
      el.classList.toggle('ordered', state === 'result' && quickOrderMap.has(touch.id));
      el.classList.toggle('registered', Boolean(touch.review));

      const main = el.querySelector('.circleMain');
      const sub = el.querySelector('.circleSub');

      if (quickOrder) {
        main.textContent = String(quickOrder);
        sub.textContent = '';
      } else if (isQuickWinner) {
        main.textContent = '✓';
        sub.textContent = '';
      } else if (participant) {
        main.textContent = participant.emoji;
        sub.textContent = `${participant.id}번 ${participant.label}`;
      } else if (preview) {
        main.textContent = preview.emoji;
        sub.textContent = `${preview.id}번 ${preview.label}`;
      } else {
        main.textContent = '';
        sub.textContent = '';
      }
    }
  }

  function isOrderCarouselActive() {
    return settings().flowMode === 'register' && state === 'result' && settings().resultMode === 'order' && participantOrderMap.size > 0;
  }

  function currentOrderSequence() {
    if (orderSequence.length > 0) return orderSequence;
    if (participantOrderMap.size > 0) {
      return [...participants].sort((a, b) => (participantOrderMap.get(a.id) ?? 9999) - (participantOrderMap.get(b.id) ?? 9999));
    }
    return participants;
  }

  function clampCarouselIndex() {
    const seq = currentOrderSequence();
    if (seq.length === 0) {
      orderCarouselIndex = 0;
      return;
    }
    orderCarouselIndex = Math.min(seq.length - 1, Math.max(0, orderCarouselIndex));
  }

  function moveOrderCarousel(delta) {
    if (!isOrderCarouselActive()) return;
    const seq = currentOrderSequence();
    if (seq.length === 0) return;
    orderCarouselIndex = (orderCarouselIndex + delta + seq.length) % seq.length;
    renderParticipants();
  }

  function renderParticipants() {
    participantTray.innerHTML = '';
    const carouselActive = isOrderCarouselActive();
    participantTray.classList.toggle('resultCarousel', carouselActive);

    const list = carouselActive ? currentOrderSequence() : participants;
    if (carouselActive) clampCarouselIndex();

    for (let idx = 0; idx < list.length; idx++) {
      const p = list[idx];
      const card = document.createElement('div');
      card.className = 'participantCard';
      card.style.setProperty('--h', String(p.hue));

      const order = participantOrderMap.get(p.id);
      const selected = participantWinnerId === p.id;
      card.classList.toggle('selected', selected);
      card.classList.toggle('dimmed', state === 'result' && participantWinnerId !== null && !selected);
      card.classList.toggle('ordered', state === 'result' && participantOrderMap.has(p.id));

      if (carouselActive) {
        const diff = idx - orderCarouselIndex;
        if (diff === 0) card.classList.add('carouselCurrent');
        else if (diff === -1) card.classList.add('carouselPrev');
        else if (diff === 1) card.classList.add('carouselNext');
        else if (diff < -1) card.classList.add('carouselHiddenLeft');
        else card.classList.add('carouselHiddenRight');
      }

      if (carouselActive) {
        const orderNo = order ?? idx + 1;
        card.innerHTML = `
          <div class="orderCardTop">
            <span class="orderChip">${orderNo}번째 순서</span>
            <span class="participantMini">참가자 ${p.id}번</span>
          </div>
          <div class="orderHero">
            <div class="participantDot">${p.emoji}</div>
            <div class="participantText">
              <span class="participantName">${p.colorWord} ${p.noun}</span>
              <span class="participantNo">${p.colorWord} 팀 카드</span>
            </div>
          </div>
          <div class="bigOrderNumber">${orderNo}</div>
          <div class="orderHint">좌우 화면을 터치해서 넘기기</div>
        `;
      } else {
        card.innerHTML = `
          <div class="participantDot">${p.emoji}</div>
          <div class="participantText">
            <span class="participantNo">${p.id}번</span>
            <span class="participantName">${p.colorWord} ${p.noun}</span>
          </div>
          ${order ? `<span class="resultBadge">${order}번</span>` : ''}
          ${selected ? '<span class="resultBadge">선택</span>' : ''}
        `;
      }

      participantTray.appendChild(card);
    }

    if (carouselActive && carouselCounter) {
      carouselCounter.textContent = `${orderCarouselIndex + 1} / ${list.length}`;
    } else if (carouselCounter) {
      carouselCounter.textContent = '';
    }

    runRegisteredBtn.disabled = participants.length === 0 || state === 'registeredReview';
    clearParticipantsBtn.disabled = participants.length === 0;
    nextGroupBtn.disabled = state === 'registeredReview' ? activeTouches.size !== 0 : true;
  }

  function resetCurrentTouches() {
    state = 'idle';
    winnerTouchId = null;
    quickOrderMap = new Map();
    participantWinnerId = null;
    participantOrderMap = new Map();
    activeTouches.clear();
    reviewCircles = [];
    currentSignature = '';
    quickColorCursor = 0;
    orderSequence = [];
    orderCarouselIndex = 0;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    vibrate(0);
    for (const el of domCircles.values()) el.remove();
    domCircles.clear();
    timerRing.style.setProperty('--timer-opacity', '0');
    timerRing.style.setProperty('--timer-scale', '0.9');

    if (settings().flowMode === 'register') {
      setStatus(`${participants.length}명 등록됨`, `한 조 최대 ${settings().groupMax}명씩 손가락을 올려주세요`);
    } else {
      setStatus('모두 화면에 손가락을 올려주세요', '계속 누르고 있어야 참가됩니다');
    }
    render();
  }

  function nextGroup() {
    if (state !== 'registeredReview') return;
    if (activeTouches.size !== 0) {
      setStatus('아직 손가락이 남아 있습니다', '모두 손가락을 떼면 다음 조로 넘어갈 수 있습니다');
      return;
    }
    reviewCircles = [];
    state = 'idle';
    currentSignature = '';
    setStatus('다음 조를 올려주세요', `${participants.length}명 등록됨 · 한 조 최대 ${settings().groupMax}명`);
    render();
  }

  function clearParticipants() {
    participants.length = 0;
    resetCurrentTouches();
  }

  function preventNativeGestures(event) {
    if (event.cancelable) event.preventDefault();
  }

  stage.addEventListener('touchstart', (event) => {
    preventNativeGestures(event);
    syncTouchList(event.touches);
  }, { passive: false });

  stage.addEventListener('touchmove', (event) => {
    preventNativeGestures(event);
    syncTouchList(event.touches);
  }, { passive: false });

  stage.addEventListener('touchend', (event) => {
    preventNativeGestures(event);
    syncTouchList(event.touches);
  }, { passive: false });

  stage.addEventListener('touchcancel', (event) => {
    preventNativeGestures(event);
    syncTouchList(event.touches);
  }, { passive: false });

  stage.addEventListener('pointerdown', (event) => {
    preventNativeGestures(event);
    syncPointerEvent(event, true);
  });
  stage.addEventListener('pointermove', (event) => {
    preventNativeGestures(event);
    if (activeTouches.has(`p-${event.pointerId}`)) syncPointerEvent(event, true);
  });
  stage.addEventListener('pointerup', (event) => {
    preventNativeGestures(event);
    syncPointerEvent(event, false);
  });
  stage.addEventListener('pointercancel', (event) => {
    preventNativeGestures(event);
    syncPointerEvent(event, false);
  });

  function enableTrayDragScroll() {
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    const start = (clientX) => {
      dragging = true;
      startX = clientX;
      startScrollLeft = participantTray.scrollLeft;
      participantTray.classList.add('dragging');
    };
    const move = (clientX) => {
      if (!dragging) return;
      participantTray.scrollLeft = startScrollLeft - (clientX - startX);
    };
    const end = () => {
      dragging = false;
      participantTray.classList.remove('dragging');
    };

    participantTray.addEventListener('touchstart', (event) => {
      event.stopPropagation();
      if (event.touches.length > 0) start(event.touches[0].clientX);
    }, { passive: true });

    participantTray.addEventListener('touchmove', (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      if (event.touches.length > 0) move(event.touches[0].clientX);
    }, { passive: false });

    participantTray.addEventListener('touchend', (event) => {
      event.stopPropagation();
      end();
    }, { passive: true });

    participantTray.addEventListener('touchcancel', (event) => {
      event.stopPropagation();
      end();
    }, { passive: true });

    participantTray.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') return;
      event.stopPropagation();
      participantTray.setPointerCapture?.(event.pointerId);
      start(event.clientX);
    });
    participantTray.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      if (!dragging) return;
      event.stopPropagation();
      move(event.clientX);
    });
    participantTray.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch') return;
      event.stopPropagation();
      end();
    });
    participantTray.addEventListener('pointercancel', (event) => {
      if (event.pointerType === 'touch') return;
      event.stopPropagation();
      end();
    });
  }

  for (const el of [flowModeEl, resultModeEl, durationEl, minFingersEl, groupMaxEl, stableHoldEl]) {
    el.addEventListener('change', () => {
      resetCurrentTouches();
      setFlowBody();
      if (settings().flowMode === 'register' && participants.length > 0) {
        setStatus(`${participants.length}명 등록됨`, '등록자 실행을 누르면 전체 참가자 중에서 결과를 정합니다');
      }
    });
  }

  settingsBtn.addEventListener('click', () => {
    const opened = !document.body.classList.contains('settings-open');
    document.body.classList.toggle('settings-open', opened);
    settingsBtn.setAttribute('aria-expanded', opened ? 'true' : 'false');
  });

  carouselPrevBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    moveOrderCarousel(-1);
  });
  carouselNextBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    moveOrderCarousel(1);
  });

  resetBtn.addEventListener('click', resetCurrentTouches);
  clearParticipantsBtn.addEventListener('click', clearParticipants);
  runRegisteredBtn.addEventListener('click', runRegisteredResult);
  nextGroupBtn.addEventListener('click', nextGroup);

  fullscreenBtn.addEventListener('click', async () => {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;

    if (!request) {
      setStatus('iPhone 전체화면 안내', 'Safari 하단 공유 버튼 → 홈 화면에 추가 → Open as Web App 켜기 → 홈 화면 아이콘으로 실행하세요');
      return;
    }

    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) await request.call(el);
      else if (exit) await exit.call(document);
    } catch (_) {
      setStatus('iPhone 전체화면 안내', 'Safari 공유 버튼 → 홈 화면에 추가 → Open as Web App 켜기 → 홈 화면 아이콘으로 다시 열어주세요');
    }
  });

  // Avoid iOS Safari double-tap zoom on controls as much as possible.
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300 && event.cancelable) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  enableTrayDragScroll();
  resetCurrentTouches();
})();
