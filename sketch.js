// READ THE ROOM — prototype v3 (Safari-safe, with on-page status line)
// Keys: C = set comfortable distance   D = debug numbers   S = show/hide status line

// ---------- TUNING ----------
const TUNING = {
    closeStart: 1.15, closeMax: 1.8,
    bodySpeedMin: 0.05, bodySpeedMax: 0.20,
    handSpeedMin: 0.08, handSpeedMax: 0.35,
    wProx: 0.45, wSpeed: 0.35, wHands: 0.30, wSide: 0.25,
    toUneasy: 0.55, toWarning: 0.85,
    holdMs: 500,
    cooldownMs: 1500,
    angryMs: 2000,
    happyMs: 2500,
    handScale: 1.0,
    noseSlow: 1.0,
  };
  
  // ---------- state ----------
  let bodyPose, video, dogSvg, musicBtn, statusEl;
  let modelState = 'loading';
  let poses = [];
  let feat = { prox: 0, speed: 0, hands: 0, side: 0, seen: false, sw: 0, wrists: { left: null, right: null } };
  let prevPts = null, baseShoulder = null, lastSeen = -9999;
  let smoothPts = {}, shownBase = 'relaxed', stateSince = 0;
  let stress = 0, mood = 'relaxed', alertOn = false, sniffing = false;
  let debug = false, flashMsg = '', flashUntil = 0, statusOn = true, lastErr = '';
  let grass = [], audioCtx = null;
  let evt = null, evtUntil = 0, noisyUntil = 0;
  let reactTimer, noiseTimer, cooldownUntil = 0;
  let lastMouseMove = -9999, pmx = 0, pmy = 0, mSpeed = 0;
  let hands = { left: newHand(), right: newHand() };
  
  function newHand() { return { x: 0, y: 0, px: 0, py: 0, vis: false, speed: 0, target: null, since: 0, fired: false }; }
  
  const INFO = {
    relaxed:   { label: 'Relaxed',  color: [92, 158, 98],  signals: ['Loose body, tail wagging', 'Soft eyes, calm face', 'Bell jingling gently'], tip: "You're calm and giving space. The dog feels comfortable." },
    alert:     { label: 'Alert',    color: [120, 150, 90], signals: ['Ears perked up', 'Head lifted, watching you', 'Tail slows down'], tip: 'The dog noticed you. Staying calm and still keeps it comfortable.' },
    uneasy:    { label: 'Uneasy',   color: [214, 150, 60], signals: ['Ears pinned back', 'Looking away, eyes wide', 'Tail low, mouth tight'], tip: 'The dog is unsure. Slow down, step back, or turn a little to the side.' },
    warning:   { label: 'Warning',  color: [196, 84, 72],  signals: ['Stiff body, hackles up', 'Tense brow, lips pulled back', 'Teeth showing'], tip: 'The dog wants space. Stay still, keep your hands down, then back away slowly.' },
    angry:     { label: 'Paw touched', color: [196, 84, 72], signals: ['Hackles up', 'Teeth showing', 'Brows pulled down'], tip: "Touching a dog's legs or paws can stress it. Let it come to you instead." },
    delighted: { label: 'Happy',    color: [92, 158, 98],  signals: ['Tail wagging fast', 'Ears relaxed, cheeks pink', 'Bouncy body'], tip: 'This dog is comfortable with you. With a real dog, let it sniff your hand first.' },
    noisy:     { label: 'Startled', color: [214, 150, 60], signals: ['Ears up, listening', 'Body low, tail tucked', 'Eyes wide, mouth worried'], tip: 'Loud sounds can scare dogs. Stay calm and give it space.' },
  };
  const CLASS_FOR = { relaxed: '', alert: 'is-alert', uneasy: 'is-uneasy', warning: 'is-angry', angry: 'is-angry', delighted: 'is-delighted' };
  const DARK = [52, 40, 38];
  
  // show any error on the page (no console needed)
  window.addEventListener('error', (e) => { lastErr = String(e.message || e); });
  window.addEventListener('unhandledrejection', (e) => { lastErr = String((e.reason && e.reason.message) || e.reason); });
  
  function setup() {
    const st = document.getElementById('status');
    st.textContent = 'setup started…';
    try {
      setupMain();
      st.textContent = 'setup finished, waiting for frames…';
    } catch (e) {
      st.textContent = 'SETUP ERROR: ' + e.message;
    }
  }
  function setupMain() {
    statusEl = document.getElementById('status');
    const cnv = createCanvas(windowWidth, windowHeight);
    cnv.elt.style.position = 'fixed';
    cnv.elt.style.top = '0';
    cnv.elt.style.left = '0';
    cnv.elt.style.zIndex = '10';
    cnv.elt.style.pointerEvents = 'none';
    cnv.elt.style.display = 'block';
    textFont('Helvetica');
  
    // webcam (Safari needs playsinline + muted)
    video = createCapture(VIDEO, { flipped: true });
    video.size(640, 480);
    video.hide();
    video.elt.setAttribute('playsinline', '');
    video.elt.setAttribute('muted', '');
    video.elt.muted = true;
    const pr = video.elt.play();
    if (pr && pr.catch) pr.catch(() => {});
  
    // body tracking model loads here (so a slow load never blocks the page)
    try {
      bodyPose = ml5.bodyPose('MoveNet', { flipped: true }, () => {
        modelState = 'ready';
        bodyPose.detectStart(video, gotPoses);
      });
    } catch (e) {
      modelState = 'FAILED: ' + e.message;
    }
  
    dogSvg = document.querySelector('.dog-portrait');
    musicBtn = document.getElementById('music-btn');
    musicBtn.addEventListener('click', makeNoise);
  
    // mouse / keyboard still work on the dog (backup for the camera)
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest) return;
      if (t.closest('.paw-trigger, .front-leg')) angerDog();
      else if (t.closest('.head-trigger')) delightDog();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest) {
        if (e.target.closest('.paw-trigger')) angerDog();
        else if (e.target.closest('.head-trigger')) delightDog();
      }
    });
  
    for (let i = 0; i < 140; i++) grass.push({ x: random(), y: random(), h: random(6, 16), a: random(-0.4, 0.4) });
    paintPark();
  }
  
  function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    paintPark();
  }
  
  function paintPark() {
    const pg = createGraphics(windowWidth, windowHeight);
    pg.pixelDensity(1);
    pg.background(196, 222, 170);
    pg.noStroke();
    pg.fill(176, 208, 150);
    pg.rect(0, pg.height * 0.62, pg.width, pg.height * 0.38);
    pg.stroke(120, 165, 100);
    pg.strokeWeight(2);
    for (const g of grass) {
      const x = g.x * pg.width, y = g.y * pg.height;
      pg.line(x, y, x + g.a * g.h, y - g.h);
      pg.line(x + 4, y, x + 4 - g.a * g.h, y - g.h * 0.8);
    }
    document.body.style.background = `url(${pg.elt.toDataURL()}) center / cover no-repeat`;
    pg.remove();
  }
  
  // ---------- body tracking ----------
  function kp(p, name) {
    const k = p.keypoints.find((k) => k.name === name);
    return k && k.confidence > 0.3 ? k : null;
  }
  function shoulderWidth(p) {
    const ls = kp(p, 'left_shoulder'), rs = kp(p, 'right_shoulder');
    return ls && rs ? dist(ls.x, ls.y, rs.x, rs.y) : 0;
  }
  function gotPoses(results) {
    poses = results;
    if (!results.length) { feat.seen = false; feat.wrists = { left: null, right: null }; return; }
    let p = results[0];
    for (const r of results) if (shoulderWidth(r) > shoulderWidth(p)) p = r;
    updateFeatures(p);
  }
  
  function updateFeatures(p) {
    const ls = kp(p, 'left_shoulder'), rs = kp(p, 'right_shoulder'), nose = kp(p, 'nose');
    if (!ls || !rs) { feat.seen = false; feat.wrists = { left: null, right: null }; return; }
    feat.seen = true;
    lastSeen = millis();
    feat.wrists = { left: kp(p, 'left_wrist'), right: kp(p, 'right_wrist') };
  
    const sw = dist(ls.x, ls.y, rs.x, rs.y);
    feat.sw = sw;
    if (baseShoulder === null) baseShoulder = video.width * 0.22;
    const proxT = constrain(map(sw / baseShoulder, TUNING.closeStart, TUNING.closeMax, 0, 1), 0, 1);
  
    const bodyNames = ['nose', 'left_shoulder', 'right_shoulder'];
    const handNames = ['left_wrist', 'right_wrist', 'left_elbow', 'right_elbow'];
    const cur = {};
    for (const n of bodyNames.concat(handNames)) {
        const k = kp(p, n);
        if (k) {
          const s = smoothPts[n];
          smoothPts[n] = s ? { x: lerp(s.x, k.x, 0.15), y: lerp(s.y, k.y, 0.15) } : { x: k.x, y: k.y };
          cur[n] = smoothPts[n];
        } else delete smoothPts[n];
    }
    let bodySum = 0, bodyN = 0, handSum = 0, handN = 0;
    if (prevPts) {
      for (const n in cur) {
        if (!prevPts[n]) continue;
        const d = max(0, dist(cur[n].x, cur[n].y, prevPts[n].x, prevPts[n].y) / sw - 0.03);
        if (handNames.includes(n)) { handSum += d; handN++; } else { bodySum += d; bodyN++; }
      }
    }
    prevPts = cur;
    const speedT = constrain(map(bodyN ? bodySum / bodyN : 0, TUNING.bodySpeedMin, TUNING.bodySpeedMax, 0, 1), 0, 1);
    const handT = constrain(map(handN ? handSum / handN : 0, TUNING.handSpeedMin, TUNING.handSpeedMax, 0, 1), 0, 1);
  
    let sideT = 0;
    if (nose) {
      const off = abs(nose.x - (ls.x + rs.x) / 2) / sw;
      sideT = constrain(map(off, 0.12, 0.35, 0, 1), 0, 1);
    }
    feat.prox = lerp(feat.prox, proxT, 0.3);
    feat.speed = lerp(feat.speed, speedT, 0.12);
    feat.hands = lerp(feat.hands, handT, 0.12);
    feat.side = lerp(feat.side, sideT, 0.2);
  }
  
  // ---------- dog reactions ----------
  function react(kind, ms) {
    evt = kind;
    evtUntil = millis() + ms;
    cooldownUntil = millis() + ms + TUNING.cooldownMs;
    dogSvg.setAttribute('class', 'dog-portrait ' + CLASS_FOR[kind]);
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => {
      evt = null;
      dogSvg.setAttribute('class', 'dog-portrait');
    }, ms);
  }
  function angerDog() { react('angry', TUNING.angryMs); }
  function delightDog() { react('delighted', TUNING.happyMs); }
  
  function makeNoise() {
    noisyUntil = millis() + 2000;
    evt = null;
    clearTimeout(reactTimer);
    dogSvg.setAttribute('class', 'dog-portrait');
    void dogSvg.getBoundingClientRect();
    dogSvg.setAttribute('class', 'dog-portrait is-noisy');
    clearTimeout(noiseTimer);
    noiseTimer = setTimeout(() => dogSvg.setAttribute('class', 'dog-portrait'), 2000);
    bang();
  }
  function bang() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const n = Math.floor(audioCtx.sampleRate * 0.35);
      const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const src = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.5;
      src.buffer = buf;
      src.connect(gain);
      gain.connect(audioCtx.destination);
      src.start(0);
    } catch (e) {}
  }
  
  // ---------- hands as cursors ----------
  function pad(r, p) { return { l: r.left - p, r: r.right + p, t: r.top - p, b: r.bottom + p }; }
  function inside(r, x, y) { return x >= r.l && x <= r.r && y >= r.t && y <= r.b; }
  
  function getZones() {
    const rect = (s) => document.querySelector(s).getBoundingClientRect();
    return {
      music: pad(musicBtn.getBoundingClientRect(), 20),
      nose: pad(rect('.nose'), 35),
      head: pad(rect('.head-fur'), 5),
      legs: Array.from(document.querySelectorAll('.front-leg, .paw-fill')).map((e) => pad(e.getBoundingClientRect(), 12)),
    };
  }
  function hitTest(x, y, z) {
    if (inside(z.music, x, y)) return 'music';
    if (inside(z.nose, x, y)) return 'nose';
    if (z.legs.some((r) => inside(r, x, y))) return 'leg';
    if (inside(z.head, x, y)) return 'head';
    return null;
  }
  
  function updateHands(present, dogW) {
    const dt = max(deltaTime, 1) / 1000;
    for (const side of ['left', 'right']) {
      const h = hands[side], w = feat.wrists[side];
      if (!present || !w) { h.vis = false; continue; }
      const tx = width / 2 + (w.x / video.width - 0.5) * width * TUNING.handScale;
      const ty = height / 2 + (w.y / video.height - 0.5) * height * TUNING.handScale;
      if (!h.vis) { h.x = tx; h.y = ty; h.px = tx; h.py = ty; }
      h.px = h.x; h.py = h.y;
      h.x = lerp(h.x, tx, 0.35);
      h.y = lerp(h.y, ty, 0.35);
      h.speed = lerp(h.speed, dist(h.x, h.y, h.px, h.py) / dt / dogW, 0.3);
      h.vis = true;
    }
  }
  
  function processHands(z, present) {
    let noseTouch = false, noseFast = false, musicHover = false;
    for (const side of ['left', 'right']) {
      const h = hands[side];
      if (!h.vis || !present) { h.target = null; h.fired = false; continue; }
      const t = hitTest(h.x, h.y, z);
      if (t !== h.target) { h.target = t; h.since = millis(); h.fired = false; }
      if (t === 'music') musicHover = true;
      if (t === 'nose') {
        if (h.speed < TUNING.noseSlow) noseTouch = true; else noseFast = true;
      } else if (t && !h.fired && millis() - h.since >= TUNING.holdMs) {
        h.fired = true;
        if (millis() < cooldownUntil && t !== 'music') continue;
        if (t === 'leg') angerDog();
        else if (t === 'head') delightDog();
        else if (t === 'music') makeNoise();
      }
    }
    if (millis() - lastMouseMove < 1200 && hitTest(mouseX, mouseY, z) === 'nose') {
      if (mSpeed < TUNING.noseSlow) noseTouch = true; else noseFast = true;
    }
    musicBtn.classList.toggle('hand-hover', musicHover);
    return { noseTouch, noseFast };
  }
  
  function mouseMoved() { lastMouseMove = millis(); }
  
  // ---------- main loop ----------
  function draw() {
    try {
      drawMain();
    } catch (e) {
      lastErr = 'draw: ' + e.message;
    }
    updateStatus();
  }
  
  function updateStatus() {
    if (!statusEl) return;
    statusEl.style.display = statusOn ? 'block' : 'none';
    if (!statusOn || frameCount % 10 !== 0) return;
    const vw = video && video.elt ? video.elt.videoWidth : 0;
    const vh = video && video.elt ? video.elt.videoHeight : 0;
    const present = feat.seen && millis() - lastSeen < 800;
    statusEl.textContent =
      'canvas OK · frame ' + frameCount +
      ' · camera ' + (vw ? vw + 'x' + vh : 'NOT RECEIVING VIDEO') +
      ' · model ' + modelState +
      ' · person ' + (present ? 'yes' : 'no') +
      (lastErr ? ' · ERROR: ' + lastErr : '');
  }
  
  function drawMain() {
    clear();
    const present = feat.seen && millis() - lastSeen < 800;
    const dogW = dogSvg.getBoundingClientRect().width;
  
    const md = dist(mouseX, mouseY, pmx, pmy);
    mSpeed = lerp(mSpeed, md / (max(deltaTime, 1) / 1000) / dogW, 0.3);
    pmx = mouseX; pmy = mouseY;
  
    const z = getZones();
    updateHands(present, dogW);
    const nose = processHands(z, present);
  
    let target = 0.05;
    if (present) {
      target = TUNING.wProx * feat.prox + TUNING.wSpeed * feat.speed + TUNING.wHands * feat.hands - TUNING.wSide * feat.side;
      target = constrain(target, 0, 1);
    }
    if (nose.noseFast) target = max(target, 0.5);
    sniffing = nose.noseTouch && mood !== 'warning';
    if (sniffing) { target = 0; stress = lerp(stress, 0, 0.06); }
  
    stress = lerp(stress, target, target > stress ? 0.03 : 0.015);
  
    if (mood === 'relaxed' && stress > TUNING.toUneasy) mood = 'uneasy';
    else if (mood === 'uneasy') {
      if (stress > TUNING.toWarning) mood = 'warning';
      else if (stress < TUNING.toUneasy - 0.08) mood = 'relaxed';
    } else if (mood === 'warning' && stress < TUNING.toWarning - 0.1) mood = 'uneasy';
  
    if (evt && millis() > evtUntil) evt = null;
    let base = evt || mood;
    if (base === 'relaxed') {
        alertOn = stress > (alertOn ? 0.25 : 0.4);
      if (alertOn && present) base = 'alert';
    }
    if (!evt) {
        if (base !== shownBase && millis() - stateSince < 1500) base = shownBase;
        else if (base !== shownBase) { shownBase = base; stateSince = millis(); }
      }
    const noisy = millis() < noisyUntil;
    const state = noisy ? 'noisy' : base;
  
    const want = noisy
      ? 'dog-portrait is-noisy'
      : ['dog-portrait', CLASS_FOR[base], sniffing ? 'is-sniff' : ''].filter(Boolean).join(' ');
    if (dogSvg.getAttribute('class') !== want) dogSvg.setAttribute('class', want);
  
    drawMoodPill(present, state);
    drawSignalsPanel(state);
    drawYouPanel(present);
    drawTip(present, state);
    drawCamera();
    drawHands(present);
    drawHelp();
    if (debug) drawDebug(target);
  }
  
  // ---------- interface ----------
  function panel(x, y, w, h) { noStroke(); fill(255, 255, 255, 225); rect(x, y, w, h, 16); }
  
  function drawMoodPill(present, state) {
    const info = INFO[state];
    const waiting = !present && state === 'relaxed';
    const label = waiting ? 'Waiting for you…' : info.label;
    textSize(24); textStyle(BOLD);
    const w = textWidth(label) + 48;
    noStroke();
    fill(waiting ? color(140) : color(...info.color));
    rect(width / 2 - w / 2, 34, w, 46, 23);
    fill(255); textAlign(CENTER, CENTER);
    text(label, width / 2, 57);
    textStyle(NORMAL);
  }
  
  function drawSignalsPanel(state) {
    const info = INFO[state];
    const x = 24, y = 100, w = 270, h = 170;
    panel(x, y, w, h);
    fill(DARK); textAlign(LEFT, TOP); textSize(16); textStyle(BOLD);
    text('What the dog is telling you', x + 18, y + 16);
    textStyle(NORMAL); textSize(15);
    info.signals.forEach((sig, i) => {
      fill(...info.color);
      ellipse(x + 24, y + 58 + i * 34, 9, 9);
      fill(DARK);
      text(sig, x + 38, y + 48 + i * 34, w - 50);
    });
  }
  
  function drawYouPanel(present) {
    const w = 270, h = 200, x = width - w - 24, y = 100;
    panel(x, y, w, h);
    fill(DARK); textAlign(LEFT, TOP); textSize(16); textStyle(BOLD);
    text("What you're doing", x + 18, y + 16);
    textStyle(NORMAL);
    const rows = [
      ['Distance', feat.prox, ['comfortable', 'close', 'very close']],
      ['Movement', feat.speed, ['calm', 'quick', 'sudden']],
      ['Hands', feat.hands, ['still', 'moving', 'waving']],
    ];
    rows.forEach((r, i) => {
      const ry = y + 50 + i * 42;
      const v = present ? r[1] : 0;
      const word = present ? r[2][v < 0.33 ? 0 : v < 0.66 ? 1 : 2] : '—';
      textSize(14); fill(DARK);
      text(r[0], x + 18, ry);
      textAlign(RIGHT, TOP); text(word, x + w - 18, ry); textAlign(LEFT, TOP);
      fill(225); rect(x + 18, ry + 20, w - 36, 7, 4);
      fill(v < 0.33 ? color(92, 158, 98) : v < 0.66 ? color(214, 150, 60) : color(196, 84, 72));
      rect(x + 18, ry + 20, (w - 36) * v, 7, 4);
    });
    const sy = y + 50 + 3 * 42;
    textSize(14); fill(DARK);
    text('Body', x + 18, sy);
    textAlign(RIGHT, TOP);
    text(present ? (feat.side > 0.5 ? 'turned sideways' : 'facing the dog') : '—', x + w - 18, sy);
    textAlign(LEFT, TOP);
  }
  
  function drawTip(present, state) {
    let msg = present || state !== 'relaxed' ? INFO[state].tip : 'Step in front of the camera to meet the dog.';
    if (sniffing) msg = 'Slow hand near the nose: the dog is sniffing and calming down.';
    textSize(18);
    const w = min(width - 48, textWidth(msg) + 60);
    const x = width / 2 - w / 2, y = height - 78;
    panel(x, y, w, 52);
    fill(DARK); textAlign(CENTER, CENTER);
    text(msg, width / 2, y + 26);
  }
  
  function drawCamera() {
    const w = 200, h = 150, x = width - w - 24, y = height - h - 100;
    push();
    noStroke(); fill(255);
    rect(x - 4, y - 4, w + 8, h + 8, 12);
    image(video, x, y, w, h);
    const sx = w / video.width, sy = h / video.height;
    fill(255, 120, 150);
    for (const p of poses) for (const k of p.keypoints) if (k.confidence > 0.3) ellipse(x + k.x * sx, y + k.y * sy, 6, 6);
    fill(DARK); textSize(12); textAlign(LEFT, TOP);
    text('You', x + 6, y + 6);
    pop();
  }
  
  function drawHands(present) {
    if (!present) return;
    push();
    for (const side of ['left', 'right']) {
      const h = hands[side];
      if (!h.vis) continue;
      stroke(255); strokeWeight(5); fill(255, 120, 150, 170);
      circle(h.x, h.y, 34);
      if (h.target && h.target !== 'nose' && !h.fired) {
        const f = constrain((millis() - h.since) / TUNING.holdMs, 0, 1);
        noFill(); stroke(255, 120, 150); strokeWeight(6);
        arc(h.x, h.y, 56, 56, -HALF_PI, -HALF_PI + TWO_PI * f);
      }
    }
    pop();
  }
  
  function drawHelp() {
    fill(DARK[0], DARK[1], DARK[2], 150);
    noStroke();
    textSize(12); textAlign(LEFT, BOTTOM);
    text('C: set comfortable distance   ·   D: debug   ·   S: hide status', 24, height - 16);
    if (millis() < flashUntil) {
      textSize(16); textAlign(CENTER, TOP); fill(DARK);
      text(flashMsg, width / 2, 88);
    }
  }
  
  function drawDebug(target) {
    const L = hands.left, R = hands.right;
    const lines = [
      'shoulder width: ' + feat.sw.toFixed(0) + 'px  (calibrated: ' + (baseShoulder ? baseShoulder.toFixed(0) : '-') + ')',
      'prox ' + feat.prox.toFixed(2) + '  speed ' + feat.speed.toFixed(2) + '  hands ' + feat.hands.toFixed(2) + '  side ' + feat.side.toFixed(2),
      'target ' + target.toFixed(2) + '  stress ' + stress.toFixed(2) + '  mood ' + mood,
      'L hand: ' + (L.vis ? L.target || 'none' : '-') + ' spd ' + L.speed.toFixed(2) + '   R hand: ' + (R.vis ? R.target || 'none' : '-') + ' spd ' + R.speed.toFixed(2),
    ];
    panel(24, 290, 470, 100);
    fill(DARK); textSize(12); textAlign(LEFT, TOP);
    lines.forEach((l, i) => text(l, 36, 302 + i * 20));
  }
  
  function keyPressed() {
    if (key === 'c' || key === 'C') {
      if (feat.seen && feat.sw > 0) { baseShoulder = feat.sw; flashMsg = 'Comfortable distance set'; }
      else flashMsg = 'Step into view first, then press C';
      flashUntil = millis() + 2000;
    }
    if (key === 'd' || key === 'D') debug = !debug;
    if (key === 's' || key === 'S') statusOn = !statusOn;
  }
  document.getElementById('status').textContent = 'sketch.js v3 is running';