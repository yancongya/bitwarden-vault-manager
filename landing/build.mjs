import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const out = join(root, 'dist');
const data = JSON.parse(await readFile(join(root, 'landing-data.json'), 'utf8'));
const productUrl = process.env.LANDING_PRODUCT_URL || data.site.productUrl;
const zh = data.zh;
const stylesheet = await readFile(join(root, 'landing.css'), 'utf8');
const clientScript = await readFile(join(root, 'landing.js'), 'utf8');

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const copy = (path) => escapeHtml(path.split('.').reduce((value, key) => value[key], zh));
const keyed = (tag, key, attrs = '') => `<${tag} data-copy="${key}" ${attrs}>${copy(key)}</${tag}>`;

const guardrails = zh.guardrails.steps.map((step, index) => `
  <article class="gate" style="--step:${index}" data-gate="${index}" tabindex="0" role="button">
    <span class="gate-state" data-copy="guardrails.steps.${index}.state">${escapeHtml(step.state)}</span>
    <h3 data-copy="guardrails.steps.${index}.title">${escapeHtml(step.title)}</h3>
    <p data-copy="guardrails.steps.${index}.body">${escapeHtml(step.body)}</p>
  </article>`).join('');

const productItems = zh.product.items.map((item, index) => `
  <article>
    <h3 data-copy="product.items.${index}.title">${escapeHtml(item.title)}</h3>
    <p data-copy="product.items.${index}.body">${escapeHtml(item.body)}</p>
  </article>`).join('');

const html = `<!doctype html>
<html lang="zh-CN" data-theme="dark" class="landing-boot">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(zh.meta.title)}</title>
  <meta name="description" content="${escapeHtml(zh.meta.description)}">
  <link rel="canonical" href="${escapeHtml(data.site.canonical)}">
  <link rel="icon" type="image/svg+xml" href="./assets/brand-logo.svg">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(zh.meta.title)}">
  <meta property="og:description" content="${escapeHtml(zh.meta.description)}">
  <meta property="og:url" content="${escapeHtml(data.site.canonical)}">
  <meta property="og:image" content="${escapeHtml(data.site.canonical)}assets/dashboard-light.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(zh.meta.title)}">
  <meta name="twitter:description" content="${escapeHtml(zh.meta.description)}">
  <meta name="twitter:image" content="${escapeHtml(data.site.canonical)}assets/dashboard-light.png">
  <script type="application/ld+json">${JSON.stringify([{
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: data.site.name,
    url: data.site.canonical,
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Web Browser, Node.js, Docker',
    description: zh.meta.description,
    codeRepository: data.site.sourceUrl,
    license: 'https://opensource.org/licenses/MIT',
  }]).replaceAll('<', '\\u003c')}</script>
  <style>${stylesheet}</style>
  <style>html.landing-boot main,html.landing-boot footer,html.landing-boot .site-header{visibility:hidden}</style>
</head>
<body>
  <div class="page-intro" id="page-intro" aria-hidden="true">
    <img id="page-intro-logo" src="./assets/brand-logo-intro.svg" alt="" width="88" height="88">
    <span>Bitwardenagents</span>
  </div>
  <div class="scroll-progress" aria-hidden="true"><span id="scroll-progress-fill"></span></div>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="#top" aria-label="Bitwardenagents home">
      <img src="./assets/brand-logo.svg" alt="" width="36" height="36">
      <span>Bitwardenagents</span>
    </a>
    <nav aria-label="Primary navigation">
      <a href="#safety" data-copy="nav.safety">${copy('nav.safety')}</a>
      <a href="#proof" data-copy="nav.proof">${copy('nav.proof')}</a>
      <a href="#security-report" data-copy="nav.security">${copy('nav.security')}</a>
      <a href="${escapeHtml(data.site.sourceUrl)}" data-copy="nav.source">${copy('nav.source')}</a>
    </nav>
    <div class="header-actions">
      <button id="language-toggle" class="icon-button" type="button" aria-label="${copy('nav.language')}">EN</button>
      <button id="theme-toggle" class="icon-button" type="button" aria-label="${copy('nav.theme')}"><span aria-hidden="true">◐</span></button>
      <a class="header-launch" href="${escapeHtml(productUrl)}" data-page-transition data-copy="nav.open">${copy('nav.open')}</a>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top">
      <div class="hero-copy">
        ${keyed('p', 'hero.eyebrow', 'class="eyebrow hero-stagger" style="--st:0"')}
        ${keyed('h1', 'hero.title', 'class="hero-stagger" style="--st:1"')}
        ${keyed('p', 'hero.lead', 'class="hero-lead hero-stagger" style="--st:2"')}
        <div class="hero-actions hero-stagger" style="--st:3">
          <a class="hero-launch" href="${escapeHtml(productUrl)}" data-page-transition><span data-copy="hero.primary">${copy('hero.primary')}</span><span aria-hidden="true">→</span></a>
          <a class="hero-secondary" href="${escapeHtml(data.site.sourceUrl)}" data-copy="hero.secondary">${copy('hero.secondary')}</a>
        </div>
      </div>
      <figure class="product-frame vault-frame hero-stagger" style="--st:4" id="vault-frame">
        <div class="vault-window" id="vault-window" aria-label="${copy('hero.visualLabel')}"></div>
        <figcaption><span data-copy="hero.visualLabel">${copy('hero.visualLabel')}</span><small data-copy="hero.visualNote">${copy('hero.visualNote')}</small></figcaption>
      </figure>
    </section>

    <section class="security-report-section" id="security-report">
      <div class="security-report-copy" data-reveal>
        ${keyed('p', 'securityReport.eyebrow', 'class="eyebrow"')}
        ${keyed('h2', 'securityReport.title')}
        ${keyed('p', 'securityReport.lead')}
        <a class="text-link" href="./security-report.md" data-copy="securityReport.link">${copy('securityReport.link')}</a>
      </div>
      <div class="security-report-panel" data-reveal>
        <div class="report-status"><span class="status-dot"></span><strong data-copy="securityReport.status">${copy('securityReport.status')}</strong></div>
        <div class="report-findings">
          ${zh.securityReport.findings.map((item, index) => `<div class="report-finding"><span>${String(index + 1).padStart(2, '0')}</span><strong data-copy="securityReport.findings.${index}.title">${escapeHtml(item.title)}</strong><em data-copy="securityReport.findings.${index}.level">${escapeHtml(item.level)}</em></div>`).join('')}
        </div>
        <p class="report-note" data-copy="securityReport.note">${copy('securityReport.note')}</p>
      </div>
    </section>

    <section class="vault-bridge-section" id="vault-native">
      <div class="section-heading bridge-heading" data-reveal>
        ${keyed('h2', 'vaultBridge.title')}
        ${keyed('p', 'vaultBridge.lead')}
      </div>
      <div class="vault-bridge" id="vault-bridge" data-reveal>
        <div class="bridge-stage-head">
          <span data-copy="vaultBridge.stageHint">${copy('vaultBridge.stageHint')}</span>
          <button class="bridge-run" id="bridge-run" type="button"><span data-copy="vaultBridge.routeAction">${copy('vaultBridge.routeAction')}</span><i aria-hidden="true">→</i></button>
        </div>
        <div class="vault-universe" id="vault-universe">
          <canvas class="vault-scene" id="vault-scene" aria-hidden="true"></canvas>
          <div class="bridge-types">
            <p class="bridge-label" data-copy="vaultBridge.nativeLabel">${copy('vaultBridge.nativeLabel')}</p>
            <div class="bridge-type-list" id="bridge-type-list" role="tablist" aria-label="${copy('vaultBridge.nativeLabel')}"></div>
          </div>
          <div class="bridge-vault-core" id="bridge-vault-core">
            <img src="./assets/brand-logo.svg" alt="" width="48" height="48">
            <strong>BITWARDEN VAULT</strong>
            <span id="bridge-vault-state" data-copy="vaultBridge.encrypted">${copy('vaultBridge.encrypted')}</span>
          </div>
          <div class="bridge-access">
            <div class="bridge-access-head">
              <p class="bridge-label" data-copy="vaultBridge.accessLabel">${copy('vaultBridge.accessLabel')}</p>
              <span data-copy="vaultBridge.synthetic">${copy('vaultBridge.synthetic')}</span>
            </div>
            <div class="bridge-interface-tabs" id="bridge-interface-tabs" role="tablist" aria-label="${copy('vaultBridge.accessLabel')}"></div>
          </div>
          <div class="bridge-flight-layer" id="bridge-flight-layer" aria-hidden="true"></div>
          <div class="bridge-detail-dock">
            <div class="bridge-field-preview" id="bridge-field-preview" aria-live="polite"></div>
            <div class="bridge-output" id="bridge-output" aria-live="polite"></div>
          </div>
        </div>
        <div class="bridge-route-status" id="bridge-route-status" aria-live="polite"></div>
      </div>
      <p class="bridge-note" data-copy="vaultBridge.localNote">${copy('vaultBridge.localNote')}</p>
    </section>

    <section class="safety-section" id="safety">
      <div class="section-heading" data-reveal>
        ${keyed('h2', 'guardrails.title')}
        ${keyed('p', 'guardrails.lead')}
      </div>
      <div class="safety-rail" aria-label="Four operation guardrails" data-reveal>
        <div class="rail-progress" aria-hidden="true" id="rail-progress"></div>
        ${guardrails}
      </div>
      <div class="theater" id="theater" data-reveal>
        <div class="theater-terminal">
          <div class="terminal-bar">
            <span></span><span></span><span></span>
            <strong>bwvault</strong>
            <em class="theater-mode" id="theater-mode" data-copy="theater.modeDry">${copy('theater.modeDry')}</em>
          </div>
          <div class="theater-body" id="theater-body" aria-live="off"></div>
        </div>
        <div class="theater-actions">
          <button class="chip" type="button" id="theater-replay" data-copy="theater.replay">${copy('theater.replay')}</button>
          <button class="chip chip-accent" type="button" id="theater-apply" data-copy="theater.applyOn">${copy('theater.applyOn')}</button>
          <small class="theater-hint" data-copy="theater.gateHint">${copy('theater.gateHint')}</small>
        </div>
      </div>
    </section>

    <section class="cli-section" id="proof">
      <div class="cli-copy" data-reveal>
        ${keyed('h2', 'cli.title')}
        ${keyed('p', 'cli.lead')}
        <div class="command-copy">
          <code>${escapeHtml(zh.cli.command)}</code>
          <button type="button" data-copy-command="${escapeHtml(zh.cli.command)}" data-copy-label="cli.copy" data-copy-done="cli.copied">${copy('cli.copy')}</button>
        </div>
      </div>
      <div class="playground" data-reveal>
        <div class="chip-row" id="playground-chips" role="tablist" aria-label="bwvault command groups"></div>
        <div class="playground-terminal">
          <div class="terminal-bar">
            <span></span><span></span><span></span>
            <strong>bwvault &lt;group&gt; --help</strong>
          </div>
          <div class="theater-body" id="playground-body"></div>
        </div>
        <small class="playground-hint" data-copy="cli.playgroundHint">${copy('cli.playgroundHint')}</small>
      </div>
    </section>

    <section class="product-section">
      <div class="section-heading product-heading" data-reveal>
        ${keyed('h2', 'product.title')}
        ${keyed('p', 'product.lead')}
      </div>
      <div class="panel-grid" id="panel-grid">
        <article class="mini-panel" data-panel="health" data-reveal style="--pd:0">
          <header><h3 data-copy="product.items.0.title">${copy('product.items.0.title')}</h3><em class="panel-badge" data-copy="product.panelBadge">${copy('product.panelBadge')}</em></header>
          <div class="panel-body" id="panel-health"></div>
        </article>
        <article class="mini-panel" data-panel="dedupe" data-reveal style="--pd:1">
          <header><h3 data-copy="product.items.1.title">${copy('product.items.1.title')}</h3><em class="panel-badge" data-copy="product.panelBadge">${copy('product.panelBadge')}</em></header>
          <div class="panel-body" id="panel-dedupe"></div>
        </article>
        <article class="mini-panel" data-panel="alias" data-reveal style="--pd:2">
          <header><h3 data-copy="product.items.2.title">${copy('product.items.2.title')}</h3><em class="panel-badge" data-copy="product.panelBadge">${copy('product.panelBadge')}</em></header>
          <div class="panel-body" id="panel-alias"></div>
        </article>
      </div>
      <div class="capability-index">${productItems}</div>
      <a class="text-link" href="${escapeHtml(data.site.productUrl)}" data-copy="product.cta">${copy('product.cta')}</a>
    </section>

    <section class="boundary-section">
      <div class="boundary-copy" data-reveal>
        ${keyed('h2', 'boundary.title')}
        ${keyed('p', 'boundary.lead')}
      </div>
      <div class="boundary-flow" id="boundary-flow" data-reveal></div>
      ${keyed('p', 'boundary.note', 'class="boundary-note"')}
    </section>

    <section class="final-section">
      ${keyed('p', 'final.eyebrow', 'class="eyebrow"')}
      ${keyed('h2', 'final.title')}
      <div class="final-actions">
        <a class="final-launch" href="${escapeHtml(productUrl)}" data-page-transition data-copy="final.primary">${copy('final.primary')}</a>
        <a href="${escapeHtml(data.site.sourceUrl)}" data-copy="final.source">${copy('final.source')}</a>
        <a href="./skill.md" data-page-transition data-copy="final.skill">${copy('final.skill')}</a>
        <a href="./llms.txt" data-page-transition data-copy="final.llms">${copy('final.llms')}</a>
      </div>
    </section>
  </main>

  <footer>
    <span data-copy="footer.note">${copy('footer.note')}</span>
    <span data-copy="footer.privacy">${copy('footer.privacy')}</span>
  </footer>
  <script id="landing-data" type="application/json">${JSON.stringify([data]).replaceAll('<', '\\u003c')}</script>
  <script src="./assets/gsap.min.js"></script>
  <script type="module">import * as THREE from './assets/three.module.min.js'; window.THREE = THREE; ${clientScript}</script>
</body>
</html>`;

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
await writeFile(join(out, 'index.html'), html);
await cp(join(project, 'public', 'brand-logo.svg'), join(out, 'assets', 'brand-logo.svg'));
await cp(join(project, 'public', 'brand-logo-intro.svg'), join(out, 'assets', 'brand-logo-intro.svg'));
await cp(join(root, 'assets', 'dashboard-light.png'), join(out, 'assets', 'dashboard-light.png'));
await cp(join(root, 'assets', 'dashboard-dark.png'), join(out, 'assets', 'dashboard-dark.png'));
await cp(join(project, 'node_modules', 'gsap', 'dist', 'gsap.min.js'), join(out, 'assets', 'gsap.min.js'));
await cp(join(project, 'node_modules', 'three', 'build', 'three.module.min.js'), join(out, 'assets', 'three.module.min.js'));
await cp(join(project, 'node_modules', 'three', 'build', 'three.core.min.js'), join(out, 'assets', 'three.core.min.js'));
await cp(join(project, 'public', 'llms.txt'), join(out, 'llms.txt'));
await cp(join(project, 'docs', 'security-report.md'), join(out, 'security-report.md'));
await cp(join(project, 'agent-harness', 'skills', 'SKILL.md'), join(out, 'skill.md'));
await writeFile(join(out, 'landing-data.json'), JSON.stringify(data, null, 2) + '\n');

console.log(`Landing built at ${out}`);
