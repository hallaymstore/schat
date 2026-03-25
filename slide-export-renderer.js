const { Resvg } = require('@resvg/resvg-js');

const THEME_TOKENS = {
  'teal-minimal': { bg: 'FBFFFE', surface: 'EEF7F5', text: '163633', strong: '0D2623', muted: '5C7671', accent: '0F8F83', accentText: 'FFFFFF', border: 'D8ECE8' },
  'executive-white': { bg: 'FFFFFF', surface: 'F4F8F7', text: '203D3B', strong: '102422', muted: '5A6C69', accent: '0A6F66', accentText: 'FFFFFF', border: 'DEE8E6' },
  'midnight-teal': { bg: '081C1E', surface: '102D30', text: 'DFFAF5', strong: 'EFFDFA', muted: 'A7D8D0', accent: '77D0C4', accentText: '062422', border: '214447' },
  'blueprint-grid': { bg: 'EFF8F7', surface: 'FFFFFF', text: '1B3D3A', strong: '0F2725', muted: '5A7774', accent: '126D82', accentText: 'FFFFFF', border: 'D9E8E7' },
  'editorial-warm': { bg: 'FCFAF6', surface: 'FFFFFF', text: '3F3B34', strong: '25211B', muted: '6D665D', accent: 'B76B3A', accentText: 'FFFFFF', border: 'E9E1D4' },
  'campus-card': { bg: 'F5FBFA', surface: 'FFFFFF', text: '1E3F3C', strong: '122826', muted: '58706C', accent: '149F92', accentText: 'FFFFFF', border: 'DBECE9' },
  'heritage-royal': { bg: 'F7F0E1', surface: 'FFF9F0', text: '1D2F52', strong: '10203F', muted: '6A5B46', accent: 'C79A3B', accentText: 'FFFFFF', border: 'E7D8BC' },
  'forest-emerald': { bg: 'F3FAF6', surface: 'FFFFFF', text: '173C34', strong: '0F291F', muted: '587067', accent: '2F8F6B', accentText: 'FFFFFF', border: 'D9ECE2' },
  'sunset-signal': { bg: 'FFF7EF', surface: 'FFFFFF', text: '5A2418', strong: '3D170F', muted: '8C5A4D', accent: 'E46A3A', accentText: 'FFFFFF', border: 'F1D6C8' },
  'berry-luxe': { bg: 'FCF4F8', surface: 'FFFFFF', text: '45243A', strong: '2E1627', muted: '7B5A6C', accent: 'A14C7A', accentText: 'FFFFFF', border: 'EBD7E3' },
  'graphite-coral': { bg: '1C232B', surface: '273039', text: 'F6EDEA', strong: 'FFF8F5', muted: 'C7B7B2', accent: 'F06B5D', accentText: '1C232B', border: '3D4A54' }
};
const DARK_THEME_IDS = new Set(['midnight-teal', 'graphite-coral']);

const COPY = {
  uz: { sourceLabel: 'Manbalar', nextStep: 'Keyingi qadam', slideWord: 'Slide' },
  en: { sourceLabel: 'Sources', nextStep: 'Next step', slideWord: 'Slide' },
  ru: { sourceLabel: 'Источники', nextStep: 'Следующий шаг', slideWord: 'Слайд' }
};

function cleanText(value, maxLen = 4000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeLanguage(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'en') return 'en';
  if (v === 'ru') return 'ru';
  return 'uz';
}

function getCopy(language) {
  return COPY[normalizeLanguage(language)] || COPY.uz;
}

function getTheme(themeId) {
  return THEME_TOKENS[String(themeId || '').trim()] || THEME_TOKENS['teal-minimal'];
}

function normalizeStringList(list, maxItems = 6, maxLen = 120) {
  return Array.isArray(list)
    ? list.map((item) => cleanText(item, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeStatsList(list) {
  return Array.isArray(list)
    ? list.map((item) => ({
        label: cleanText(item && item.label, 80),
        value: cleanText(item && item.value, 80)
      })).filter((item) => item.label && item.value).slice(0, 4)
    : [];
}

function normalizeTimelineList(list) {
  return Array.isArray(list)
    ? list.map((item) => ({
        title: cleanText(item && item.title, 120),
        detail: cleanText(item && item.detail, 180)
      })).filter((item) => item.title && item.detail).slice(0, 4)
    : [];
}

function composeSourceSummary(deck, slide) {
  const copy = getCopy(deck && deck.language);
  const links = Array.from(new Set(
    []
      .concat(Array.isArray(slide && slide.sourceLinks) ? slide.sourceLinks : [])
      .concat(Array.isArray(deck && deck.sourceLinks) ? deck.sourceLinks : [])
      .filter(Boolean)
  )).slice(0, 3);
  const hosts = links.map((link) => {
    try {
      return String(new URL(link).hostname || '').replace(/^www\./i, '');
    } catch (_) {
      return cleanText(link, 48);
    }
  }).filter(Boolean);
  return hosts.length ? `${copy.sourceLabel}: ${hosts.join(' | ')}` : `${copy.sourceLabel}: HALLAYM AI`;
}

function svgEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estimateTextWidth(text, fontSize) {
  let width = 0;
  for (const ch of String(text || '')) {
    if (/\s/.test(ch)) width += fontSize * 0.28;
    else if (/[ilI1'`,.:;]/.test(ch)) width += fontSize * 0.26;
    else if (/[MW@#%&]/.test(ch)) width += fontSize * 0.78;
    else if (/[A-ZА-ЯЁ]/.test(ch)) width += fontSize * 0.62;
    else width += fontSize * 0.54;
  }
  return width;
}

function wrapText(text, { maxWidth, fontSize, maxLines = 4 } = {}) {
  const words = cleanText(text, 3000).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    lines[maxLines - 1] = `${cleanText(lines[maxLines - 1], 180).replace(/[.]+$/g, '')}...`;
  }
  return lines;
}

function renderTextLines(lines, { x, y, fontSize, lineHeight, fill, weight = 400, anchor = 'start', family = 'Arial, Helvetica, sans-serif', opacity = 1 } = {}) {
  return (Array.isArray(lines) ? lines : []).map((line, idx) => `
    <text x="${x}" y="${y + (idx * lineHeight)}" fill="${fill}" fill-opacity="${opacity}" font-size="${fontSize}" font-weight="${weight}" font-family="${family}" text-anchor="${anchor}" dominant-baseline="hanging">${svgEscape(line)}</text>
  `).join('');
}

function textBlock(text, opts) {
  const lines = wrapText(text, opts);
  const lineHeight = opts && opts.lineHeight ? opts.lineHeight : Math.round((opts && opts.fontSize || 20) * 1.3);
  return {
    lines,
    height: lines.length ? ((lines.length - 1) * lineHeight) + (opts && opts.fontSize || 20) : 0,
    markup: renderTextLines(lines, Object.assign({}, opts, { lineHeight }))
  };
}

function roundedRect({ x, y, w, h, rx = 28, fill, stroke, fillOpacity = 1, strokeOpacity = 1, strokeWidth = 1.5 } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" />`;
}

function renderChipGrid(items, { x, y, w, colors } = {}) {
  const arr = normalizeStringList(items, 4, 84);
  const chipW = (w - 18) / 2;
  return arr.map((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = x + (col * (chipW + 18));
    const cy = y + (row * 76);
    const label = textBlock(item, { x: cx + 16, y: cy + 16, maxWidth: chipW - 28, fontSize: 20, maxLines: 2, lineHeight: 26, fill: colors.strong, weight: 700 });
    return `
      ${roundedRect({ x: cx, y: cy, w: chipW, h: 60, rx: 20, fill: colors.accent, fillOpacity: 0.1, stroke: colors.border, strokeOpacity: 0.8 })}
      ${label.markup}
    `;
  }).join('');
}

function renderBulletCard(items, { x, y, w, h, colors, title = '', body = '' } = {}) {
  let cursorY = y + 20;
  const parts = [roundedRect({ x, y, w, h, fill: colors.surface, stroke: colors.border, strokeOpacity: 0.8 })];
  if (title) {
    const head = textBlock(title, { x: x + 20, y: cursorY, maxWidth: w - 40, fontSize: 24, maxLines: 2, lineHeight: 30, fill: colors.strong, weight: 700 });
    parts.push(head.markup);
    cursorY += head.height + 10;
  }
  if (body) {
    const intro = textBlock(body, { x: x + 20, y: cursorY, maxWidth: w - 40, fontSize: 18, maxLines: 3, lineHeight: 24, fill: colors.muted });
    parts.push(intro.markup);
    cursorY += intro.height + 10;
  }
  normalizeStringList(items, 5, 110).forEach((item) => {
    const block = textBlock(item, { x: x + 38, y: cursorY, maxWidth: w - 58, fontSize: 19, maxLines: 2, lineHeight: 24, fill: colors.text, weight: 500 });
    parts.push(`<circle cx="${x + 22}" cy="${cursorY + 12}" r="5" fill="${colors.accent}" />`);
    parts.push(block.markup);
    cursorY += Math.max(34, block.height + 8);
  });
  return parts.join('');
}

function renderAgendaGrid(items, { x, y, w, colors } = {}) {
  const arr = normalizeStringList(items, 6, 82);
  const cardW = (w - 16) / 2;
  return arr.map((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = x + (col * (cardW + 16));
    const cy = y + (row * 116);
    const label = textBlock(item, { x: cx + 54, y: cy + 20, maxWidth: cardW - 72, fontSize: 21, maxLines: 3, lineHeight: 26, fill: colors.strong, weight: 700 });
    return `
      ${roundedRect({ x: cx, y: cy, w: cardW, h: 94, rx: 24, fill: colors.surface, stroke: colors.border, strokeOpacity: 0.86 })}
      <circle cx="${cx + 26}" cy="${cy + 29}" r="15" fill="${colors.accent}" />
      <text x="${cx + 26}" y="${cy + 18}" fill="${colors.accentText}" font-size="16" font-weight="700" text-anchor="middle" dominant-baseline="hanging">${idx + 1}</text>
      ${label.markup}
    `;
  }).join('');
}

function renderTimeline(items, { x, y, w, h, colors } = {}) {
  const arr = normalizeTimelineList(items);
  const parts = [roundedRect({ x, y, w, h, fill: colors.surface, stroke: colors.border, strokeOpacity: 0.84 })];
  const startY = y + 36;
  const gapY = Math.min(96, (h - 80) / Math.max(arr.length, 1));
  const lineX = x + 32;
  parts.push(`<line x1="${lineX}" y1="${startY}" x2="${lineX}" y2="${y + h - 40}" stroke="${colors.border}" stroke-width="3" stroke-opacity="0.9" />`);
  arr.forEach((item, idx) => {
    const cy = startY + (idx * gapY);
    const title = textBlock(item.title, { x: x + 58, y: cy - 6, maxWidth: w - 90, fontSize: 22, maxLines: 2, lineHeight: 26, fill: colors.strong, weight: 700 });
    const detail = textBlock(item.detail, { x: x + 58, y: cy + 26, maxWidth: w - 90, fontSize: 17, maxLines: 2, lineHeight: 22, fill: colors.text });
    parts.push(`<circle cx="${lineX}" cy="${cy + 10}" r="10" fill="${colors.accent}" />`);
    parts.push(title.markup);
    parts.push(detail.markup);
  });
  return parts.join('');
}

function renderMetrics(stats, { x, y, w, colors } = {}) {
  const arr = normalizeStatsList(stats);
  const cardW = (w - 18) / 2;
  return arr.map((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = x + (col * (cardW + 18));
    const cy = y + (row * 144);
    const label = textBlock(item.label, { x: cx + 18, y: cy + 82, maxWidth: cardW - 36, fontSize: 18, maxLines: 2, lineHeight: 22, fill: colors.muted, weight: 600 });
    return `
      ${roundedRect({ x: cx, y: cy, w: cardW, h: 126, rx: 24, fill: colors.surface, stroke: colors.border, strokeOpacity: 0.86 })}
      <text x="${cx + (cardW / 2)}" y="${cy + 24}" fill="${colors.strong}" font-size="40" font-weight="700" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" dominant-baseline="hanging">${svgEscape(item.value)}</text>
      ${label.markup}
    `;
  }).join('');
}

function renderMediaCard({ dataUri, x, y, w, h, colors, title = '', caption = '', id = 'slide' } = {}) {
  const mediaH = Math.min(h * 0.68, h - 92);
  const clipId = `clip-${id}`;
  const titleBlock = textBlock(title, { x: x + 18, y: y + mediaH + 24, maxWidth: w - 36, fontSize: 21, maxLines: 2, lineHeight: 26, fill: colors.strong, weight: 700 });
  const captionBlock = textBlock(caption, { x: x + 18, y: y + mediaH + 54 + titleBlock.height, maxWidth: w - 36, fontSize: 16, maxLines: 2, lineHeight: 21, fill: colors.muted });
  const imageMarkup = dataUri
    ? `
      <defs><clipPath id="${clipId}"><rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${mediaH - 4}" rx="22" /></clipPath></defs>
      <image href="${dataUri}" x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${mediaH - 4}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />
    `
    : `
      <rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${mediaH - 4}" rx="22" fill="${colors.accent}" fill-opacity="0.12" />
      <circle cx="${x + (w / 2)}" cy="${y + (mediaH / 2)}" r="62" fill="${colors.accent}" fill-opacity="0.1" />
      <circle cx="${x + (w / 2)}" cy="${y + (mediaH / 2)}" r="28" fill="${colors.accent}" fill-opacity="0.24" />
    `;
  return `
    ${roundedRect({ x, y, w, h, fill: colors.surface, stroke: colors.border, strokeOpacity: 0.84 })}
    ${imageMarkup}
    ${titleBlock.markup}
    ${captionBlock.markup}
  `;
}

function renderCallout({ x, y, w, h, colors, title = '', body = '' } = {}) {
  const titleBlock = title ? textBlock(title, { x: x + 18, y: y + 18, maxWidth: w - 36, fontSize: 22, maxLines: 2, lineHeight: 26, fill: colors.strong, weight: 700 }) : null;
  const bodyBlock = textBlock(body, { x: x + 18, y: y + 18 + (titleBlock ? titleBlock.height + 10 : 0), maxWidth: w - 36, fontSize: 18, maxLines: 4, lineHeight: 24, fill: colors.text, weight: 600 });
  return `
    ${roundedRect({ x, y, w, h, fill: colors.accent, fillOpacity: 0.1, stroke: colors.border, strokeOpacity: 0.82 })}
    ${titleBlock ? titleBlock.markup : ''}
    ${bodyBlock.markup}
  `;
}

function buildSlideSvgMarkup(deck, slide, index, totalSlides) {
  const theme = getTheme(deck && deck.themeId);
  const colors = {
    bg: `#${theme.bg}`,
    surface: `#${theme.surface}`,
    text: `#${theme.text}`,
    strong: `#${theme.strong}`,
    muted: `#${theme.muted}`,
    accent: `#${theme.accent}`,
    accentText: `#${theme.accentText}`,
    border: `#${theme.border}`
  };
  const layout = String(slide && slide.layout || 'content');
  const blocks = {
    bullets: normalizeStringList(slide && slide.bullets, 6, 110),
    leftBullets: normalizeStringList(slide && slide.leftBullets, 5, 110),
    rightBullets: normalizeStringList(slide && slide.rightBullets, 5, 110),
    stats: normalizeStatsList(slide && slide.stats),
    timeline: normalizeTimelineList(slide && slide.timeline)
  };
  const W = 1600;
  const H = 900;
  const pad = 64;
  const innerX = 80;
  const topY = 150;
  const countText = `${index + 1} / ${Math.max(1, totalSlides || 1)}`;
  const copy = getCopy(deck && deck.language);
  const imageDataUri = cleanText(slide && slide.imageDataUri || ((layout === 'cover') ? deck && deck.heroImageDataUri : ''), 2000000);
  const defs = [];
  const parts = [];
  const add = (markup) => { if (markup) parts.push(markup); };

  const gridId = `grid-${index}`;
  defs.push(`
    <pattern id="${gridId}" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M 44 0 L 0 0 0 44" fill="none" stroke="${colors.border}" stroke-opacity="${deck && deck.themeId === 'blueprint-grid' ? 0.35 : 0.16}" stroke-width="1"/>
    </pattern>
  `);

  add(`<rect x="0" y="0" width="${W}" height="${H}" fill="${colors.bg}" />`);
  add(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${gridId})" />`);
  add(`<circle cx="${W - 180}" cy="130" r="210" fill="${colors.accent}" fill-opacity="${DARK_THEME_IDS.has(String(deck && deck.themeId || '')) ? 0.12 : 0.06}" />`);
  add(`<circle cx="${W - 70}" cy="${H - 80}" r="120" fill="${colors.accent}" fill-opacity="${DARK_THEME_IDS.has(String(deck && deck.themeId || '')) ? 0.1 : 0.05}" />`);
  add(`<rect x="38" y="38" width="${W - 76}" height="${H - 76}" rx="34" fill="none" stroke="${colors.border}" stroke-opacity="0.72" stroke-width="2" />`);
  add(`<text x="${pad}" y="58" fill="${colors.accent}" font-size="18" font-weight="700" letter-spacing="1.5" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(cleanText(deck && deck.themeLabel || 'HALLAYM AI', 80).toUpperCase())}</text>`);
  add(`<text x="${W - pad}" y="58" fill="${colors.muted}" font-size="18" font-weight="700" text-anchor="end" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(countText)}</text>`);

  if (slide && slide.kicker) {
    add(roundedRect({ x: innerX, y: 98, w: Math.min(340, 90 + estimateTextWidth(slide.kicker, 18)), h: 42, rx: 21, fill: colors.accent, fillOpacity: 0.12, stroke: colors.border, strokeOpacity: 0.84 }));
    add(`<text x="${innerX + 18}" y="108" fill="${colors.accent}" font-size="18" font-weight="700" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(cleanText(slide.kicker, 80).toUpperCase())}</text>`);
  }

  const titleBlock = textBlock(slide && slide.title || `${copy.slideWord} ${index + 1}`, {
    x: innerX,
    y: topY,
    maxWidth: layout === 'quote' ? 920 : 760,
    fontSize: layout === 'cover' ? 64 : (layout === 'quote' ? 58 : 50),
    maxLines: layout === 'cover' ? 3 : 2,
    lineHeight: layout === 'cover' ? 68 : 54,
    fill: colors.strong,
    weight: 700
  });
  add(titleBlock.markup);

  let cursorY = topY + titleBlock.height + 18;
  if (slide && slide.subtitle && layout !== 'quote') {
    const subtitleBlock = textBlock(slide.subtitle, { x: innerX, y: cursorY, maxWidth: layout === 'quote' ? 920 : 760, fontSize: 24, maxLines: 3, lineHeight: 30, fill: colors.muted });
    add(subtitleBlock.markup);
    cursorY += subtitleBlock.height + 16;
  }

  const bodyText = cleanText(slide && slide.body, 600);
  if (layout === 'cover') {
    if (bodyText) {
      const body = textBlock(bodyText, { x: innerX, y: cursorY, maxWidth: 720, fontSize: 22, maxLines: 5, lineHeight: 29, fill: colors.text });
      add(body.markup);
      cursorY += body.height + 18;
    }
    add(renderChipGrid(blocks.bullets, { x: innerX, y: cursorY, w: 720, colors }));
    if (slide && slide.callout) add(renderCallout({ x: innerX, y: 650, w: 720, h: 122, colors, body: slide.callout }));
    add(renderMediaCard({ dataUri: imageDataUri, x: 980, y: 154, w: 520, h: 430, colors, title: slide && slide.imageCaption || slide && slide.title || cleanText(deck && deck.themeLabel, 80), caption: deck && deck.summary || slide && slide.subtitle || '', id: `cover-${index}` }));
    add(renderBulletCard([], { x: 980, y: 612, w: 520, h: 156, colors, title: deck && deck.themeLabel || 'HALLAYM AI', body: deck && deck.summary || composeSourceSummary(deck, slide) }));
  } else if (layout === 'agenda') {
    add(renderAgendaGrid(blocks.bullets, { x: innerX, y: cursorY + 12, w: imageDataUri ? 880 : 1420, colors }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1060, y: cursorY + 8, w: 430, h: 320, colors, title: slide && slide.imageCaption || slide && slide.title || cleanText(deck && deck.title, 80), caption: slide && slide.callout || deck && deck.summary || '', id: `agenda-${index}` }));
    if (slide && slide.callout) add(renderCallout({ x: imageDataUri ? 1060 : innerX, y: imageDataUri ? 492 : 630, w: imageDataUri ? 430 : 1420, h: 116, colors, body: slide.callout }));
  } else if (layout === 'split') {
    add(renderBulletCard(blocks.leftBullets.length ? blocks.leftBullets : blocks.bullets, { x: innerX, y: cursorY + 8, w: 760, h: 470, colors, title: slide && slide.leftTitle || '', body: bodyText }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1040, y: cursorY + 8, w: 450, h: 258, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `split-${index}` }));
    add(renderBulletCard(blocks.rightBullets.length ? blocks.rightBullets : blocks.bullets, { x: 1040, y: imageDataUri ? (cursorY + 290) : (cursorY + 8), w: 450, h: imageDataUri ? 188 : 470, colors, title: slide && slide.rightTitle || '', body: slide && slide.callout || '' }));
  } else if (layout === 'timeline') {
    add(renderTimeline(blocks.timeline, { x: innerX, y: cursorY + 10, w: 860, h: 472, colors }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1040, y: cursorY + 18, w: 450, h: 314, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `timeline-${index}` }));
    if (slide && slide.callout) add(renderCallout({ x: 1040, y: cursorY + 360, w: 450, h: 122, colors, body: slide.callout }));
  } else if (layout === 'metrics') {
    if (bodyText) {
      const body = textBlock(bodyText, { x: innerX, y: cursorY, maxWidth: 760, fontSize: 20, maxLines: 3, lineHeight: 26, fill: colors.text });
      add(body.markup);
      cursorY += body.height + 12;
    }
    add(renderMetrics(blocks.stats, { x: innerX, y: cursorY + 8, w: 760, colors }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1040, y: cursorY + 8, w: 450, h: 314, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `metrics-${index}` }));
    if (slide && slide.callout) add(renderCallout({ x: 1040, y: cursorY + 352, w: 450, h: 124, colors, body: slide.callout }));
  } else if (layout === 'quote') {
    const quote = textBlock(slide && slide.quote || slide && slide.title || '', { x: innerX + 10, y: 260, maxWidth: imageDataUri ? 840 : 1320, fontSize: 46, maxLines: 5, lineHeight: 54, fill: colors.strong, weight: 700 });
    add(`<text x="${innerX}" y="232" fill="${colors.accent}" font-size="92" font-weight="700" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">"</text>`);
    add(quote.markup);
    if (slide && slide.quoteAuthor) {
      const author = textBlock(slide.quoteAuthor, { x: innerX + 12, y: 260 + quote.height + 26, maxWidth: 620, fontSize: 22, maxLines: 2, lineHeight: 28, fill: colors.muted, weight: 700 });
      add(author.markup);
    }
    if (slide && slide.callout) add(renderCallout({ x: innerX, y: 650, w: imageDataUri ? 860 : 1320, h: 112, colors, body: slide.callout }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1080, y: 220, w: 380, h: 360, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `quote-${index}` }));
  } else if (layout === 'closing') {
    if (bodyText) {
      const body = textBlock(bodyText, { x: innerX, y: cursorY, maxWidth: 760, fontSize: 22, maxLines: 4, lineHeight: 28, fill: colors.text });
      add(body.markup);
      cursorY += body.height + 18;
    }
    add(renderBulletCard(blocks.bullets, { x: innerX, y: cursorY + 4, w: 760, h: 398, colors, body: '' }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 1040, y: cursorY + 4, w: 450, h: 238, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `closing-${index}` }));
    add(renderCallout({ x: 1040, y: imageDataUri ? (cursorY + 270) : (cursorY + 4), w: 450, h: imageDataUri ? 132 : 238, colors, title: cleanText(copy.nextStep, 80), body: slide && slide.callout || cleanText(deck && deck.watermark, 180) }));
  } else {
    if (bodyText) {
      const body = textBlock(bodyText, { x: innerX, y: cursorY, maxWidth: 760, fontSize: 21, maxLines: 4, lineHeight: 27, fill: colors.text });
      add(body.markup);
      cursorY += body.height + 16;
    }
    add(renderBulletCard(blocks.bullets, { x: 860, y: cursorY - 40, w: 630, h: imageDataUri ? 270 : 420, colors, body: '' }));
    if (imageDataUri) add(renderMediaCard({ dataUri: imageDataUri, x: 860, y: cursorY + 256, w: 630, h: 220, colors, title: slide && slide.imageCaption || slide && slide.title || '', caption: slide && slide.subtitle || '', id: `content-${index}` }));
    if (slide && slide.callout) add(renderCallout({ x: innerX, y: 660, w: 760, h: 100, colors, body: slide.callout }));
  }

  add(`<text x="${pad}" y="${H - 52}" fill="${colors.muted}" font-size="18" font-weight="700" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(cleanText(deck && deck.watermark, 180))}</text>`);
  add(`<text x="${W - pad}" y="${H - 52}" fill="${colors.muted}" font-size="16" font-weight="700" text-anchor="end" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(composeSourceSummary(deck, slide))}</text>`);
  add(`<text x="${W - pad}" y="${H - 82}" fill="${colors.strong}" font-size="18" font-weight="700" text-anchor="end" font-family="Arial, Helvetica, sans-serif" dominant-baseline="hanging">${svgEscape(countText)}</text>`);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${defs.join('\n')}
      ${parts.join('\n')}
    </svg>
  `;
}

async function renderDeckSlidePngBuffers(deck) {
  const slides = Array.isArray(deck && deck.slides) ? deck.slides : [];
  return slides.map((slide, index) => {
    const svg = buildSlideSvgMarkup(deck, slide, index, slides.length);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1600 },
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }
    });
    return Buffer.from(resvg.render().asPng());
  });
}

module.exports = {
  buildSlideSvgMarkup,
  renderDeckSlidePngBuffers
};
