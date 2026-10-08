(() => {
  const data = JSON.parse(document.querySelector('#landing-data').textContent)[0];
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storedTheme = localStorage.getItem('bitwardenagents-landing-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let locale = localStorage.getItem('bitwardenagents-landing-locale') || (navigator.language.startsWith('zh') ? 'zh' : 'en');

  const t = (path) => path.split('.').reduce((v, k) => v?.[k], data[locale]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  /* ---------------- one-shot SVG page intro ---------------- */

  const pageIntro = document.querySelector('#page-intro');
  const pageIntroLogo = document.querySelector('#page-intro-logo');
  let introRun = 0;

  function replayPageIntro() {
    if (!pageIntro || !pageIntroLogo || reduced) return Promise.resolve();
    introRun += 1;
    pageIntroLogo.src = `./assets/brand-logo-intro.svg#run-${introRun}`;
    pageIntro.classList.add('is-active');
    return sleep(2180).then(() => {
      pageIntro.classList.remove('is-active');
      return sleep(220);
    });
  }

  if (reduced) {
    pageIntro?.classList.remove('is-active');
    root.classList.remove('landing-boot');
  } else {
    pageIntro?.classList.add('is-active');
    window.setTimeout(() => {
      pageIntro?.classList.remove('is-active');
      root.classList.remove('landing-boot');
    }, 2300);
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"], a[data-page-transition]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    const target = href.startsWith('#') ? document.querySelector(href) : null;
    if ((href.startsWith('#') && !target) || reduced) return;
    event.preventDefault();
    replayPageIntro().then(() => {
      if (target) {
        history.pushState(null, '', href);
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else {
        window.location.assign(link.href);
      }
    });
  });

  /* ---------------- theme / language ---------------- */

  function setTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem('bitwardenagents-landing-theme', theme);
  }

  function renderLanguage() {
    root.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = data[locale].meta.title;
    document.querySelector('meta[name="description"]').content = data[locale].meta.description;
    document.querySelectorAll('[data-copy]').forEach((node) => {
      const value = t(node.dataset.copy);
      if (value != null && typeof value !== 'object') node.textContent = value;
    });
    document.querySelectorAll('[data-copy-label]').forEach((button) => {
      button.textContent = t(button.dataset.copyLabel);
    });
    document.querySelector('#language-toggle').textContent = locale === 'zh' ? 'EN' : '中';
    document.querySelector('#language-toggle').setAttribute('aria-label', data[locale].nav.language);
    document.querySelector('#theme-toggle').setAttribute('aria-label', data[locale].nav.theme);
    renderVault();
    if (vaultPlayed || reduced) vaultFinalState();
    renderVaultBridge();
    renderFlow();
    renderPanels();
    renderChips();
    theaterMode = 'dry';
    syncTheaterControls();
    theaterRun(true);
    playgroundRun(activeGroup, { instant: true });
  }

  setTheme(storedTheme || (preferredDark ? 'dark' : 'light'));

  document.querySelector('#theme-toggle').addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  document.querySelector('#language-toggle').addEventListener('click', () => {
    locale = locale === 'zh' ? 'en' : 'zh';
    localStorage.setItem('bitwardenagents-landing-locale', locale);
    renderLanguage();
  });

  document.querySelectorAll('[data-copy-command]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.copyCommand;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      button.textContent = t(button.dataset.copyDone);
      button.classList.add('done');
      window.setTimeout(() => {
        button.textContent = t(button.dataset.copyLabel);
        button.classList.remove('done');
      }, 1400);
    });
  });

  /* ---------------- scroll progress + reveal ---------------- */

  if (!reduced && 'IntersectionObserver' in window) {
    root.classList.add('motion-ready');
    const revealIO = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealIO.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    document.querySelectorAll('[data-reveal]').forEach((node) => revealIO.observe(node));
  }

  /* ---------------- vault window (hero) ---------------- */

  const RING_R = 21;
  const RING_C = 2 * Math.PI * RING_R;
  const HEALTH_SCORE = 87;
  let vaultGen = 0;
  let vaultVisible = false;
  let vaultPlayed = false;

  function renderVault() {
    const w = t('heroWindow');
    const host = document.querySelector('#vault-window');
    if (!host) return;
    host.innerHTML = '';

    const bar = el('div', 'vault-titlebar');
    bar.append(el('span'), el('span'), el('span'), el('strong', null, esc(w.windowTitle)), el('em', 'vault-demo-badge', esc(w.demoBadge)));

    const side = el('aside', 'vault-sidebar');
    side.append(el('p', 'vault-sidebar-title', esc(w.sidebarTitle)));
    w.folders.forEach((folder, i) => {
      const node = el('div', 'vault-folder' + (i === 0 ? ' active' : ''));
      node.style.setProperty('--f', i);
      node.innerHTML = `<span>${esc(folder.name)}</span><em>${folder.count}</em>`;
      side.append(node);
    });

    const main = el('div', 'vault-main');
    const health = el('div', 'vault-health');
    health.innerHTML = `
      <svg class="health-ring" viewBox="0 0 52 52" aria-hidden="true">
        <circle class="track" cx="26" cy="26" r="${RING_R}" fill="none" stroke-width="4"/>
        <circle class="fill" cx="26" cy="26" r="${RING_R}" fill="none" stroke-width="4"
          stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
      </svg>
      <div class="health-copy">
        <strong>${esc(w.healthLabel)} <span class="score-num">0</span>/100</strong>
        <small>${esc(w.healthCmd)}</small>
      </div>`;

    const list = el('ul', 'vault-list');
    w.items.forEach((item, i) => {
      const row = el('li', 'vault-row');
      row.style.setProperty('--i', i);
      if (item.flag) row.dataset.flag = item.flag;
      row.innerHTML = `
        <span class="vault-avatar">${esc(item.site[0].toUpperCase())}</span>
        <span class="vault-id"><strong>${esc(item.site)}</strong><span>${esc(item.user)}</span></span>
        ${item.flag ? `<em class="vault-flag">${esc(w.flags[item.flag])}</em>` : '<span class="vault-mask">••••••••</span>'}`;
      list.append(row);
    });

    const status = el('div', 'vault-status');
    status.innerHTML = `
      <span class="state"><span class="status-dot"></span><span class="status-text">${esc(w.scanScanning)}</span></span>
      <span class="note">${esc(w.maskNote)}</span>`;

    main.append(health, list, status);
    const body = el('div', 'vault-body');
    body.append(side, main);
    host.append(bar, body);
  }

  function vaultFinalState() {
    const host = document.querySelector('#vault-window');
    const fill = host.querySelector('.health-ring .fill');
    const rows = [...host.querySelectorAll('.vault-row')];
    host.querySelector('.score-num').textContent = HEALTH_SCORE;
    fill.style.strokeDashoffset = RING_C * (1 - HEALTH_SCORE / 100);
    const dupes = rows.filter((r) => r.dataset.flag === 'dupe');
    dupes.forEach((row) => row.classList.add('dupe'));
    const status = host.querySelector('.vault-status');
    status.querySelector('.status-text').textContent = t('heroWindow.scanReady');
    status.querySelector('.status-dot').classList.add('ready');
  }

  async function vaultLoop() {
    const gen = ++vaultGen;
    const w = t('heroWindow');
    const host = document.querySelector('#vault-window');
    const fill = host.querySelector('.health-ring .fill');
    const score = host.querySelector('.score-num');
    const statusText = host.querySelector('.status-text');
    const dot = host.querySelector('.status-dot');
    const rows = [...host.querySelectorAll('.vault-row')];
    const dupes = rows.filter((r) => r.dataset.flag === 'dupe');

    if (gen === vaultGen && host.isConnected && vaultVisible) {
      rows.forEach((r) => r.classList.remove('scanned', 'dupe', 'kept', 'merging'));
      dot.classList.remove('ok', 'ready');
      statusText.textContent = w.scanScanning;
      fill.style.strokeDashoffset = RING_C;
      score.textContent = '0';
      await sleep(700);
      if (gen !== vaultGen) return;

      const start = performance.now();
      const dur = reduced ? 0 : 1400;
      await new Promise((resolve) => {
        const tick = (now) => {
          if (gen !== vaultGen) return resolve();
          const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          score.textContent = Math.round(HEALTH_SCORE * eased);
          fill.style.strokeDashoffset = RING_C * (1 - (HEALTH_SCORE / 100) * eased);
          if (p < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      if (gen !== vaultGen) return;

      statusText.textContent = w.scanScanning;
      for (const row of rows) {
        if (gen !== vaultGen) return;
        row.classList.add('scanned');
        await sleep(reduced ? 0 : 300);
        row.classList.remove('scanned');
        await sleep(reduced ? 0 : 90);
      }

      await sleep(260);
      if (gen !== vaultGen) return;
      dupes.forEach((r) => r.classList.add('dupe'));
      statusText.textContent = w.scanFound;
      await sleep(reduced ? 0 : 900);
      if (gen !== vaultGen) return;
      statusText.textContent = w.scanReady;
      dot.classList.add('ready');
    }
  }

  function watchVault() {
    const host = document.querySelector('#vault-frame');
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const was = vaultVisible;
        vaultVisible = entry.isIntersecting;
        if (vaultVisible && !was && !vaultPlayed) {
          vaultPlayed = true;
          vaultLoop();
        }
      }
    }, { threshold: 0.25 });
    io.observe(host);
  }

  /* ---------------- native vault + agent access ---------------- */

  let bridgeTypeId = '/not-initialized';
  let bridgeInterfaceId = 'agent';
  let bridgeAnimation = 0;
  let bridgeTourTimer = 0;
  let bridgeTourStarted = false;
  let bridgeUserControlled = false;
  let threeVault = null;

  function initThreeVault() {
    const canvas = document.querySelector('#vault-scene');
    const universe = document.querySelector('#vault-universe');
    const THREE = window.THREE;
    if (!canvas || !universe || !THREE || reduced || threeVault) return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      canvas.classList.add('is-unavailable');
      return;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch {
      canvas.classList.add('is-unavailable');
      return;
    }
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.z = 6.8;
    const group = new THREE.Group();
    scene.add(group);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.05, 1),
      new THREE.MeshPhysicalMaterial({ color: 0x0969ff, emissive: 0x042d73, emissiveIntensity: .85, metalness: .32, roughness: .18, transmission: .08, wireframe: true, transparent: true, opacity: .8 })
    );
    group.add(core);
    [1.62, 2.12].forEach((radius, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, .012, 8, 110),
        new THREE.MeshBasicMaterial({ color: index === 1 ? 0x21d4fd : 0x3485ff, transparent: true, opacity: .38 - index * .06 })
      );
      ring.rotation.set(index * .7 + .35, index * .45, index * .85);
      group.add(ring);
    });

    const particleCount = 48;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.45 + Math.random() * 1.65;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - .5) * 3.6;
      positions[i * 3 + 2] = Math.sin(angle) * radius * .45;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0x35c7ff, size: .026, transparent: true, opacity: .6 }));
    group.add(particles);

    const pointer = { x: 0, y: 0 };
    universe.addEventListener('pointermove', (event) => {
      const rect = universe.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - .5) * .36;
      pointer.y = ((event.clientY - rect.top) / rect.height - .5) * .22;
    });
    universe.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.position.z = rect.width < 600 ? 8.5 : 6.8;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(universe);
    resize();

    const state = { visible: true, energy: 0, lastFrame: 0 };
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (!state.visible || document.hidden || window.innerWidth <= 767 || now - state.lastFrame < 33) return;
      state.lastFrame = now;
      group.rotation.y += .0028 + state.energy * .014;
      group.rotation.x += (pointer.y - group.rotation.x) * .025;
      group.rotation.z += (pointer.x - group.rotation.z) * .025;
      particles.rotation.y -= .0018;
      core.scale.setScalar(1 + Math.sin(performance.now() * .0018) * .025 + state.energy * .12);
      state.energy *= .94;
      renderer.render(scene, camera);
    };
    requestAnimationFrame(tick);
    threeVault = {
      pulse: () => { state.energy = 1; },
      setVisible: (value) => { state.visible = value; },
    };
  }

  function bridgeCopy(template, type, iface) {
    return String(template || '')
      .replace('{type}', type?.name || '')
      .replace('{interface}', iface?.name || '');
  }

  function updateBridgeStatus(mode = 'ready') {
    const data = t('vaultBridge');
    const type = data.types.find((item) => item.id === bridgeTypeId) || data.types[0];
    const iface = data.interfaces.find((item) => item.id === bridgeInterfaceId) || data.interfaces[0];
    const status = document.querySelector('#bridge-route-status');
    if (!status) return;
    const key = mode === 'running' ? 'routeRunning' : mode === 'done' ? 'routeDone' : 'routeReady';
    status.textContent = bridgeCopy(data[key], type, iface);
    status.dataset.state = mode;
  }

  function renderVaultBridge() {
    const data = t('vaultBridge');
    const types = document.querySelector('#bridge-type-list');
    const interfaces = document.querySelector('#bridge-interface-tabs');
    if (!types || !interfaces) return;
    if (!data.types.some((item) => item.id === bridgeTypeId)) bridgeTypeId = data.types[0].id;
    if (!data.interfaces.some((item) => item.id === bridgeInterfaceId)) bridgeInterfaceId = data.interfaces[0].id;

    types.innerHTML = '';
    data.types.forEach((item) => {
      const button = el('button', 'bridge-type' + (item.id === bridgeTypeId ? ' active' : ''));
      button.type = 'button';
      button.dataset.typeId = item.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === bridgeTypeId));
      button.innerHTML = `<span>${esc(item.index)}</span><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small>`;
      button.addEventListener('click', () => selectBridgeType(item.id));
      types.append(button);
    });

    interfaces.innerHTML = '';
    data.interfaces.forEach((item) => {
      const button = el('button', 'bridge-interface' + (item.id === bridgeInterfaceId ? ' active' : ''));
      button.type = 'button';
      button.dataset.interfaceId = item.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === bridgeInterfaceId));
      button.textContent = item.name;
      button.addEventListener('click', () => selectBridgeInterface(item.id));
      interfaces.append(button);
    });

    updateBridgePreview(false);
    updateBridgeOutput();
    updateBridgeStatus();
    initThreeVault();

    const run = document.querySelector('#bridge-run');
    if (run && !run.dataset.bound) {
      run.dataset.bound = 'true';
      run.addEventListener('click', () => {
        bridgeUserControlled = true;
        window.clearTimeout(bridgeTourTimer);
        runBridgeRoute();
      });
    }
  }

  function selectBridgeType(id) {
    if (id === bridgeTypeId) return;
    bridgeTypeId = id;
    document.querySelectorAll('.bridge-type').forEach((button) => {
      const selected = button.dataset.typeId === id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    updateBridgePreview(true);
    updateBridgeStatus();
  }

  function updateBridgePreview(animate) {
    const data = t('vaultBridge');
    const item = data.types.find((entry) => entry.id === bridgeTypeId) || data.types[0];
    const preview = document.querySelector('#bridge-field-preview');
    const core = document.querySelector('#bridge-vault-core');
    const state = document.querySelector('#bridge-vault-state');
    if (!preview || !core || !state) return;
    preview.innerHTML = `<strong>${esc(item.name)}</strong><span class="bridge-inline-badge">${esc(data.synthetic)}</span>${Array.from({ length: item.sample.length / 2 }, (_, index) => `<span class="bridge-inline-field"><b>${esc(item.sample[index * 2])}</b>${esc(item.sample[index * 2 + 1])}</span>`).join('')}`;
    state.textContent = `${item.name} / ${data.encrypted}`;
    if (!animate || reduced) return;
    threeVault?.pulse();
    window.gsap?.fromTo(preview, { autoAlpha: .25, y: 12, rotate: -2 }, { autoAlpha: 1, y: 0, rotate: 0, duration: .48, ease: 'power3.out' });
  }

  function selectBridgeInterface(id) {
    bridgeInterfaceId = id;
    document.querySelectorAll('.bridge-interface').forEach((button) => {
      const selected = button.dataset.interfaceId === id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    updateBridgeOutput();
    updateBridgeStatus();
  }

  function runBridgeRoute() {
    const host = document.querySelector('#vault-bridge');
    const core = document.querySelector('#bridge-vault-core');
    const output = document.querySelector('#bridge-output');
    const run = document.querySelector('#bridge-run');
    if (!host || !core || !output || !run) return;
    const source = document.querySelector('.bridge-type.active');
    const target = document.querySelector('.bridge-interface.active');
    const layer = document.querySelector('#bridge-flight-layer');
    const token = ++bridgeAnimation;
    host.classList.remove('routing', 'route-complete');
    void host.offsetWidth;
    host.classList.add('routing');
    core.classList.add('receiving');
    output.classList.add('waiting');
    run.disabled = true;
    updateBridgeStatus('running');
    threeVault?.pulse();

    const finish = () => {
      if (token !== bridgeAnimation) return;
      host.classList.remove('routing');
      host.classList.add('route-complete');
      core.classList.remove('receiving');
      output.classList.remove('waiting');
      output.classList.add('delivered');
      run.disabled = false;
      updateBridgeStatus('done');
      window.setTimeout(() => output.classList.remove('delivered'), 850);
    };

    if (reduced || !window.gsap || !source || !target || !layer) {
      window.setTimeout(finish, reduced ? 0 : 1050);
      return;
    }

    const universe = document.querySelector('#vault-universe');
    const u = universe.getBoundingClientRect();
    const from = source.getBoundingClientRect();
    const middle = core.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const packet = el('span', 'bridge-flight-packet', '▓▓▓');
    layer.append(packet);
    const point = (rect) => ({ x: rect.left - u.left + rect.width / 2, y: rect.top - u.top + rect.height / 2 });
    const a = point(from); const b = point(middle); const c = point(to);
    window.gsap.set(packet, { x: a.x, y: a.y, xPercent: -50, yPercent: -50 });
    window.gsap.timeline({ onComplete: () => { packet.remove(); finish(); } })
      .to(packet, { x: b.x, y: b.y, scale: .55, rotate: 210, duration: .7, ease: 'power2.in' })
      .call(() => { packet.textContent = '◈'; threeVault?.pulse(); })
      .to(packet, { x: c.x, y: c.y, scale: 1, rotate: 360, duration: .65, ease: 'power3.out' })
      .to(packet, { autoAlpha: 0, scale: 1.8, duration: .22 });
  }

  function startBridgeTour() {
    if (bridgeTourStarted || bridgeUserControlled || reduced) return;
    bridgeTourStarted = true;
    const data = t('vaultBridge');
    bridgeTourTimer = window.setTimeout(() => {
      if (bridgeUserControlled || !document.querySelector('#vault-bridge')?.classList.contains('in')) return;
      const type = data.types[1] || data.types[0];
      const iface = data.interfaces[2] || data.interfaces[0];
      selectBridgeType(type.id);
      selectBridgeInterface(iface.id);
      bridgeTourTimer = window.setTimeout(runBridgeRoute, 420);
    }, 700);
  }

  function watchBridge() {
    const host = document.querySelector('#vault-bridge');
    if (!host || reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        threeVault?.setVisible(entry.isIntersecting);
        if (entry.isIntersecting) startBridgeTour();
      }
    }, { threshold: 0.38 });
    io.observe(host);
  }

  function updateBridgeOutput() {
    const data = t('vaultBridge');
    const item = data.interfaces.find((entry) => entry.id === bridgeInterfaceId) || data.interfaces[0];
    const output = document.querySelector('#bridge-output');
    if (!output) return;
    output.classList.remove('switching');
    void output.offsetWidth;
    output.innerHTML = `<p>${esc(item.detail)}</p><code><span>$</span> ${esc(item.command)}</code><pre>${esc(item.result)}</pre>`;
    if (!reduced) output.classList.add('switching');
  }

  /* ---------------- theater (guardrails terminal) ---------------- */

  let theaterGen = 0;
  let theaterMode = 'dry';
  let theaterSkip = false;
  let theaterStarted = false;

  const gates = () => [...document.querySelectorAll('.gate')];

  function lightGate(index) {
    gates()[index]?.classList.add('lit');
    const rail = document.querySelector('#rail-progress');
    if (rail) rail.style.transform = `scaleX(${(index + 1) / 4})`;
  }

  function syncTheaterControls() {
    const applyBtn = document.querySelector('#theater-apply');
    const mode = document.querySelector('#theater-mode');
    if (!applyBtn) return;
    if (theaterMode === 'dry') {
      applyBtn.textContent = t('theater.applyOn');
      mode.textContent = t('theater.modeDry');
      mode.classList.remove('apply');
    } else {
      applyBtn.textContent = t('theater.applyOff');
      mode.textContent = t('theater.modeApply');
      mode.classList.add('apply');
    }
  }

  async function typeInto(line, text, gen, withPrompt) {
    const target = el('span', 'typed');
    const cursor = el('span', 'tl-cursor');
    if (withPrompt) line.append(el('span', 'prompt', '$ '), target, cursor);
    else line.append(target, cursor);
    line.classList.add('show');
    if (reduced || theaterSkip) {
      target.textContent = text;
      cursor.remove();
      return;
    }
    for (const char of text) {
      if (gen !== theaterGen || theaterSkip) {
        target.textContent = text;
        break;
      }
      target.textContent += char;
      await sleep(13);
    }
    cursor.remove();
  }

  async function runBar(line, max, gen) {
    const fill = line.querySelector('.bar i');
    const count = line.querySelector('em');
    const dur = reduced ? 0 : 900;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        if (gen !== theaterGen) return resolve();
        const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
        fill.style.transform = `scaleX(${p})`;
        count.textContent = `${Math.round(max * p)}/${max}`;
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async function theaterRun(instant) {
    const gen = ++theaterGen;
    theaterSkip = !!instant;
    const body = document.querySelector('#theater-body');
    const steps = t('theater')[theaterMode] || [];
    body.innerHTML = '';
    gates().forEach((g) => g.classList.remove('lit'));
    const rail = document.querySelector('#rail-progress');
    if (rail) rail.style.transform = 'scaleX(0)';
    syncTheaterControls();

    for (const step of steps) {
      if (gen !== theaterGen) return;
      if (step.t === 'cmd') {
        const line = el('span', 'tl tl-cmd');
        body.append(line);
        await typeInto(line, step.text, gen, true);
      } else if (step.t === 'key') {
        const line = el('span', 'tl tl-dim', esc(step.text));
        body.append(line);
        await sleep(reduced || theaterSkip ? 0 : 220);
        line.classList.add('show');
      } else if (step.t === 'bar') {
        const line = el('span', 'tl tl-bar');
        line.innerHTML = `<span>${esc(step.label)}</span><span class="bar"><i></i></span><em>0/${step.max}</em>`;
        body.append(line);
        line.classList.add('show');
        await runBar(line, step.max, gen);
      } else if (step.t === 'kv') {
        const line = el('span', 'tl tl-kv');
        line.innerHTML = step.rows.map(([k, v]) => `<b>${esc(k)}</b><i>${esc(v)}</i>`).join('');
        body.append(line);
        await sleep(reduced || theaterSkip ? 0 : 60);
        line.classList.add('show');
      } else {
        const line = el('span', `tl tl-${step.cls || ''}`);
        line.textContent = step.text;
        body.append(line);
        await sleep(reduced || theaterSkip ? 0 : 90);
        line.classList.add('show');
      }
      if (step.gate != null) lightGate(step.gate);
      await sleep(reduced || theaterSkip ? 0 : 380);
    }
    if (gen !== theaterGen) return;
    theaterSkip = false;
    const cursorLine = el('span', 'tl');
    cursorLine.append(el('span', 'tl-cursor'));
    body.append(cursorLine);
    cursorLine.classList.add('show');
  }

  function watchTheater() {
    const host = document.querySelector('#theater');
    if (!reduced) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !theaterStarted) {
            theaterStarted = true;
            theaterRun();
            io.disconnect();
          }
        }
      }, { threshold: 0.3 });
      io.observe(host);
    }

    document.querySelector('#theater-replay').addEventListener('click', () => theaterRun());
    document.querySelector('#theater-apply').addEventListener('click', () => {
      theaterMode = theaterMode === 'dry' ? 'apply' : 'dry';
      theaterRun();
    });
    document.querySelector('#theater-body').addEventListener('click', () => {
      theaterSkip = true;
    });
    gates().forEach((gate) => {
      gate.addEventListener('click', () => theaterRun());
      gate.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          theaterRun();
        }
      });
    });
  }

  /* ---------------- cli playground ---------------- */

  let activeGroup = 'auth';
  let playgroundGen = 0;
  let playgroundStarted = false;

  function renderChips() {
    const host = document.querySelector('#playground-chips');
    host.innerHTML = '';
    t('cli.groups').forEach((group) => {
      const chip = el('button', 'chip' + (group.name === activeGroup ? ' active' : ''));
      chip.type = 'button';
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(group.name === activeGroup));
      chip.tabIndex = group.name === activeGroup ? 0 : -1;
      chip.textContent = group.name;
      chip.addEventListener('click', () => {
        activeGroup = group.name;
        host.querySelectorAll('.chip').forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-selected', 'false');
          c.tabIndex = -1;
        });
        chip.classList.add('active');
        chip.setAttribute('aria-selected', 'true');
        chip.tabIndex = 0;
        playgroundRun(group.name);
      });
      host.append(chip);
    });
  }

  async function playgroundRun(group) {
    const gen = ++playgroundGen;
    const body = document.querySelector('#playground-body');
    const runs = t('cli.runs') || {};
    const desc = t('cli.groups').find((g) => g.name === group)?.description || '';
    body.innerHTML = '';

    const cmd = el('span', 'tl tl-cmd');
    body.append(cmd);
    const typed = el('span', 'typed');
    const cursor = el('span', 'tl-cursor');
    cmd.append(el('span', 'prompt', '$ '), typed, cursor);
    cmd.classList.add('show');
    const command = `bwvault ${group} --help`;
    typed.textContent = command;
    cursor.remove();

    const descLine = el('span', 'tl tl-dim', esc(`# ${desc}`));
    body.append(descLine);
    if (gen !== playgroundGen) return;
    descLine.classList.add('show');

    for (const line of runs[group] || []) {
      if (gen !== playgroundGen) return;
      const node = el('span', 'tl', esc(line));
      body.append(node);
      node.classList.add('show');
    }
    if (gen !== playgroundGen) return;
    const cursorLine = el('span', 'tl');
    cursorLine.append(el('span', 'tl-cursor'));
    body.append(cursorLine);
    cursorLine.classList.add('show');
  }

  function watchPlayground() {
    const host = document.querySelector('.playground');
    document.querySelector('#playground-chips').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('#playground-chips [role="tab"]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
    if (reduced) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !playgroundStarted) {
          playgroundStarted = true;
          playgroundRun(activeGroup);
          io.disconnect();
        }
      }
    }, { threshold: 0.3 });
    io.observe(host);
  }

  /* ---------------- product mini panels ---------------- */

  let healthBarsSet = false;

  function renderPanels() {
    const p = t('product');

    const health = document.querySelector('#panel-health');
    health.innerHTML = `<span class="panel-cmd">${esc(p.healthCmd)}</span>` + p.healthBars.map((bar, i) => {
      const tone = i === 0 ? ' danger' : i === 1 ? ' warn' : '';
      return `<div class="hbar${tone}" data-value="${bar.value}">
        <div class="hbar-head"><span>${esc(bar.label)}</span><b>${bar.value}</b></div>
        <div class="track"><div class="fill"></div></div>
      </div>`;
    }).join('');

    const d = p.dedupe;
    document.querySelector('#panel-dedupe').innerHTML = `
      <span class="panel-cmd">${esc(p.dedupeCmd)}</span>
      <div class="dedupe-stage">
        <div class="dupe-card a"><span>${esc(d.cardA)}</span><span class="pill">${esc(d.keep)}</span></div>
        <div class="dupe-card b"><span>${esc(d.cardB)}</span><span class="pill">${esc(d.merge)}</span></div>
        <div class="dupe-result">${esc(d.result)}</div>
      </div>`;

    document.querySelector('#panel-alias').innerHTML = `
      <div class="alias-term">
        <span class="cmd-line"><span class="prompt">$ </span><span class="typed"></span><span class="tl-cursor"></span></span>
      </div>`;
    startAliasLoop();
  }

  let aliasGen = 0;
  let aliasVisible = false;

  async function startAliasLoop() {
    const gen = ++aliasGen;
    const p = t('product.alias');
    const term = document.querySelector('#panel-alias .alias-term');
    if (!term) return;

    while (gen === aliasGen && term.isConnected && (aliasVisible || reduced)) {
      term.querySelectorAll('.row, .note').forEach((n) => n.remove());
      const typed = term.querySelector('.typed');
      const cursor = term.querySelector('.tl-cursor');
      typed.textContent = '';
      if (reduced) {
        typed.textContent = p.cmd;
        cursor.remove();
        appendAliasRows(term, p);
        return;
      }
      for (const char of p.cmd) {
        if (gen !== aliasGen) return;
        typed.textContent += char;
        await sleep(26);
      }
      cursor.remove();
      appendAliasRows(term, p);
      await sleep(4200);
      const fresh = el('span', 'tl-cursor');
      term.querySelector('.cmd-line').append(fresh);
    }
  }

  function appendAliasRows(term, p) {
    p.rows.forEach((row, i) => {
      const node = el('span', 'row');
      node.style.opacity = '0';
      node.style.transition = 'opacity .4s ease';
      node.innerHTML = `<b>${esc(row[0])}</b>  ${esc(row[1])}  ${esc(row[2])}  <span class="mask">${esc(p.masked)}</span>`;
      term.append(node);
      setTimeout(() => { node.style.opacity = '1'; }, reduced ? 0 : 300 + i * 260);
    });
    const note = el('span', 'note', esc(p.note));
    note.style.opacity = '0';
    note.style.transition = 'opacity .4s ease';
    term.append(note);
    setTimeout(() => { note.style.opacity = '1'; }, reduced ? 0 : 300 + p.rows.length * 260);
  }

  function watchPanels() {
    const health = document.querySelector('#panel-health');
    const ioHealth = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !healthBarsSet) {
          healthBarsSet = true;
          const max = Math.max(...health.querySelectorAll('.hbar').length
            ? [...health.querySelectorAll('.hbar')].map((b) => Number(b.dataset.value)) : [1]);
          health.querySelectorAll('.hbar').forEach((bar) => {
            bar.querySelector('.fill').style.width = `${(Number(bar.dataset.value) / max) * 100}%`;
          });
          ioHealth.disconnect();
        }
      }
    }, { threshold: 0.4 });
    ioHealth.observe(health);

    const alias = document.querySelector('#panel-alias');
    const ioAlias = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const was = aliasVisible;
        aliasVisible = entry.isIntersecting;
        if (aliasVisible && !was) startAliasLoop();
      }
    }, { threshold: 0.35 });
    ioAlias.observe(alias);
  }

  /* ---------------- boundary flow ---------------- */

  function renderFlow() {
    const b = t('boundary');
    const host = document.querySelector('#boundary-flow');
    host.innerHTML = '';
    b.nodes.forEach((node, i) => {
      const n = el('div', 'flow-node' + (i === 1 ? ' proxy' : ''));
      const badge = i === 0 ? `<span class="flow-badge">${esc(b.browserBadge)}</span>`
        : i === 1 ? `<span class="flow-badge">${esc(b.proxyBadge)}</span>` : '';
      const decode = i === 0 ? '<span class="flow-decode">▓▓▓▓▓▓▓▓</span>' : '';
      n.innerHTML = `<strong>${esc(node.name)}</strong><span>${esc(node.detail)}</span>${badge}${decode}`;
      host.append(n);
      if (i < b.nodes.length - 1) {
        const link = el('div', 'flow-link');
        link.setAttribute('aria-hidden', 'true');
        link.innerHTML = `
          <span class="lane top"></span><span class="lane bottom"></span>
          <span class="packet top">▓▓▓</span>
          <span class="packet top d2">▓▓▓</span>
          <span class="packet bottom">▓▓▓</span>
          <span class="packet bottom d2">▓▓▓</span>`;
        host.append(link);
      }
    });
    if (reduced) document.querySelector('.flow-decode').textContent = 'boss@itycon.cn ✓';
    else if (flowVisible) {
      host.classList.add('is-running');
      startDecodeLoop();
    }
  }

  let decodeGen = 0;
  let flowVisible = false;

  async function startDecodeLoop() {
    const gen = ++decodeGen;
    const node = document.querySelector('.flow-decode');
    if (!node) return;
    const values = ['boss@itycon.cn ✓', 'api.cloudflare.com ✓', 'ssh://nas ✓'];
    if (reduced) {
      node.textContent = values[0];
      return;
    }
    const chars = '▓░#%&@$';
    let valueIndex = 0;
    while (gen === decodeGen && node.isConnected && flowVisible) {
      const target = values[valueIndex % values.length];
      node.textContent = '▓▓▓▓▓▓▓▓';
      await sleep(520);
      if (gen !== decodeGen || !flowVisible) return;
      let frame = 0;
      while (frame <= target.length * 1.5 + 2 && gen === decodeGen && flowVisible) {
        node.textContent = target.split('').map((c, i) => (frame > i * 1.5 ? c : chars[Math.random() * chars.length | 0])).join('');
        frame += 1;
        await sleep(42);
      }
      node.textContent = target;
      valueIndex += 1;
      await sleep(1450);
    }
  }

  function watchFlow() {
    if (reduced) return;
    const host = document.querySelector('#boundary-flow');
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const wasVisible = flowVisible;
        flowVisible = entry.isIntersecting;
        host.classList.toggle('is-running', flowVisible);
        if (flowVisible && !wasVisible) startDecodeLoop();
        if (!flowVisible && wasVisible) decodeGen += 1;
      }
    }, { threshold: 0.25 });
    io.observe(host);
  }

  /* ---------------- boot ---------------- */

  renderLanguage();
  if (!reduced) watchVault();
  watchTheater();
  watchPlayground();
  watchPanels();
  watchFlow();
  watchBridge();

  if (reduced) {
    vaultFinalState();
    document.querySelectorAll('.gate').forEach((gate) => gate.classList.add('lit'));
  }
})();
