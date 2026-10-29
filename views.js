/* Question-specific views for FinGeo's generated, source-specific observations. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NAVY = '#002147';
  const TEAL = '#3a8c83';
  const PALETTE = [NAVY, TEAL, '#7399ba', '#b37b42', '#8a719e', '#ac6670'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const sum = rows => rows.reduce((total, value) => total + value, 0);
  const element = (tag, attributes = {}, text = '') => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== '') node.textContent = text;
    return node;
  };
  const paragraph = text => `<p class="card-footnote">${esc(text)}</p>`;
  const empty = text => `<p class="empty-detail">${esc(text)}</p>`;
  const sourceNotes = notes => `<details class="question-method"><summary>Source &amp; Calculation Notes</summary>${notes.filter(Boolean).map(paragraph).join('')}</details>`;
  const short = (text, limit = 42) => text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  const colour = key => PALETTE[[...String(key)].reduce((value, character) => value + character.charCodeAt(0), 0) % PALETTE.length];

  function donut(title, domestic, foreign, flags, context) {
    const complete = finite(domestic) && finite(foreign);
    const nonnegative = complete && domestic >= 0 && foreign >= 0;
    const total = complete ? domestic + foreign : null;
    const share = nonnegative && total > 0 ? foreign / total : null;
    const card = document.createElement('article');
    card.className = 'question-donut';
    card.innerHTML = `<h3>${esc(title)}</h3><div class="question-donut-body"></div><dl class="question-amounts"><div><dt>Domestic</dt><dd>${esc(context.money(domestic))}</dd></div><div><dt>Foreign</dt><dd>${esc(context.money(foreign))}</dd></div><div><dt>Foreign Share</dt><dd>${esc(context.percentage(share))}</dd></div></dl>`;
    const body = card.querySelector('.question-donut-body');
    if (nonnegative && total > 0) {
      const svg = element('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': `${title}: domestic-controlled ${context.money(domestic)}, foreign-controlled ${context.money(foreign)}; foreign share ${context.percentage(share)}` });
      const radius = 49, circumference = 2 * Math.PI * radius;
      svg.append(element('circle', { cx: 75, cy: 75, r: radius, fill: 'none', stroke: NAVY, 'stroke-width': 19 }));
      if (foreign > 0) svg.append(element('circle', { cx: 75, cy: 75, r: radius, fill: 'none', stroke: TEAL, 'stroke-width': 19, 'stroke-dasharray': `${circumference * share} ${circumference}`, transform: 'rotate(-90 75 75)' }));
      svg.append(element('text', { x: 75, y: 72, 'text-anchor': 'middle', fill: NAVY, 'font-size': 14, 'font-weight': 600 }, context.money(total)));
      svg.append(element('text', { x: 75, y: 90, 'text-anchor': 'middle', fill: '#607385', 'font-size': 9 }, 'Domestic + Foreign'));
      body.append(svg);
    } else body.innerHTML = empty(!complete ? 'Complete Domestic / Foreign Components Not Observed' : total === 0 ? 'Observed Total Is Zero' : 'Signed Components: Share Not Defined');
    if (flags) card.insertAdjacentHTML('beforeend', paragraph(flags));
    return card;
  }

  function flagText(account, measure) {
    const flags = account.ownership_flags || {};
    const domestic = flags[`${measure}_D`], foreign = flags[`${measure}_F`];
    return `Observation flags — domestic: ${domestic || 'not supplied'}; foreign: ${foreign || 'not supplied'}. e indicates an analytical estimate.`;
  }

  function flagSummary(account, measure) {
    const flags = account.ownership_flags || {};
    const label = flag => !flag ? 'unknown' : String(flag).toLowerCase() === 'e' ? `${flag} (est.)` : flag;
    return `D: ${label(flags[`${measure}_D`])} · F: ${label(flags[`${measure}_F`])}`;
  }

  function production(context) {
    const { layer, state, chart, countryName, description } = context;
    const accounts = layer.accounts || {};
    const account = accounts[state.country];
    const measures = [
      { title: 'Gross Output', d: 'domestic_output', f: 'foreign_output', flag: 'GO' },
      { title: 'Value Added', d: 'domestic_va', f: 'foreign_va', flag: 'GVA' }
    ];
    context.title.textContent = state.country ? `Financial Production in ${countryName(state.country)}` : 'Mapped Financial Production';
    description.textContent = `Same-year AMNE gross output and value added by ownership${state.comparison || context.view.isComparison ? ` · ${state.year} levels` : ''}.`;
    if (state.country ? !account : !Object.keys(accounts).length) { context.panel.hidden = true; return; }
    const grid = document.createElement('div');
    grid.className = 'question-grid';
    const notes = [
      'Domestic-controlled and foreign-controlled components come from OECD Analytical AMNE accounts for the same year and financial sector.',
      state.comparison || context.view.isComparison ? `Donuts show ${state.year} levels; the map shows ${state.year}−${state.comparison} changes.` : ''
    ];
    if (state.country) {
      measures.forEach(measure => {
        grid.append(donut(measure.title, account[measure.d], account[measure.f], flagSummary(account, measure.flag), context));
        notes.push(`${measure.title}: ${flagText(account, measure.flag)}`);
      });
      if (measures.some(measure => finite(account[measure.d]) && finite(account[measure.f]) && (account[measure.d] < 0 || account[measure.f] < 0))) notes.push('The signed source amounts are retained above. A negative component is not drawn as a positive share.');
    } else {
      const entries = Object.values(accounts);
      for (const measure of measures) {
        const included = entries.filter(row => finite(row?.[measure.d]) && finite(row?.[measure.f]) && row[measure.d] >= 0 && row[measure.f] >= 0);
        const missing = entries.filter(row => !finite(row?.[measure.d]) || !finite(row?.[measure.f])).length;
        const signed = entries.length - included.length - missing;
        const estimated = included.reduce((count, row) => count + [row.ownership_flags?.[`${measure.flag}_D`], row.ownership_flags?.[`${measure.flag}_F`]].filter(flag => String(flag).toLowerCase() === 'e').length, 0);
        grid.append(donut(measure.title, included.length ? sum(included.map(row => row[measure.d])) : null, included.length ? sum(included.map(row => row[measure.f])) : null, `Est. ${estimated} · incomplete ${missing}`, context));
        notes.push(`${measure.title}: ${included.length} mapped economies have complete, nonnegative components; ${missing} lack a component; ${signed} have signed components. ${estimated} included component cells carry flag e (analytical estimate). This is the sum of eligible mapped accounts, not a published world total.`);
      }
    }
    notes.push('Navy: domestic-controlled. Teal: foreign-controlled. Gross output and value added are separate accounting measures. Neither is an equity position or an investment flow.');
    chart.append(grid);
    chart.insertAdjacentHTML('beforeend', sourceNotes(notes));
  }

  function controlRows(context, direction) {
    const country = context.state.country;
    const source = Array.isArray(context.layer.edges) ? context.layer.edges.map(row => ({ s: String(row[0]), t: String(row[1]), value: row[2] })) : context.view.edges || [];
    return source.filter(row => row.s !== row.t && (direction === 'in' ? row.t === country : row.s === country));
  }

  function controlSide(context, direction) {
    const rows = controlRows(context, direction);
    const observed = rows.filter(row => finite(row.value));
    const missing = rows.length - observed.length;
    const negative = observed.filter(row => row.value < 0);
    const positives = observed.filter(row => row.value > 0);
    const positiveTotal = sum(positives.map(row => row.value));
    const subtotal = observed.length ? sum(observed.map(row => row.value)) : null;
    const ratiosValid = !missing && !negative.length && finite(subtotal) && subtotal > 0;
    const partners = new Map();
    positives.forEach(row => {
      const code = direction === 'in' ? row.s : row.t;
      partners.set(code, (partners.get(code) || 0) + row.value);
    });
    const ranked = [...partners].sort((a, b) => b[1] - a[1]);
    const side = document.createElement('article');
    side.innerHTML = `<p class="question-subtotal"><strong>${esc(context.money(subtotal))}</strong> mapped foreign ${direction === 'in' ? 'inward' : 'outward'} subtotal</p>`;
    ranked.slice(0, 5).forEach(([code, value], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'partner-row';
      const ratio = ratiosValid ? value / subtotal : null;
      button.innerHTML = `<span class="partner-rank">${index + 1}</span><span><span class="partner-name">${esc(context.countryName(code))}</span><span class="partner-bar-track" style="display:block"><span class="partner-bar" style="display:block;width:${positiveTotal > 0 ? value / positiveTotal * 100 : 0}%"></span></span></span><span class="partner-value">${esc(context.money(value))}<small class="partner-share">${ratio === null ? 'Share not defined' : `${esc(context.percentage(ratio))} of foreign subtotal`}</small></span>`;
      button.addEventListener('click', () => context.onCountry(code));
      side.append(button);
    });
    if (!ranked.length) side.insertAdjacentHTML('beforeend', empty(observed.length ? 'No Positive Cross-Border Output Observed' : 'Cross-Border Output Not Observed'));
    const adjustments = negative.length ? ` ${negative.length} negative source cells sum to ${context.money(sum(negative.map(row => row.value)))}; they are retained in the subtotal and excluded from bar widths.` : '';
    side.insertAdjacentHTML('beforeend', sourceNotes([
      'AMNE bilateral amounts are financial-sector gross output controlled by an ultimate parent economy and produced in a host economy. They are not equity holdings, investment flows or company counts.',
      direction === 'in' ? 'Who controls financial gross output produced in the selected economy?' : 'Where do groups from the selected parent economy control financial gross output?',
      `The five largest positive partners are shown; ${partners.size} positive partner economies and ${observed.length} numeric cross-border cells are observed. Shares use all mapped foreign partners, including those outside the top five. ${missing} cells lack a numeric observation.${adjustments}${!ratiosValid ? ' A share requires complete, nonnegative observed cells and a positive subtotal.' : ''}`,
      'Bar widths use the full positive observed foreign amount, including partners outside the top five.',
      'Domestic self-links are excluded. The company evidence panel uses separately sourced records; no firm identity is inferred from these aggregate amounts.'
    ]));
    return side;
  }

  function control(context) {
    if (!context.state.country || context.state.comparison || context.view.isComparison) { context.panel.hidden = true; return; }
    const direction = context.state.direction === 'out' ? 'out' : 'in';
    context.title.textContent = direction === 'in' ? 'Ultimate Parent Economies' : 'Host Economies of Controlled Production';
    context.description.textContent = direction === 'in' ? 'Top five parent economies controlling financial output here.' : 'Top five host economies for financial output controlled from here.';
    context.chart.append(controlSide(context, direction));
  }

  function flowRows(context, direction) {
    const allocated = context.state.metric === 'allocated_va';
    const payload = allocated ? context.layer.sankeyVA : context.layer.sankey;
    const detail = payload?.byCountry?.[context.state.country]?.[direction === 'in' ? 'incoming' : 'outgoing'];
    const filter = context.state.industry || 'all';
    if (Array.isArray(detail)) {
      return { detailed: true, labels: payload.labels || {}, rows: detail.filter(row => Array.isArray(row) && row.length >= 3 && (filter === 'all' || String(row[1]) === filter)).map(row => ({ country: String(row[0]), category: String(row[1]), value: row[2] })).filter(row => row.country !== context.state.country) };
    }
    const rows = (context.view.edges || []).filter(row => row.s !== row.t && (direction === 'in' ? row.t === context.state.country : row.s === context.state.country)).map(row => ({ country: direction === 'in' ? row.s : row.t, category: filter === 'all' ? '' : filter, value: row.value }));
    return { detailed: false, labels: {}, rows };
  }

  function flowGroups(rows, mode) {
    const map = new Map();
    for (const row of rows) {
      if (!finite(row.value) || row.value <= 0) continue;
      const key = mode === 'detail' ? `${row.country}\u0000${row.category}` : row.country;
      if (map.has(key)) map.get(key).value += row.value;
      else map.set(key, { ...row, value: row.value, key });
    }
    const ordered = [...map.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    // Keep the backend's residual group separate from genuine country names.
    const candidates = mode === 'country' ? ordered.filter(row => row.country !== 'OTHER') : ordered;
    const shown = candidates.slice(0, 8);
    const visibleKeys = new Set(shown.map(row => row.key));
    const rest = ordered.filter(row => !visibleKeys.has(row.key));
    if (rest.length) shown.push({ country: 'OTHER', category: '', key: '__remainder__', remainder: mode === 'detail', value: sum(rest.map(row => row.value)) });
    return shown;
  }

  function groupLabel(group, mode, context, labels) {
    if (group.remainder) return 'Other Observed Country–Industry Flows';
    const country = group.country === 'OTHER' ? 'Other Observed Economies' : context.countryName(group.country);
    return mode === 'detail' && group.category ? `${country} · ${labels[group.category] || group.category}` : country;
  }

  function drawSankey(context, groups, direction, mode, labels, total) {
    const gap = 30, top = 40, flowHeight = 220;
    const height = top * 2 + flowHeight + gap * Math.max(0, groups.length - 1);
    const scale = flowHeight / total, focalTop = (height - flowHeight) / 2;
    const svg = element('svg', { viewBox: `0 0 960 ${height}`, role: 'img', class: 'question-sankey', 'aria-label': `${context.countryName(context.state.country)}: ${context.money(total)} of positive observed cross-border flows. Ribbon widths are proportional to amounts.` });
    const ribbons = element('g', { 'fill-opacity': '.35' });
    const nodes = element('g');
    const text = element('g', { fill: NAVY, 'font-family': 'inherit', 'font-size': 11 });
    const focalX = direction === 'in' ? 650 : 280;
    const partnerX = direction === 'in' ? 280 : 650;
    let partnerY = top, focalY = focalTop;
    for (const group of groups) {
      const thickness = group.value * scale;
      const sourceY = direction === 'in' ? partnerY : focalY;
      const targetY = direction === 'in' ? focalY : partnerY;
      const path = `M294 ${sourceY} C465 ${sourceY} 479 ${targetY} 650 ${targetY} L650 ${targetY + thickness} C479 ${targetY + thickness} 465 ${sourceY + thickness} 294 ${sourceY + thickness} Z`;
      const fill = colour(mode === 'detail' ? group.category : group.country);
      const ribbon = element('path', { d: path, fill });
      const label = groupLabel(group, mode, context, labels);
      ribbon.append(element('title', {}, `${label}: ${context.money(group.value)} · ${context.percentage(group.value / total)} of positive observed flows`));
      ribbons.append(ribbon);
      const node = element('g');
      node.append(element('rect', { x: partnerX, y: partnerY, width: 14, height: thickness, fill }));
      const labelX = direction === 'in' ? 8 : 680;
      const labelY = partnerY + thickness / 2;
      const name = element('text', { x: labelX, y: labelY - 3, fill: NAVY, 'font-size': 11 }, short(label, 43));
      name.append(element('title', {}, label));
      node.append(name, element('text', { x: labelX, y: labelY + 12, fill: '#607385', 'font-size': 10 }, `${context.money(group.value)} · ${context.percentage(group.value / total)}`));
      if (group.country !== 'OTHER') {
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.setAttribute('aria-label', `Select ${context.countryName(group.country)}`);
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => context.onCountry(group.country));
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); context.onCountry(group.country); } });
      }
      nodes.append(node);
      partnerY += thickness + gap;
      focalY += thickness;
    }
    nodes.append(element('rect', { x: focalX, y: focalTop, width: 14, height: flowHeight, fill: NAVY }));
    const focalLabelX = direction === 'in' ? 680 : 8;
    text.append(element('text', { x: focalLabelX, y: height / 2 - 9, 'font-weight': 600 }, short(`${context.countryName(context.state.country)} Finance`, 34)), element('text', { x: focalLabelX, y: height / 2 + 10, 'font-size': 11 }, context.money(total)));
    svg.append(ribbons, nodes, text);
    context.chart.append(svg);
  }

  function flows(context) {
    const upstream = context.layerId === 'icio_upstream';
    const finalDemand = context.layerId === 'icio_final_demand';
    const direction = upstream ? 'in' : 'out';
    const allocated = context.state.metric === 'allocated_va';
    context.title.textContent = upstream ? 'Inputs Supporting Financial Production' : finalDemand ? 'Final Demand for Financial Services' : 'Users of Financial Services';
    context.description.textContent = upstream ? 'Observed suppliers → selected financial sector.' : finalDemand ? 'Selected financial sector → final-demand economies and categories.' : 'Selected financial sector → user economies and industries.';
    if (!context.state.country || context.state.comparison || context.view.isComparison) { context.panel.hidden = true; return; }
    const data = flowRows(context, direction);
    const observed = data.rows.filter(row => finite(row.value));
    const positive = observed.filter(row => row.value > 0);
    const negative = observed.filter(row => row.value < 0);
    if (!positive.length && !negative.length) { context.panel.hidden = true; return; }
    const missing = data.rows.length - observed.length;
    const total = sum(positive.map(row => row.value));
    const observedSum = sum(observed.map(row => row.value));
    const zero = observed.filter(row => row.value === 0).length;
    let mode = 'country';
    const renderFlow = () => {
      context.chart.replaceChildren();
      if (data.detailed) {
        const controls = document.createElement('div');
        controls.className = 'question-view-switch segmented';
        controls.setAttribute('aria-label', finalDemand ? 'Flow grouping by economy or category' : 'Flow grouping by economy or industry');
        [['country', 'By Country'], ['detail', finalDemand ? 'Country × Demand Category' : 'Country × Industry']].forEach(([value, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.setAttribute('aria-pressed', String(mode === value));
          button.addEventListener('click', () => { mode = value; renderFlow(); });
          controls.append(button);
        });
        context.chart.append(controls);
      }
      const groups = flowGroups(data.rows, mode);
      if (total > 0) drawSankey(context, groups, direction, mode, data.labels, total);
      else context.chart.insertAdjacentHTML('beforeend', `<p class="question-subtotal"><strong>${esc(context.money(observedSum))}</strong> signed observed subtotal · no positive ribbons</p>`);
      const adjustment = negative.length ? ` ${negative.length} negative cells sum to ${context.money(sum(negative.map(row => row.value)))} and remain signed adjustments; they do not receive ribbon widths.` : '';
      const notes = [
        upstream ? 'Observed suppliers connect to the financial sector in the selected economy. Widths show positive observed input amounts.' : finalDemand ? 'The selected economy’s financial sector connects to observed final-demand economies and categories.' : 'The selected economy’s financial sector connects to observed user economies and industries.',
        `Cross-border observations only; domestic self-links are excluded. Positive observed amount: ${positive.length ? context.money(total) : observed.length ? context.money(0) : 'not observed'}. Signed sum of numeric observations: ${context.money(observedSum)}. ${positive.length} positive, ${zero} zero and ${missing} missing displayed-scope records.${adjustment} The eight largest groups and a residual group conserve the positive amount shown. Percentages use that full positive observed amount.`,
        !data.detailed ? `Country flows use the active metric and industry/category filter. Detailed country–industry observations are unavailable for this selection; industry identities are not inferred.${context.view.missing > 0 ? ` The active filtered view has ${context.view.missing} additional rows without numeric values; their attribution to this selected economy is unavailable.` : ''}` : 'Country × industry/category grouping keeps the counterparty economy and its industry/category together. Other Observed Economies represents a residual sum of observed economies, not a country or the rest of the world. Counts refer to records in this compact view, which may include grouped residual observations.',
        allocated ? 'Amounts are allocated direct financial value added: the source financial industry’s value-added/output coefficient multiplied by its direct sales. This is not an indirect value-added attribution through subsequent production.' : ''
      ];
      context.chart.insertAdjacentHTML('beforeend', sourceNotes(notes));
    };
    renderFlow();
  }

  window.FinGeoViews = {
    render(options = {}) {
      const panel = document.getElementById('question-panel');
      const title = document.getElementById('question-title');
      const description = document.getElementById('question-description');
      const chart = document.getElementById('question-chart');
      if (!panel || !title || !description || !chart) return;
      const supported = ['amne_production', 'amne_control', 'icio_upstream', 'icio_downstream', 'icio_final_demand'].includes(options.layerId);
      panel.hidden = !supported;
      chart.replaceChildren();
      if (!supported) return;
      const names = options.names || options.manifest?.countryNames || {};
      const context = { ...options, panel, title, description, chart, layer: options.layer || {}, view: options.view || {}, state: options.state || {}, countryName: code => String(names[code] || code || 'Not observed'), money: options.money || (value => finite(value) ? `${value.toLocaleString('en-GB')} USD million` : 'Not observed'), percentage: options.percentage || (value => finite(value) ? `${(value * 100).toFixed(1)}%` : 'Not observed'), onCountry: typeof options.onCountry === 'function' ? options.onCountry : () => {} };
      if (options.layerId === 'amne_production') production(context);
      else if (options.layerId === 'amne_control') control(context);
      else flows(context);
    }
  };
})();
