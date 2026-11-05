(() => {
  const section = document.getElementById('cta-zoom');
  if (!section) return;

  const sticky = section.querySelector('.cta-zoom-sticky');
  const stage = section.querySelector('.cta-zoom-stage');
  const map = section.querySelector('.cta-zoom-map');
  const finale = section.querySelector('.cta-zoom-finale');
  const caption = section.querySelector('.cta-zoom-caption');
  const steps = [...section.querySelectorAll('.cta-zoom-step')];
  const stepLines = [...section.querySelectorAll('.cta-zoom-step-line i')];
  const focusWeek = section.querySelector('[data-zoom-focus]');
  const nov = section.querySelector('[data-zoom-month="nov"]');
  const dec = section.querySelector('[data-zoom-month="dec"]');
  const yearCard = section.querySelector('.cta-zoom-year');
  const pips = [...section.querySelectorAll('.cta-zoom-pips i')];
  const yearCount = section.querySelector('[data-zoom-year-count]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const captions = [
    'It starts with one day.',
    'Days add up to a week.',
    'Weeks add up to a month.',
    'Months add up to your year.'
  ];

  // Scroll progress (0-1) at which each beat happens.
  const T = {
    novWeeks: [0.06, 0.11, 0.15, 0.19],
    novDone: 0.23,
    decReveal: 0.27,
    decWeeks: [0.39, 0.43, 0.47, 0.51],
    decDone: 0.55,
    yearReveal: 0.59,
    pips: [0.69, 0.73],
    yearDone: 0.77,
    finale: 0.85,
    levels: [0.06, 0.12, 0.58],
    weekFocusEnd: 0.09
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let camera = null;
  let currentLevel = -1;
  let captionTimer = 0;
  let ticking = false;
  let celebrated = null;

  const rectWithin = (element) => {
    let x = 0;
    let y = 0;
    let node = element;
    while (node && node !== map) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return { x, y, w: element.offsetWidth, h: element.offsetHeight };
  };

  const union = (a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  // Camera keyframes: each frames a region of the map, from one week out to the whole year.
  const measure = () => {
    // Pin the closing CTA to the bottom of the stage so it never floats far below the map on tall screens.
    finale.style.bottom = 'auto';
    finale.style.top = `${stage.offsetTop + stage.offsetHeight - finale.offsetHeight - 8}px`;

    const mapW = map.offsetWidth;
    const mapH = map.offsetHeight;
    const availW = stage.clientWidth - 64;
    const availH = stage.clientHeight - 56;
    const finaleSpace = finale.offsetHeight + 28;

    const frame = (rect, fill, maxScale, heightCut = 0) => {
      const scale = Math.min(maxScale, (availW * fill) / rect.w, ((availH - heightCut) * fill) / rect.h);
      let oy = -heightCut / 2;
      // Lift short content toward the caption rather than leaving a gap above it.
      const top = stage.clientHeight / 2 - (rect.h * scale) / 2 + oy;
      if (!heightCut && top > 36) oy -= top - 36;
      return { scale, cx: rect.x + rect.w / 2 - mapW / 2, cy: rect.y + rect.h / 2 - mapH / 2, oy };
    };

    const novRect = rectWithin(nov);
    const monthsRect = union(novRect, rectWithin(dec));
    const fullRect = { x: 0, y: 0, w: mapW, h: mapH };

    const novFrame = frame(novRect, 0.92, 1.6);
    const weekFrame = frame(rectWithin(focusWeek), 0.6, 2.6);
    weekFrame.scale = Math.max(weekFrame.scale, novFrame.scale * 1.5);
    // Keep the November card's top edge just below the caption instead of centring the week in the stage.
    const novTopOnStage = stage.clientHeight / 2 + (novRect.y - mapH / 2 - weekFrame.cy) * weekFrame.scale;
    weekFrame.oy = novTopOnStage > 36 ? 36 - novTopOnStage : 0;
    const monthsFrame = frame(monthsRect, 0.94, novFrame.scale);
    const fullFrame = frame(fullRect, 0.94, monthsFrame.scale);
    const finalFrame = frame(fullRect, 0.94, fullFrame.scale, finaleSpace);

    camera = [
      [0.02, weekFrame],
      [0.2, novFrame],
      [0.33, monthsFrame],
      [0.57, monthsFrame],
      [0.68, fullFrame],
      [T.finale, finalFrame]
    ];
  };

  const cameraAt = (progress) => {
    if (progress <= camera[0][0]) return camera[0][1];
    for (let i = 1; i < camera.length; i += 1) {
      const [end, to] = camera[i];
      const [start, from] = camera[i - 1];
      if (progress <= end) {
        const t = ease((progress - start) / (end - start));
        return {
          scale: from.scale * Math.pow(to.scale / from.scale, t),
          cx: from.cx + (to.cx - from.cx) * t,
          cy: from.cy + (to.cy - from.cy) * t,
          oy: from.oy + (to.oy - from.oy) * t
        };
      }
    }
    return camera[camera.length - 1][1];
  };

  const setLevel = (level) => {
    if (level === currentLevel) return;
    const firstRender = currentLevel === -1;
    currentLevel = level;
    steps.forEach((step, index) => step.classList.toggle('is-reached', index <= level));
    window.clearTimeout(captionTimer);
    if (firstRender || reduceMotion.matches) {
      caption.textContent = captions[level];
      return;
    }
    caption.classList.add('is-swapping');
    captionTimer = window.setTimeout(() => {
      caption.textContent = captions[level];
      caption.classList.remove('is-swapping');
    }, 180);
  };

  const renderMonth = (month, schedule, doneAt, progress) => {
    const weeks = month.querySelectorAll('.cta-zoom-week');
    let done = 0;
    weeks.forEach((week, index) => {
      const isDone = progress >= schedule[index];
      week.classList.toggle('is-done', isDone);
      if (isDone) done += 1;
    });
    month.querySelector('.cta-zoom-bar i').style.setProperty('--fill', String(done / weeks.length));
    month.classList.toggle('is-done', progress >= doneAt);
  };

  const confettiColors = ['#dc4c3e', '#f2b84b', '#3fa66b', '#3d7bd9', '#9b59d0'];
  const launchConfetti = () => {
    const stickyRect = sticky.getBoundingClientRect();
    const cardRect = yearCard.getBoundingClientRect();
    const layer = document.createElement('span');
    layer.className = 'cta-zoom-confetti';
    layer.setAttribute('aria-hidden', 'true');
    [cardRect.left, cardRect.right].forEach((originX, side) => {
      for (let i = 0; i < 34; i += 1) {
        const piece = document.createElement('i');
        const angle = (40 + Math.random() * 45) * Math.PI / 180;
        const power = 160 + Math.random() * 200;
        piece.style.left = `${originX - stickyRect.left - 4}px`;
        piece.style.top = `${cardRect.bottom - stickyRect.top - 10}px`;
        piece.style.background = confettiColors[i % confettiColors.length];
        piece.style.setProperty('--dx', `${Math.cos(angle) * power * (side ? 1 : -1)}px`);
        piece.style.setProperty('--dy', `${-Math.sin(angle) * power}px`);
        piece.style.setProperty('--fall', `${80 + Math.random() * 140}px`);
        piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 800}deg`);
        piece.style.animationDelay = `${Math.random() * 150}ms`;
        piece.style.animationDuration = `${1400 + Math.random() * 800}ms`;
        layer.append(piece);
      }
    });
    sticky.append(layer);
    window.setTimeout(() => layer.remove(), 2800);
  };

  const render = () => {
    ticking = false;
    const enhanced = section.classList.contains('is-enhanced');
    if (enhanced && !camera) measure();

    let progress = 1;
    if (enhanced) {
      const stickyTop = parseFloat(getComputedStyle(sticky).top) || 0;
      const travel = section.offsetHeight - sticky.offsetHeight;
      progress = travel > 0 ? clamp((stickyTop - section.getBoundingClientRect().top) / travel, 0, 1) : 1;
      const view = cameraAt(progress);
      const tx = -view.cx * view.scale;
      const ty = -view.cy * view.scale + view.oy;
      map.style.transform = `translate(-50%, -50%) translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${view.scale.toFixed(4)})`;
    } else {
      map.style.transform = '';
    }

    setLevel(
      progress < T.levels[0] ? 0
        : progress < T.levels[1] ? 1
          : progress < T.levels[2] ? 2
            : 3
    );
    stepLines[0].style.setProperty('--fill', String(clamp(progress / T.levels[0], 0, 1)));
    stepLines[1].style.setProperty('--fill', String(clamp((progress - T.levels[0]) / (T.levels[1] - T.levels[0]), 0, 1)));
    if (stepLines[2]) {
      stepLines[2].style.setProperty('--fill', String(clamp((progress - T.levels[1]) / (T.levels[2] - T.levels[1]), 0, 1)));
    }

    renderMonth(nov, T.novWeeks, T.novDone, progress);
    renderMonth(dec, T.decWeeks, T.decDone, progress);

    const monthsDone = 10 + T.pips.filter(at => progress >= at).length;
    pips.forEach((pip, index) => {
      pip.classList.toggle('is-done', index < monthsDone);
      pip.classList.toggle('is-new', index >= 10 && index < monthsDone);
    });
    yearCount.textContent = String(monthsDone);

    const yearDone = progress >= T.yearDone;
    yearCard.classList.toggle('is-done', yearDone);
    if (celebrated === null) {
      celebrated = yearDone;
    } else if (yearDone && !celebrated) {
      celebrated = true;
      if (enhanced) launchConfetti();
    } else if (!yearDone && progress < T.yearDone - 0.03) {
      celebrated = false;
    }

    section.classList.toggle('is-week-focus', progress < T.weekFocusEnd);
    section.classList.toggle('show-dec', progress >= T.decReveal);
    section.classList.toggle('show-year', progress >= T.yearReveal);
    section.classList.toggle('is-past-start', progress > 0.03);
    section.classList.toggle('is-finale', progress >= T.finale);
  };

  const requestRender = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(render);
  };

  const applyMode = () => {
    section.classList.toggle('is-enhanced', !reduceMotion.matches);
    camera = null;
    currentLevel = -1;
    render();
  };

  window.addEventListener('scroll', requestRender, { passive: true });
  window.addEventListener('resize', () => {
    camera = null;
    requestRender();
  });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', applyMode);

  applyMode();
})();
