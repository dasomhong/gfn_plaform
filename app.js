/* FinGeo: a local, dependency-free viewer for the generated research data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const NAVY = '#002147';
  const RUST = '#a75039';
  const PROFILE_COLOURS = ['#002147', '#3a8c83', '#b37b42', '#8a719e', '#7399ba', '#ac6670'];
  const DEPENDENCY_SHARE = 'mapped_foreign_intermediate_share_in_published_total';
  const manifest = window.FINGEO_MANIFEST;
  const world = window.FINGEO_WORLD || { features: [] };
  const cache = new Map();
  const pending = new Map();
  const names = manifest?.countryNames || {};
  const featureMap = new Map((world.features || []).map(f => [f.code, f]));
  const geometryPaths = new Map();
  const state = { tab: 'production', layer: '', year: null, comparison: '', country: '', direction: 'in', metric: 'focal', industry: 'all', filterKind: 'industry', view: 'map', limit: 100, zoom: 1, playing: false, ticket: 0 };
  let active = null;
  let playTimer = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const countryName = code => names[code] || featureMap.get(code)?.name || code;
  const number = (value, digits = 0) => finite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: digits }) : 'Not observed';
  const money = (value, signed = false) => {
    if (!finite(value)) return 'Not observed';
    const abs = Math.abs(value);
    const prefix = value < 0 ? '−' : signed && value > 0 ? '+' : '';
    if (abs >= 1e6) return `${prefix}$${number(abs / 1e6, abs >= 1e7 ? 1 : 2)}tn`;
    if (abs >= 1e3) return `${prefix}$${number(abs / 1e3, abs >= 1e5 ? 0 : 1)}bn`;
    return `${prefix}$${number(abs, abs >= 100 ? 0 : 1)}m`;
  };
  const percentage = value => finite(value) ? `${number(value * 100, 1)}%` : 'Not observed';
  const setStatus = text => { $('app-status').textContent = text; };
  const def = () => manifest?.layerDefs?.[state.layer] || {};
  const availableYears = () => (manifest?.available?.[state.layer] || manifest?.years || []).map(Number).sort((a, b) => a - b);
  const calendarYears = () => availableYears();
  const controlSpec = () => manifest?.viewControls?.[state.layer] || {};
  const defaultMetric = () => controlSpec().defaultMetric || def().defaultMetric || 'focal';
  const isProduction = () => def().hasNetwork === false;
  const comparisonAllowed = metric => ['focal','out_total','in_total','allocated_va',...(isProduction()?['gross_output','value_added']:[])].includes(metric);
  const isControl = () => state.layer === 'amne_control';
  const isSector = () => state.industry !== 'all';
  const isAllocated = () => state.metric === 'allocated_va';
  const scopeName = () => state.filterKind === 'demand' ? 'all-category' : state.filterKind === 'industry' ? 'all-industry' : 'aggregate';
  const filterName = () => state.filterKind === 'demand' ? 'Final-demand category' : 'Industry';
  const dependencyLabel = () => state.layer === 'icio_upstream' ? 'Mapped foreign inputs / published financial intermediate inputs' : state.layer === 'icio_downstream' ? 'Mapped foreign sales / published financial intermediate sales' : 'Mapped foreign intermediate share of published total';
  const crossBorderEdges = () => (active?.view.edges || []).filter(edge => edge.s !== edge.t);
  const sourceText = value => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(sourceText).filter(Boolean).join(' · ');
    return value?.label || value?.name || value?.title || '';
  };

  function trimCache() {
    const protectedYears = new Set([`${state.year}/${state.layer}`, `${state.comparison}/${state.layer}`]);
    while (cache.size > 6) {
      const victim = [...cache.keys()].find(key => !protectedYears.has(key));
      if (victim === undefined) break;
      cache.delete(victim);
    }
  }
  function touchCache(key, payload) {
    cache.delete(key);
    cache.set(key, payload);
    trimCache();
  }

  // Dynamic script registration is defined before any year file is requested.
  window.FinGeoData = {
    register(year, payload) {
      for (const layerId of Object.keys(payload.layers || {})) finishLoad(`${year}/${layerId}`,payload);
    },
    registerLayer(year, layerId, layer) { finishLoad(`${year}/${layerId}`, {year,layers:{[layerId]:layer}}); },
    registerDetail(key, payload) { finishLoad(`detail:${key}`,payload); }
  };

  function finishLoad(key,payload) {
      touchCache(key,payload);
      if (pending.has(key)) {
        const job = pending.get(key);
        clearTimeout(job.timeout);
        pending.delete(key);
        job.script.remove();
        job.resolve(payload);
      }
  }

  function loadYear(year) {
    const key = `${year}/${state.layer}`;
    if (window.FINGEO_EMBEDDED_DATA?.[String(year)]) return Promise.resolve(window.FINGEO_EMBEDDED_DATA[String(year)]);
    return loadScript(key,manifest.layerFiles?.[String(year)]?.[state.layer] || manifest.files?.[String(year)]);
  }

  function loadScript(key,file) {
    if (cache.has(key)) { const payload = cache.get(key); touchCache(key, payload); return Promise.resolve(payload); }
    if (pending.has(key)) return pending.get(key).promise;
    if (!file) return Promise.reject(new Error(`No local data file is listed for ${key}.`));
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const script = document.createElement('script');
    const fail = message => {
      const job = pending.get(key);
      if (!job) return;
      clearTimeout(job.timeout);
      pending.delete(key);
      script.remove();
      reject(new Error(message));
    };
    const timeout = window.setTimeout(() => fail(`The local data file for ${key} did not register. Check the generated data files.`), 25000);
    pending.set(key, { promise, resolve, reject, timeout, script });
    script.src = file;
    script.async = true;
    script.onerror = () => fail(`The local data file for ${key} could not be opened.`);
    document.head.appendChild(script);
    return promise;
  }

  async function withIndustryDetail(year, layer) {
    if (!isSector() || !layer.industryCodes?.includes(state.industry)) return layer;
    const key = `${year}/${state.layer}/${state.industry}`;
    const embedded = window.FINGEO_EMBEDDED_DETAILS?.[key];
    const detail = embedded || await loadScript(`detail:${key}`,manifest.detailFiles?.[String(year)]?.[state.layer]?.[state.industry]);
    return {...layer, industryEdges:detail.edges, industryVAEdges:detail.vaEdges};
  }

  function initialise() {
    if (!manifest?.layerDefs || !Object.keys(manifest.layerDefs).length) {
      $('loading-state').textContent = 'The generated manifest is missing. Generate the local data bundle, then reopen this page.';
      $('coverage-banner').innerHTML = '<span class="coverage-icon">i</span><div><strong>No data manifest was found.</strong> This viewer displays generated observations only. No illustrative data are substituted.</div>';
      return;
    }
    document.title = manifest.title || 'FinGeo — Global Financial Network Platform';
    const options = Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));
    $('country-options').innerHTML = options.map(([code, name]) => `<option value="${esc(name)}">${esc(code)}</option>`).join('');
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      if (state.tab === button.dataset.tab) return;
      stopPlay();
      state.tab = button.dataset.tab;
      state.industry = 'all';
      state.comparison = '';
      state.metric = 'focal';
      setupLayers();
      refresh();
    }));
    $('layer-select').addEventListener('change', event => {
      stopPlay();
      state.layer = event.target.value;
      state.industry = 'all';
      state.metric = defaultMetric();
      state.comparison = '';
      state.direction = def().focalRole === 'source' ? 'out' : 'in';
      setupYears();
      refresh();
    });
    $('year-slider').addEventListener('input', event => {
      state.year = calendarYears()[Number(event.target.value)];
      state.yearNotice='';
      if (String(state.year) === state.comparison) state.comparison = '';
      updateYearControls();
      refresh();
    });
    $('play-years').addEventListener('click', () => state.playing ? stopPlay() : startPlay());
    $('compare-select').addEventListener('change', event => {
      stopPlay();
      state.comparison = event.target.value;
      if (state.comparison && !comparisonAllowed(state.metric)) state.metric = defaultMetric();
      $('metric-select').value = state.metric;
      refresh();
    });
    $('country-search').addEventListener('change', selectSearch);
    $('country-search').addEventListener('keydown', event => { if (event.key === 'Enter') selectSearch(); if (event.key === 'Escape') $('country-search').value = state.country ? countryName(state.country) : ''; });
    $('reset-global').addEventListener('click', () => selectCountry(''));
    $('metric-select').addEventListener('change', event => {
      state.metric = event.target.value;
      if(isControl()&&['in_total','out_total'].includes(state.metric)) state.direction=state.metric==='in_total'?'in':'out';
      if (state.comparison && !comparisonAllowed(state.metric)) { state.comparison = ''; updateYearControls(); }
      refresh();
    });
    $('industry-select').addEventListener('change', event => { state.industry = event.target.value; refresh(); });
    document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => { state.direction = button.dataset.direction;if(isControl()&&['focal','out_total','in_total'].includes(state.metric)){state.metric=`${state.direction}_total`;$('metric-select').value=state.metric;}render(); }));
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.zoom = 1;$('pca-inset').open=false;render(); }));
    $('edge-limit').addEventListener('input', event => { state.limit = Number(event.target.value); $('edge-limit-value').textContent = state.limit; renderGraph(); });
    $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(3.5, state.zoom + .4); renderGraph(); });
    $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(1, state.zoom - .4); renderGraph(); });
    $('zoom-reset').addEventListener('click', () => { state.zoom = 1; renderGraph(); });
    $('network-svg').addEventListener('mouseleave', hideTooltip);
    window.addEventListener('blur', hideTooltip);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
    setupLayers();
    refresh();
  }

  function setupLayers() {
    const entriesFor = tab => Object.entries(manifest.layerDefs).filter(([, layer]) => layer.tab === tab || layer.tabs?.includes(tab));
    if (!entriesFor(state.tab).length) state.tab = ['production', 'industry', 'assets'].find(tab => entriesFor(tab).length) || state.tab;
    const entries = entriesFor(state.tab);
    if (!entries.some(([id]) => id === state.layer)) state.layer = entries[0]?.[0] || '';
    $('layer-select').innerHTML = entries.map(([id, layer]) => `<option value="${esc(id)}">${esc(layer.label || id)}</option>`).join('');
    $('layer-select').value = state.layer;
    document.querySelectorAll('[data-tab]').forEach(button => {
      const enabled = entriesFor(button.dataset.tab).length > 0;
      button.disabled = !enabled;
      button.title = enabled ? '' : 'No analysed relationships are available in this theme.';
      const selected = button.dataset.tab === state.tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    state.direction = def().focalRole === 'source' ? 'out' : 'in';
    state.metric = defaultMetric();
    setupYears();
  }

  function setupYears() {
    const years = calendarYears();
    const requested=Number(state.year ?? manifest.defaultYear ?? years.at(-1));
    state.year=years.includes(requested)?requested:years.reduce((best,year)=>Math.abs(year-requested)<Math.abs(best-requested)?year:best,years[0]);
    state.yearNotice=state.year!==requested&&state.year!==undefined?`Showing ${state.year}; ${requested} is outside this view’s available years.`:'';
    if(!years.includes(Number(state.comparison))||Number(state.comparison)===state.year) state.comparison='';
    $('pca-inset').open=false;
    $('year-slider').max = Math.max(0, years.length - 1);
    $('year-slider').disabled = years.length < 2;
    $('play-years').disabled = availableYears().length < 2;
    $('year-start').textContent = years[0] ?? '—';
    $('year-end').textContent = years.at(-1) ?? '—';
    updateYearControls();
  }

  function updateYearControls() {
    const years = calendarYears();
    $('year-label').value = state.year ?? '—';
    $('year-slider').value = Math.max(0, years.indexOf(state.year));
    $('year-slider').setAttribute('aria-valuetext', String(state.year ?? 'No available year'));
    $('compare-select').disabled = false;
    $('compare-select').innerHTML = '<option value="">No Comparison</option>' + availableYears().filter(year => year !== state.year).map(year => `<option value="${year}">${year}</option>`).join('');
    $('compare-select').value = state.comparison;
    $('year-coverage').textContent=years.length?`${sourceText(def().source)} · Available ${years[0]}–${years.at(-1)} (${years.length} years). ${state.yearNotice||''}`:'No available years for this view.';
  }

  function startPlay() {
    if (availableYears().length < 2) return;
    state.playing = true;
    $('play-years').textContent = 'Ⅱ';
    $('play-years').setAttribute('aria-label', 'Pause year playback');
    $('play-years').title = 'Pause year playback';
    playTimer = window.setTimeout(advanceYear, 1800);
  }
  function stopPlay() {
    state.playing = false;
    clearTimeout(playTimer);
    $('play-years').textContent = '▶';
    $('play-years').setAttribute('aria-label', 'Play available years');
    $('play-years').title = 'Play available years';
  }
  async function advanceYear() {
    if (!state.playing) return;
    const years = availableYears();
    const next = years.find(year => year > state.year);
    if (next === undefined) { stopPlay(); return; }
    state.year = next;
    state.yearNotice='';
    if (state.comparison === String(state.year)) state.comparison = '';
    updateYearControls();
    await refresh();
    if (state.playing) playTimer = window.setTimeout(advanceYear, 1800);
  }

  function selectSearch() {
    const input = $('country-search').value.trim();
    if (!input) { selectCountry(''); return; }
    const code = Object.keys(names).find(code => code.toLowerCase() === input.toLowerCase() || names[code].toLowerCase() === input.toLowerCase()) || world.features.find(f => f.code.toLowerCase() === input.toLowerCase() || f.name.toLowerCase() === input.toLowerCase())?.code;
    if (code) selectCountry(code);
    else setStatus('No matching country. Choose a country name from the suggestions or enter an ISO code.');
  }

  function selectCountry(code) {
    state.country = code;
    $('country-search').value = code ? countryName(code) : '';
    $('selection-label').textContent = code ? countryName(code) : 'Global overview';
    hideTooltip();
    render();
    setStatus(code ? `${countryName(code)} selected.` : 'Global overview restored.');
  }

  async function refresh() {
    const ticket = ++state.ticket;
    active = null;
    trimCache();
    $('loading-state').hidden = false;
    $('loading-state').textContent = 'Loading observed data…';
    $('pca-inset').hidden = true;
    $('question-panel').hidden = true;
    $('company-card').hidden = true;
    document.querySelector('.detail-grid').hidden = true;
    $('question-layout').classList.remove('beside');
    $('layer-description').textContent = def().description || '';
    $('source-label').textContent = sourceText(def().source) || 'See source notes below';
    $('unit-label').textContent = 'Values normalised to USD millions';
    document.querySelector('.direction-field').hidden = isProduction();
    document.querySelector('.display-control').hidden = isProduction();
    document.querySelector('[data-view="network"]').disabled = isProduction();
    if (isProduction()) state.view = 'map';
    if (isControl()) {
      document.querySelector('[data-direction="in"]').textContent = 'Controlled By';
      document.querySelector('[data-direction="out"]').textContent = 'Controls Abroad';
    } else {
      document.querySelector('[data-direction="in"]').textContent = 'Incoming';
      document.querySelector('[data-direction="out"]').textContent = 'Outgoing';
    }
    if (!state.layer || state.year === undefined) {
      $('loading-state').textContent = 'No observations are available for this research theme.';
      return;
    }
    try {
      if (!availableYears().includes(state.year)) throw new Error(`Data Not Available for ${state.year}. Available years: ${availableYears().join(', ')}. The selected year has been preserved.`);
      const [current, comparison] = await Promise.all([loadYear(state.year), state.comparison ? loadYear(state.comparison) : Promise.resolve(null)]);
      if (ticket !== state.ticket) return;
      let layer = current.layers?.[state.layer];
      if (!layer) throw new Error(`This relationship has no data for ${state.year}.`);
      let old = comparison?.layers?.[state.layer];
      if (state.comparison && !old) throw new Error(`This relationship has no comparable layer for ${state.comparison}.`);
      setupIndustry(layer);
      [layer,old] = await Promise.all([withIndustryDetail(state.year,layer),old?withIndustryDetail(state.comparison,old):Promise.resolve(null)]);
      if (ticket !== state.ticket) return;
      setupMetricOptions(layer);
      const currentView = makeView(layer);
      active = { layer, old, current: currentView, view: old ? isProduction() ? compareAccounts(layer,old) : compareViews(currentView, makeView(old)) : currentView, error: '' };
      $('loading-state').hidden = true;
      render();
      setStatus(`${def().label}, ${state.year}${state.comparison ? ` compared with ${state.comparison}` : ''}, loaded.`);
    } catch (error) {
      if (ticket !== state.ticket) return;
      stopPlay();
      active = null;
      $('loading-state').textContent = error.message;
      $('summary-strip').innerHTML = '';
      $('network-svg').innerHTML = '';
      $('coverage-banner').className = 'coverage-banner warning';
      $('coverage-banner').innerHTML = `<span class="coverage-icon">!</span><div><strong>Data could not be displayed.</strong> ${esc(error.message)} No values have been substituted.</div>`;
      ['country-metrics', 'partner-list', 'trend-chart', 'concentration-metrics', 'concentration-chart', 'account-breakdown', 'coverage-detail', 'company-detail'].forEach(id => { $(id).innerHTML = ''; });
      $('concentration-note').textContent = '';
      $('company-card').hidden = true;
      $('question-panel').hidden = true;
      $('pca-inset').hidden = true;
      $('industry-field').hidden = true;
      titleCaseLabels();
      setStatus(error.message);
    }
  }

  function filterSpec(layer) {
    if (state.tab === 'industry' && layer.industryCodes?.length) return {kind:'industry',rows:layer.industryEdges,vaRows:layer.industryVAEdges,names:layer.industryNames||{},codes:layer.industryCodes};
    if (state.tab === 'industry' && Array.isArray(layer.industryEdges) && layer.industryEdges.length) return { kind: 'industry', rows: layer.industryEdges, vaRows: layer.industryVAEdges, names: layer.industryNames || {} };
    if (Array.isArray(layer.demandEdges) && layer.demandEdges.length) return { kind: 'demand', rows: layer.demandEdges, vaRows: layer.demandVAEdges, names: layer.demandNames || layer.demandCategoryNames || layer.categoryNames || {} };
    return { kind: 'none', rows: null, vaRows: null, names: {} };
  }
  function setupIndustry(layer) {
    const spec = filterSpec(layer);
    state.filterKind = spec.kind;
    const hasFilter = Boolean(spec.codes?.length || spec.rows?.length);
    $('industry-field').hidden = !hasFilter;
    document.querySelector('label[for="industry-select"]').textContent = spec.kind === 'demand' ? 'Final-demand category' : 'ICIO industry view';
    $('industry-field').querySelector('.control-description').textContent = `${spec.kind === 'demand' ? 'Category' : 'Industry'} selection recalculates observed links and totals. Trends remain the ${scopeName()} series.`;
    const codes = spec.codes || (hasFilter ? [...new Set(spec.rows.map(edge => String(edge[2])))].sort() : []);
    if (!codes.includes(state.industry)) state.industry = 'all';
    $('industry-select').innerHTML = `<option value="all">${spec.kind === 'demand' ? 'All final-demand categories' : 'All industries'}</option>` + codes.map(code => `<option value="${esc(code)}">${esc(code)} — ${esc(spec.names[code] || code)}</option>`).join('');
    $('industry-select').value = state.industry;
  }

  function setupMetricOptions(layer) {
    const select = $('metric-select');
    const spec=controlSpec();
    document.querySelector('label[for="metric-select"]').textContent=spec.label||'Map Measure';
    const accounts = Object.values(layer.accounts || {});
    const accountMetrics = ['gross_output', 'value_added', 'foreign_output_share', 'foreign_va_share'];
    const choices=(spec.metrics||[['focal','Relationship Total']]).filter(([key])=>{
      if(state.comparison&&!comparisonAllowed(key)) return false;
      if(isSector()&&!["focal","out_total","in_total","allocated_va"].includes(key)) return false;
      if(key==='allocated_va') return Array.isArray(layer.vaEdges);
      if(key===DEPENDENCY_SHARE) return Object.values(layer.nodes||{}).some(node=>finite(node?.[key]));
      if(accountMetrics.includes(key)) return accounts.some(account=>finite(account?.[key]));
      return true;
    });
    select.replaceChildren(...choices.map(([key,label])=>new Option(label,key)));
    if(!choices.some(([key])=>key===state.metric)) state.metric=choices.some(([key])=>key===defaultMetric())?defaultMetric():choices[0]?.[0]||'focal';
    select.disabled=choices.length<2;
    select.value = state.metric;
  }

  function aggregateEdges(rows, sector = false) {
    const map = new Map();
    let missing = 0;
    for (const row of rows || []) {
      if (sector && String(row[2]) !== state.industry) continue;
      const value = row[sector ? 3 : 2];
      if (!finite(value)) { missing++; continue; }
      const s = String(row[0]), t = String(row[1]);
      if (!s || !t) continue;
      const key = `${s}\u0000${t}`;
      if (map.has(key)) map.get(key).value += value;
      else map.set(key, { s, t, value });
    }
    return { edges: [...map.values()], missing };
  }

  function nodesFromEdges(edges, codes = []) {
    const nodes = Object.fromEntries([...codes].map(code => [code, blankNode()]));
    for (const edge of edges) {
      nodes[edge.s] ||= blankNode(); nodes[edge.t] ||= blankNode();
      if (edge.s === edge.t) { nodes[edge.s].domestic_sum = (nodes[edge.s].domestic_sum ?? 0) + edge.value; continue; }
      for (const [code, direction] of [[edge.s, 'out'], [edge.t, 'in']]) {
        const node = nodes[code];
        node[`${direction}_total`] = (node[`${direction}_total`] ?? 0) + edge.value;
        node[`${direction}_degree`] = (node[`${direction}_degree`] ?? 0) + (edge.value !== 0 ? 1 : 0);
        if (edge.value >= 0) node[`${direction}_positive`] = (node[`${direction}_positive`] ?? 0) + edge.value;
        else node[`${direction}_negative_magnitude`] = (node[`${direction}_negative_magnitude`] ?? 0) + Math.abs(edge.value);
      }
    }
    return nodes;
  }
  function blankNode() { return { out_total: null, in_total: null, domestic_sum: null, out_degree: null, in_degree: null, out_hhi_observed: null, in_hhi_observed: null, pagerank_observed: null }; }

  function makeView(layer) {
    let rows, sector = false, missingReason = '';
    const spec = filterSpec(layer);
    if (isAllocated()) {
      if (isSector()) { rows = spec.vaRows; sector = true; }
      else rows = layer.vaEdges;
      if (!Array.isArray(rows)) missingReason = 'Allocated direct value-added observations are unavailable for this selection.';
    } else if (isSector()) { rows = spec.rows; sector = true; if (!Array.isArray(rows)) missingReason = `${filterName()} observations are unavailable for this year.`; }
    else rows = layer.edges;
    const result = aggregateEdges(rows, sector);
    const codes = new Set(Object.keys(layer.nodes || {}));
    const nodes = nodesFromEdges(result.edges, codes);
    if (!isSector() && !isAllocated()) for (const [code, node] of Object.entries(layer.nodes || {})) nodes[code] = { ...nodes[code], ...node };
    return { ...result, nodes, missingReason, matched: null, isComparison: false };
  }

  function compareViews(current, previous) {
    const prior = new Map(previous.edges.map(edge => [`${edge.s}\u0000${edge.t}`, edge.value]));
    const edges = current.edges.filter(edge => prior.has(`${edge.s}\u0000${edge.t}`)).map(edge => ({ ...edge, current: edge.value, previous: prior.get(`${edge.s}\u0000${edge.t}`), value: edge.value - prior.get(`${edge.s}\u0000${edge.t}`) }));
    const nodes = nodesFromEdges(edges, new Set([...Object.keys(current.nodes), ...Object.keys(previous.nodes)]));
    return { edges, nodes, missing: current.missing + previous.missing, missingReason: current.missingReason || previous.missingReason, matched: edges.filter(edge => edge.s !== edge.t).length, currentDyads: current.edges.filter(edge => edge.s !== edge.t).length, previousDyads: previous.edges.filter(edge => edge.s !== edge.t).length, isComparison: true };
  }

  function compareAccounts(current,previous) {
    const nodes={};let matched=0;
    for(const code of new Set([...Object.keys(current.accounts||{}),...Object.keys(previous.accounts||{})])) {
      nodes[code]={};
      for(const key of ['gross_output','value_added']) {const a=current.accounts?.[code]?.[key],b=previous.accounts?.[code]?.[key];nodes[code][key]=finite(a)&&finite(b)?a-b:null;}
      if(finite(nodes[code].gross_output)||finite(nodes[code].value_added)) matched++;
    }
    return {nodes,edges:[],matched,isComparison:true,missing:0,missingReason:''};
  }

  function metricKey() {
    if (state.metric === 'focal' || state.metric === 'allocated_va') return `${def().focalRole === 'source' ? 'out' : 'in'}_total`;
    return state.metric;
  }
  function metricValue(code) {
    const key = metricKey();
    if (active?.view.isComparison) return active.view.nodes[code]?.[key];
    if (['gross_output', 'value_added', 'foreign_output_share', 'foreign_va_share'].includes(key)) return active?.layer.accounts?.[code]?.[key] ?? active?.view.nodes[code]?.[key];
    return active?.view.nodes[code]?.[key];
  }
  function metricFormat(value, signed = Boolean(state.comparison)) {
    const key = metricKey();
    if (key.includes('share')) return percentage(value);
    if (key.includes('hhi') || key === 'pagerank_observed') return finite(value) ? number(value, 4) : 'Not observed';
    return money(value, signed);
  }
  function metricLabel() {
    const configured=controlSpec().metrics?.find(([key])=>key===state.metric)?.[1];
    if(configured) return configured;
    if (state.metric === DEPENDENCY_SHARE) return dependencyLabel();
    const key = metricKey();
    const labels = { out_total: 'Outgoing observed total', in_total: 'Incoming observed total', out_hhi_observed: 'Outgoing observed HHI', in_hhi_observed: 'Incoming observed HHI', pagerank_observed: 'Observed-network PageRank', gross_output: 'Gross output', value_added: 'Value added', foreign_output_share: 'Foreign-controlled output share', foreign_va_share: 'Foreign-controlled value added share' };
    return isAllocated() ? `Allocated direct value added · ${def().focalRole === 'source' ? 'outgoing' : 'incoming'}` : labels[key] || 'Observed value';
  }
  function directionRole(direction) {
    const role = direction === 'out' ? def().sourceRole : def().targetRole;
    return sourceText(role) || (direction === 'out' ? 'source' : 'target');
  }

  function render() {
    if (!active) return;
    $('selection-label').textContent = state.country ? countryName(state.country) : 'Global overview';
    document.querySelectorAll('[data-direction]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.direction === state.direction)));
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
    $('direction-description').textContent = isControl() ? state.direction === 'in' ? 'Production host perspective: identify the ultimate parent economies controlling financial production here.' : 'Parent economy perspective: identify the host economies where this economy’s corporate groups control financial production.' : `${state.direction === 'out' ? 'Outgoing: selected country is the source' : 'Incoming: selected country is the target'} (${directionRole(state.direction)}). Arrows retain the source’s original direction.`;
    $('view-eyebrow').textContent = `${state.country ? countryName(state.country) : 'Global overview'} · ${state.year}${isSector() ? ` · ${state.industry}` : ''}`;
    $('view-title').textContent = `${state.comparison ? 'Change in ' : ''}${isAllocated() ? 'Allocated direct financial value added' : def().label || 'Observed relationships'}`;
    const edges = crossBorderEdges();
    const allCodes = new Set(edges.flatMap(edge => [edge.s, edge.t]));
    const total = edges.reduce((sum, edge) => sum + edge.value, 0);
    const changeLabel=state.tab==='assets'?'Matched Position Change':isControl()?'Matched Controlled-Output Change':'Matched Supply/Use Change';
    $('summary-strip').innerHTML = `<div class="summary-item"><span>${state.comparison ? changeLabel : 'Observed cross-border sum'}</span><strong>${edges.length ? money(total, Boolean(state.comparison)) : 'Not observed'}</strong></div><div class="summary-item"><span>Economies with observations</span><strong>${number(allCodes.size)}</strong></div><div class="summary-item"><span>${state.comparison ? 'Matched cross-border dyads' : 'Observed cross-border dyads'}</span><strong>${number(edges.length)}</strong></div>`;
    if (isProduction()) {
      const values = Object.keys(active.layer.accounts || {}).map(metricValue).filter(finite);
      const shareMetric=state.metric==='foreign_output_share'||state.metric==='foreign_va_share';
      const componentKeys=state.metric==='foreign_va_share'?['domestic_va','foreign_va']:['domestic_output','foreign_output'];
      const eligible=Object.values(active.layer.accounts||{}).filter(row=>componentKeys.every(key=>finite(row[key])&&row[key]>=0));
      const denominator=eligible.reduce((total,row)=>total+row[componentKeys[0]]+row[componentKeys[1]],0);
      const foreignTotal=eligible.reduce((total,row)=>total+row[componentKeys[1]],0);
      const summaryValue=shareMetric?percentage(denominator>0?foreignTotal/denominator:null):values.length?money(values.reduce((a,b)=>a+b,0),Boolean(state.comparison)):'Not Observed';
      $('summary-strip').innerHTML = `<div class="summary-item"><span>${esc(metricLabel())} · Mapped Economies</span><strong>${summaryValue}</strong></div><div class="summary-item"><span>${shareMetric?'Eligible Economies':'Economies With Accounts'}</span><strong>${shareMetric?eligible.length:values.length}</strong></div><div class="summary-item"><span>Scope</span><strong>${shareMetric?'Share of Summed Accounts':'Financial Sector'}</strong></div>`;
    }
    $('comparison-note').hidden = !state.comparison;
    const comparisonType = state.tab === 'assets' ? 'position' : isControl() ? 'controlled financial output' : 'direct financial-service supply/use';
    $('comparison-note').textContent = state.comparison ? isProduction() ? `${state.year} − ${state.comparison}: ${active.view.matched} economies with comparable financial accounts. The map shows nominal account changes; ownership donuts show current-year levels. Values are not adjusted for inflation or exchange rates.` : `${state.year} − ${state.comparison}: ${number(active.view.matched)} cross-border country pairs observed in both years, including observed zeros. The map and lines show changes in ${comparisonType}; line width is absolute change. Negative changes mean decreases, not reversed relationships.${state.tab === 'assets'?' Position changes are not transaction flows.':' These are nominal changes, not real growth.'}` : '';
    renderGraph();
    renderCountry();
    renderPartners();
    renderTrend();
    renderConcentration();
    renderCompanies();
    window.FinGeoViews?.render({layerId:state.layer,layer:active.layer,view:active.view,state,manifest,names,money,percentage,onCountry:selectCountry});
    arrangePanels();
    renderCoverage();
    titleCaseLabels();
  }

  function arrangePanels() {
    const beside=(state.layer==='amne_production'||isControl())&&!$('question-panel').hidden;
    $('question-layout').classList.toggle('beside',beside);
    $('question-layout').classList.toggle('production-layout',state.layer==='amne_production');
    $('question-layout').classList.toggle('control-layout',isControl());
    const hasCountry=Boolean(state.country),comparison=Boolean(state.comparison);
    document.querySelector('.country-card').hidden=isProduction()||(!comparison&&state.tab!=='assets')||(!comparison&&!hasCountry);
    $('partners-card').hidden=isProduction()||(!comparison&&state.tab!=='assets');
    const trend=manifest.trends?.[state.layer]?.[state.country]||[];
    document.querySelector('.trend-card').hidden=!hasCountry||!trend.some(row=>row.slice(1,7).some(finite));
    document.querySelector('.concentration-card').hidden=isProduction()||comparison;
    const cards=[...document.querySelector('.detail-grid').children];
    cards.forEach(card=>card.classList.remove('span-all'));
    const visible=cards.filter(card=>!card.hidden);
    if(visible.length%2===1) visible.at(-1).classList.add('span-all');
    document.querySelector('.detail-grid').hidden=!visible.length;
  }

  function titleCaseLabels() {
    document.querySelectorAll('h1,h2,h3,label,legend,summary,.small-label,.eyebrow,.summary-item>span,.metric-cell>span,select option,button:not(.partner-row):not(.concentration-row)').forEach(element => {
      if (element.id === 'hero-title') return;
      for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) child.textContent = child.textContent.replace(/\b[a-z]/g, c => c.toUpperCase());
    });
  }

  function svgElement(name, attrs = {}, text = '') {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    if (text) element.textContent = text;
    return element;
  }
  function project(lon, lat) { return [30 + (lon + 180) / 360 * 1000, 29 + (85 - lat) / 150 * 451]; }
  function ringPath(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return '';
    const segments = []; let part = []; let previous = null;
    for (const point of ring) {
      if (!Array.isArray(point) || !finite(point[0]) || !finite(point[1])) continue;
      if (previous && Math.abs(point[0] - previous[0]) > 180) { if (part.length > 2) segments.push(part); part = []; }
      part.push(project(point[0], Math.max(-65, Math.min(85, point[1]))));
      previous = point;
    }
    if (part.length > 2) segments.push(part);
    return segments.map(points => `M${points.map(point => point.map(n => n.toFixed(2)).join(',')).join('L')}Z`).join('');
  }
  function mixColour(a, b, t) {
    const one = a.match(/\w\w/g).map(v => parseInt(v, 16)), two = b.match(/\w\w/g).map(v => parseInt(v, 16));
    return `#${one.map((v, i) => Math.round(v + (two[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('')}`;
  }
  function colourScale() {
    const values = Object.keys(active.view.nodes).map(metricValue).filter(finite);
    const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0;
    const negative = min < 0;
    const extent = Math.max(Math.abs(min), Math.abs(max), 1e-12);
    const share = metricKey().includes('share');
    return { min: negative ? -extent : 0, max: share ? 1 : negative ? extent : max, negative, fill(value) {
      if (!finite(value)) return '#e2e7eb';
      const amount = share ? Math.max(0, Math.min(1, value)) : negative ? Math.abs(value) / extent : max ? Math.max(0, value) / max : 0;
      const t = ['out_total', 'in_total', 'gross_output', 'value_added'].includes(metricKey()) ? Math.sqrt(amount) : amount;
      return mixColour('edf2f6', value < 0 ? 'a75039' : '002147', t);
    } };
  }
  function visibleEdges() {
    return active.view.edges.filter(edge => edge.s !== edge.t && edge.value !== 0 && (!state.country || (state.direction === 'out' ? edge.s === state.country : edge.t === state.country))).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, state.limit);
  }
  function renderGraph() {
    if (!active) return;
    const svg = $('network-svg');
    svg.replaceChildren();
    svg.setAttribute('aria-label', `${state.view === 'map' ? 'World map' : 'Network'}: ${metricLabel()}, ${state.year}${state.country ? `, ${countryName(state.country)}` : ''}. Use country search for full keyboard navigation.`);
    const defs = svgElement('defs');
    for (const [id, colour] of [['positive', '#4e7f9f'], ['negative', RUST]]) { const marker = svgElement('marker', { id: `arrow-${id}`, markerWidth: 5, markerHeight: 5, refX: 4, refY: 2.5, orient: 'auto', markerUnits: 'userSpaceOnUse' }); marker.append(svgElement('path', { d: 'M0,0L5,2.5L0,5Z', fill: colour })); defs.append(marker); }
    svg.append(defs);
    const group = svgElement('g', { transform: `translate(${530 * (1 - state.zoom)},${260 * (1 - state.zoom)}) scale(${state.zoom})` });
    svg.append(group);
    const scale = colourScale();
    const edges = visibleEdges();
    const positions = state.view === 'map' ? new Map(world.features.filter(f => f.center?.length === 2).map(f => [f.code, project(...f.center)])) : networkPositions(edges);
    if (state.view === 'map') {
      const graticule = svgElement('g', { class: 'graticule', 'aria-hidden': 'true' });
      for (const lat of [-30, 0, 30, 60]) { const [x, y] = project(-180, lat); graticule.append(svgElement('path', { d: `M${x},${y}H1030` })); }
      for (const lon of [-120, -60, 0, 60, 120]) { const [x] = project(lon, 0); graticule.append(svgElement('path', { d: `M${x},29V480` })); }
      group.append(graticule);
      for (const feature of world.features || []) {
        if(!geometryPaths.has(feature.code)) geometryPaths.set(feature.code,(feature.rings||[]).map(ringPath).join(''));
        const path = svgElement('path', { d: geometryPaths.get(feature.code), fill: scale.fill(metricValue(feature.code)), class: `country${state.country === feature.code ? ' selected' : ''}`, 'fill-rule': 'evenodd', 'data-code': feature.code, tabindex: 0, role: 'button', 'aria-label': `${countryName(feature.code)}: ${metricFormat(metricValue(feature.code))}` });
        path.append(svgElement('title', {}, `${countryName(feature.code)} · ${metricFormat(metricValue(feature.code))}`));
        countryEvents(path, feature.code);
        group.append(path);
      }
    }
    const max = Math.max(...edges.map(edge => Math.abs(edge.value)), 1);
    const edgeGroup = svgElement('g', { 'aria-hidden': 'true' });
    let drawnCount = 0;
    for (const edge of [...edges].reverse()) {
      const a = positions.get(edge.s), b = positions.get(edge.t);
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 2) continue;
      const bend = state.view === 'map' ? Math.min(65, length * .17) : Math.min(30, length * .08);
      const cx = (a[0] + b[0]) / 2 + dy / length * bend, cy = (a[1] + b[1]) / 2 - dx / length * bend;
      const inset = state.view === 'network' ? 5 : 2;
      const end = [b[0] - dx / length * inset, b[1] - dy / length * inset];
      edgeGroup.append(svgElement('path', { d: `M${a[0]},${a[1]}Q${cx},${cy},${end[0]},${end[1]}`, class: 'edge', stroke: edge.value < 0 ? RUST : '#4e7f9f', 'stroke-width': .55 + Math.sqrt(Math.abs(edge.value) / max) * (state.country ? 3.3 : 1.8), opacity: state.country ? .7 : .32, 'stroke-dasharray': edge.value < 0 ? '4 3' : null, 'marker-end': `url(#arrow-${edge.value < 0 ? 'negative' : 'positive'})` }));
      drawnCount++;
    }
    group.append(edgeGroup);
    const linked = new Set(edges.flatMap(edge => [edge.s, edge.t]));
    const codes = state.view === 'network' ? [...positions.keys()] : [...linked, ...(state.country && !linked.has(state.country) ? [state.country] : [])];
    for (const code of codes) {
      const point = positions.get(code); if (!point) continue;
      const value = metricValue(code);
      const radius = state.view === 'network' ? 3 + Math.sqrt(Math.abs(value || 0) / Math.max(Math.abs(scale.min), Math.abs(scale.max), 1)) * 8 : code === state.country ? 4.2 : 2.1;
      const fill = state.view === 'network' ? scale.fill(value) : NAVY;
      const node = svgElement('circle', { cx: point[0], cy: point[1], r: radius, fill, class: `node${code === state.country ? ' selected' : ''}`, tabindex: state.view === 'network' ? 0 : -1, role: 'button', 'aria-label': `${countryName(code)}: ${metricFormat(value)}` });
      node.append(svgElement('title', {}, `${countryName(code)} · ${metricFormat(value)}`));
      countryEvents(node, code);
      group.append(node);
    }
    const labelCodes = state.country ? [state.country, ...edges.slice(0, 7).map(edge => state.direction === 'out' ? edge.t : edge.s)] : [...linked].sort((a, b) => Math.abs(metricValue(b) || 0) - Math.abs(metricValue(a) || 0)).slice(0, state.view === 'network' ? 12 : 6);
    for (const code of new Set(labelCodes)) { const point = positions.get(code); if (point) group.append(svgElement('text', { x: point[0] + 5, y: point[1] - 7, class: 'node-label' }, code)); }
    const missingMap = state.view === 'map' && !(world.features || []).length;
    const empty = active.view.missingReason || (!isProduction() && !crossBorderEdges().length ? state.comparison ? 'No cross-border directed dyads are observed in both selected years.' : 'No observed cross-border relationships are available for this selection.' : '') || (missingMap ? 'World geometry is unavailable. Switch to Network to explore the observations.' : '');
    $('chart-empty').hidden = !empty;
    $('chart-empty').innerHTML = empty ? `<div><strong>${missingMap ? 'Map geometry unavailable' : 'No comparable observations'}</strong>${esc(empty)}</div>` : '';
    $('map-legend').innerHTML = `<div>${esc(metricLabel())}${state.comparison ? ' · change' : ''}</div><div class="legend-scale"><span>${esc(metricFormat(scale.min))}</span><span class="legend-gradient" style="background:${scale.negative ? 'linear-gradient(90deg,#a75039,#edf2f6,#002147)' : 'linear-gradient(90deg,#edf2f6,#002147)'}"></span><span>${esc(metricFormat(scale.max))}</span></div><div class="legend-key"><span><i class="legend-square"></i>Not observed</span>${isProduction()?'':'<span><i class="legend-line"></i>Positive</span><span><i class="legend-line negative"></i>Negative</span>'}</div>`;
    if (state.comparison&&!isProduction()) $('map-legend').insertAdjacentHTML('beforeend','<p>Blue lines: increase. Rust dashed lines: decrease. Arrows keep the original relation direction.</p>');
    const relevantCount = active.view.edges.filter(edge => edge.s !== edge.t && edge.value !== 0 && (!state.country || (state.direction === 'out' ? edge.s === state.country : edge.t === state.country))).length;
    $('edge-caption').textContent = `${number(drawnCount)} of ${number(relevantCount)} eligible links drawn by absolute value. Arrows: source → target. ${state.view === 'network' ? 'All supplied economies shown; layout is schematic.' : 'Country shading uses the selected metric.'} Negative values keep their original direction.`;
    if (isProduction()) $('edge-caption').textContent = 'Country financial-sector accounts. No bilateral relationship is inferred from a production total.';
    $('map-attribution').textContent = state.view === 'map' ? `${sourceText(world.attribution) || sourceText(world.source) || 'World geometry provided with the local data bundle.'} Boundaries do not imply a position on legal status.` : 'Schematic network layout. Spatial distance has no economic interpretation.';
    renderPcaInset();
  }

  function networkPositions(edges) {
    const codes = Object.keys(active.view.nodes).sort();
    if (state.country && !codes.includes(state.country)) codes.push(state.country);
    const result = new Map();
    // A deterministic, deliberately schematic layout avoids implying measured distance.
    const neighbours = new Set(edges.flatMap(edge => [edge.s, edge.t]));
    const ordered = codes.sort((a, b) => (neighbours.has(b) - neighbours.has(a)) || Math.abs(metricValue(b) || 0) - Math.abs(metricValue(a) || 0) || a.localeCompare(b));
    if (state.country) result.set(state.country, [530, 260]);
    const others = ordered.filter(code => code !== state.country);
    others.forEach((code, i) => {
      const inner = neighbours.has(code) || !state.country;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const radial = state.country ? (inner ? .38 + .38 * Math.sqrt(i / Math.max(1, others.length)) : .92) : .2 + .75 * Math.sqrt((i + .5) / Math.max(1, others.length));
      result.set(code, [530 + Math.cos(angle) * 455 * radial, 260 + Math.sin(angle) * 210 * radial]);
    });
    return result;
  }

  function renderPcaInset() {
    const panel=$('pca-inset'),chart=$('pca-chart');
    panel.hidden=state.view!=='network'||isProduction()||isSector()||isAllocated()||Boolean(state.comparison);
    if(panel.hidden) {chart.replaceChildren();return;}
    const model=active.layer.models||{};
    const points=Object.entries(model.pca||{}).filter(([,p])=>Array.isArray(p)&&p.length===2&&p.every(finite));
    if(!points.length) {chart.innerHTML='<p>No PCA available for this observed sample.</p>';return;}
    const groups=model.annual_clusters||model.clusters||{};
    const xs=points.map(([,p])=>p[0]),ys=points.map(([,p])=>p[1]);
    const loX=Math.min(...xs),hiX=Math.max(...xs),loY=Math.min(...ys),hiY=Math.max(...ys);
    const x=v=>24+(v-loX)/(hiX-loX||1)*192,y=v=>145-(v-loY)/(hiY-loY||1)*125;
    const svg=svgElement('svg',{viewBox:'0 0 240 170',role:'img','aria-label':`PCA of ${state.year} observed financial profiles`});
    svg.append(svgElement('path',{d:'M24,15V145H225',fill:'none',stroke:'#c9d4de'}));
    svg.append(svgElement('text',{x:120,y:165,'text-anchor':'middle',class:'chart-axis'},'PC1'));
    svg.append(svgElement('text',{x:6,y:20,class:'chart-axis'},'PC2'));
    for(const [code,p] of points) {
      const group=groups[code];
      const dot=svgElement('circle',{cx:x(p[0]),cy:y(p[1]),r:code===state.country?4.5:2.6,fill:Number.isInteger(group)?PROFILE_COLOURS[group%PROFILE_COLOURS.length]:'#a8b3bd',stroke:code===state.country?'#d39f37':'white','stroke-width':code===state.country?2:.5,tabindex:0,role:'button','aria-label':countryName(code)});
      dot.append(svgElement('title',{},`${countryName(code)} · ${state.year}${Number.isInteger(group)?` · Annual Group ${group+1}`:''}`));
      dot.addEventListener('click',()=>selectCountry(code));dot.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCountry(code);}});svg.append(dot);
    }
    chart.replaceChildren(svg);
    $('pca-note').textContent=`${state.year}: six observed scale/degree features; annual PCA and groups. Axes and colours cannot track movement or persistent blocs across years. Click a point to select its country.`;
  }
  function countryEvents(element, code) {
    element.addEventListener('click', () => selectCountry(code));
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCountry(code); } });
    element.addEventListener('pointerenter', event => showTooltip(code, event));
    element.addEventListener('pointermove', event => showTooltip(code, event));
    element.addEventListener('pointerleave', hideTooltip);
    element.addEventListener('focus', () => showTooltip(code));
    element.addEventListener('blur', hideTooltip);
  }
  function showTooltip(code, event) {
    const tooltip = $('chart-tooltip'), stage = $('map-stage');
    tooltip.innerHTML = `<strong>${esc(countryName(code))} <span>${esc(code)}</span></strong><span>${esc(metricLabel())}</span><br>${esc(metricFormat(metricValue(code)))}${state.comparison ? `<br><span>Matched ${isProduction()?'accounts':state.tab==='assets'?'positions':'relationships'}: ${esc(state.year)} − ${esc(state.comparison)}</span>` : ''}`;
    tooltip.hidden = false;
    const bounds = stage.getBoundingClientRect();
    const x = event ? event.clientX - bounds.left + 13 : 15;
    const y = event ? event.clientY - bounds.top + 13 : 15;
    tooltip.style.left = `${Math.max(8, Math.min(bounds.width - tooltip.offsetWidth - 8, x))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.height - tooltip.offsetHeight - 8, y))}px`;
  }
  function hideTooltip() { $('chart-tooltip').hidden = true; }

  function metricCell(label, value, note = '') { return `<div class="metric-cell"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`; }
  function renderCountry() {
    const code = state.country;
    $('country-title').textContent = code ? countryName(code) : 'The observed global network';
    $('country-code').textContent = code || 'GLOBAL';
    const nodes = active.view.nodes;
    if (isProduction()) {
      $('country-metrics').innerHTML = code ? metricCell(`Gross Output · ${state.year}`, money(active.layer.accounts?.[code]?.gross_output)) + metricCell(`Value Added · ${state.year}`, money(active.layer.accounts?.[code]?.value_added)) : metricCell('Financial Production Economies', number(Object.keys(active.layer.accounts || {}).length));
      $('country-context').textContent = 'Financial production and value added are recorded in the production economy. Select a country to inspect its source accounts and time series. No bilateral ownership or service relationship is inferred from a national total.';
      $('account-breakdown').innerHTML = '';
      return;
    }
    if (!code) {
      const edges = crossBorderEdges();
      const positive = edges.reduce((sum, edge) => sum + Math.max(0, edge.value), 0), negative = edges.reduce((sum, edge) => sum + Math.max(0, -edge.value), 0);
      $('country-metrics').innerHTML = metricCell(state.comparison ? 'Positive matched changes' : 'Positive observed positions', money(edges.length ? positive : null), 'Sum across cross-border dyads') + metricCell(state.comparison ? 'Negative matched changes' : 'Negative position magnitude', money(edges.length ? negative : null), 'Magnitude; direction retained') + metricCell('Source economies', number(new Set(edges.map(edge => edge.s)).size)) + metricCell('Target economies', number(new Set(edges.map(edge => edge.t)).size));
      if (isControl()) $('country-metrics').innerHTML = metricCell(state.comparison?'Matched Controlled-Output Change':'Observed Foreign-Controlled Financial Output', money(edges.length ? positive-negative : null,Boolean(state.comparison))) + metricCell('Parent Economies', number(new Set(edges.map(e=>e.s)).size)) + metricCell('Production Host Economies', number(new Set(edges.map(e=>e.t)).size));
      $('country-context').textContent = 'Select a country on the map, in the network, or using the country search to inspect its observed relationships. Cross-border sums can double-count economic relationships across datasets and should not be added across layers.';
      $('account-breakdown').innerHTML = '';
      return;
    }
    const node = nodes[code] || blankNode();
    const direct = active.view.isComparison;
    const changeType=state.tab==='assets'?'Position Change':'Supply/Use Change';
    $('country-metrics').innerHTML = metricCell(direct ? `Outgoing Matched ${changeType}` : 'Outgoing observed total', money(node.out_total, direct), `Country is the source · ${directionRole('out')}`) + metricCell(direct ? `Incoming Matched ${changeType}` : 'Incoming observed total', money(node.in_total, direct), `Country is the target · ${directionRole('in')}`) + metricCell(direct ? 'Outgoing nonzero-change counterparts' : 'Outgoing partners', number(node.out_degree), direct ? 'Nonzero change on matched dyads' : 'Nonzero cross-border links') + metricCell(direct ? 'Incoming nonzero-change counterparts' : 'Incoming partners', number(node.in_degree), direct ? 'Nonzero change on matched dyads' : 'Nonzero cross-border links');
    if (isControl()) $('country-metrics').innerHTML = metricCell(direct ? 'Controlled Output Abroad: Matched Change' : 'Controlled Financial Output Abroad', money(node.out_total,direct)) + metricCell(direct ? 'Foreign-Controlled Output Here: Matched Change' : 'Foreign-Controlled Financial Output Here', money(node.in_total,direct)) + metricCell('Foreign Host Economies',number(node.out_degree)) + metricCell('Foreign Ultimate Parent Economies',number(node.in_degree));
    const hhiKey = `${state.direction}_hhi_observed`, hhi = node[hhiKey];
    const hhiStatus = node[`${state.direction}_hhi_status`];
    const concentrationNote = !isSector() && !isAllocated() && !direct ? ` ${state.direction === 'out' ? 'Outgoing' : 'Incoming'} observed HHI: ${finite(hhi) ? number(hhi, 4) : 'unavailable'}${hhiStatus ? ` (${String(hhiStatus).replaceAll('_', ' ')})` : ''}.` : ' Aggregate HHI and PageRank are not reused for this filtered or comparison view.';
    $('country-context').textContent = `${finite(node.out_total) || finite(node.in_total) ? 'Observed totals depend on the reporting economies and mapped counterparties. An incoming observation does not establish that this economy reported its own outgoing position.' : 'No directional observations are available for this country in the current selection.'}${concentrationNote}${isAllocated() ? ' Value added is allocated to direct sales using the source industry’s VA/GO ratio; it is not indirect final-demand attribution.' : ''}`;
    if (isControl()) $('country-context').textContent = 'The host perspective identifies ultimate parent economies controlling financial output here. The parent perspective identifies foreign host economies of controlled production. Values describe corporate production control, not government ownership or investment transactions.';
    renderAccounts(code);
  }
  function renderAccounts(code) {
    const account = active.layer.accounts?.[code];
    const container = $('account-breakdown');
    if (!account || isControl() || state.comparison || isSector() || isAllocated()) { container.innerHTML = ''; return; }
    let html = '';
    if (finite(account.gross_output) || finite(account.value_added)) html += `<div class="account-section"><h3>Financial-sector accounts</h3><div class="metrics-grid">${metricCell('Gross output', money(account.gross_output))}${metricCell('Value added', money(account.value_added))}</div></div>`;
    if (finite(account.domestic_output) && finite(account.foreign_output) && finite(account.foreign_output_share) && account.domestic_output >= 0 && account.foreign_output >= 0) {
      const share = Math.max(0, Math.min(1, account.foreign_output_share));
      html += `<div class="account-section"><h3>Domestic / foreign-controlled output</h3><div class="account-bar" role="img" aria-label="Foreign-controlled output share ${esc(percentage(share))}"><span style="width:${(1 - share) * 100}%"></span><span class="foreign" style="width:${share * 100}%"></span></div><div class="account-labels"><span>Domestic ${esc(money(account.domestic_output))}</span><span>Foreign ${esc(money(account.foreign_output))} · ${esc(percentage(share))}</span></div><p class="card-footnote">Domestic and foreign components come from the same database. They are not combined with another source.</p></div>`;
    }
    if (finite(account.foreign_va_share)) html += `<p class="card-footnote">Foreign-controlled value added share: ${esc(percentage(account.foreign_va_share))}.</p>`;
    container.innerHTML = html;
  }

  function renderPartners() {
    let rows;
    if (isProduction()) {
      const records = Object.keys(active.layer.accounts || {}).map(code => ({code,value:metricValue(code)})).filter(r => finite(r.value)).sort((a,b) => state.comparison ? Math.abs(b.value)-Math.abs(a.value) : b.value-a.value).slice(0,7);
      $('partners-title').textContent = state.comparison ? 'Largest Financial Account Changes' : 'Leading Production Economies';
      $('partner-list').innerHTML = records.map((r,i) => `<button class="partner-row" data-partner="${esc(r.code)}"><span>${i+1}</span><span>${esc(countryName(r.code))}</span><strong>${esc(money(r.value,Boolean(state.comparison)))}</strong></button>`).join('');
      $('partner-list').querySelectorAll('[data-partner]').forEach(button => button.addEventListener('click',()=>selectCountry(button.dataset.partner)));
      $('partners-note').textContent = 'Ranked by the selected financial-sector account. National account totals are not bilateral partner relationships.';
      return;
    }
    const edges = crossBorderEdges().filter(edge => edge.value !== 0);
    const directional = state.country ? crossBorderEdges().filter(edge => state.direction === 'out' ? edge.s === state.country : edge.t === state.country) : [];
    const foreignSubtotal = directional.reduce((sum, edge) => sum + edge.value, 0);
    const partnerShares = Boolean(state.country) && !state.comparison && foreignSubtotal > 0 && directional.every(edge => edge.value >= 0);
    if (state.country) rows = edges.filter(edge => state.direction === 'out' ? edge.s === state.country : edge.t === state.country).map(edge => ({ code: state.direction === 'out' ? edge.t : edge.s, label: countryName(state.direction === 'out' ? edge.t : edge.s), value: edge.value }));
    else rows = edges.map(edge => ({ code: edge.s, label: `${countryName(edge.s)} → ${countryName(edge.t)}`, value: edge.value }));
    rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top = rows.slice(0, 7), max = Math.max(...top.map(row => Math.abs(row.value)), 1);
    $('partners-title').textContent = state.country ? `Top ${state.direction === 'out' ? 'outgoing' : 'incoming'} ${state.comparison ? 'nonzero-change counterparts' : 'partners'}` : state.comparison ? 'Leading nonzero matched changes' : 'Leading observed relationships';
    if (isControl()) $('partners-title').textContent = state.country ? state.direction === 'in' ? 'Ultimate Parent Economies' : 'Host Economies of Controlled Production' : 'Parent–Host Financial Production Links';
    $('partner-list').innerHTML = top.length ? top.map((row, i) => `<button type="button" class="partner-row" data-partner="${esc(row.code)}" title="Select ${esc(countryName(row.code))}"><span class="partner-rank">${String(i + 1).padStart(2, '0')}</span><span><span class="partner-name">${esc(row.label)}</span><span class="partner-bar-track"><span class="partner-bar" style="display:block;width:${Math.abs(row.value) / max * 100}%;${row.value < 0 ? `background:${RUST}` : ''}"></span></span></span><span class="partner-value${row.value < 0 ? ' negative-value' : ''}">${esc(money(row.value, Boolean(state.comparison)))}${partnerShares ? `<small class="partner-share" title="Share of observed mapped foreign subtotal">${esc(percentage(row.value / foreignSubtotal))} of observed foreign subtotal</small>` : ''}</span></button>`).join('') : '<div class="empty-detail">No observed partners for this direction and selection.</div>';
    $('partner-list').querySelectorAll('[data-partner]').forEach(button => button.addEventListener('click', () => selectCountry(button.dataset.partner)));
    $('partners-note').textContent = `Ranked by absolute ${state.comparison ? 'nonzero change on matched observed dyads' : 'nonzero observed value'}; negative signs are retained.${isSector() ? ` ${filterName()} ${state.industry} only.` : ''}${isAllocated() ? ' Allocated direct value added.' : ''}${partnerShares ? ' Each partner share uses the full observed mapped foreign subtotal for this direction, including partners outside this list.' : state.country && !state.comparison && directional.some(edge => edge.value < 0) ? ' Partner shares are unavailable because this direction contains negative observations.' : ''}`;
    if (isControl()) $('partners-note').textContent += ' Amounts measure financial gross output under corporate control, not investment flows or company equity values.';
  }

  function renderTrend() {
    const container = $('trend-chart');
    const code = state.country;
    const accountColumns = { gross_output: 3, value_added: 4, foreign_output_share: 5, foreign_va_share: 6 };
    const accountLabels = { gross_output: 'Financial-sector gross output', value_added: 'Financial-sector value added', foreign_output_share: 'Foreign-controlled financial output share', foreign_va_share: 'Foreign-controlled financial value added share' };
    const accountMetric = (!state.comparison || isProduction()) && !isSector() && !isAllocated() && Object.hasOwn(accountColumns, state.metric) ? state.metric : '';
    const share = accountMetric.includes('share');
    const fallback = isSector() || isAllocated() || ['out_hhi_observed', 'in_hhi_observed', 'pagerank_observed', DEPENDENCY_SHARE].includes(state.metric);
    const series = accountMetric ? [{ index: accountColumns[accountMetric], label: accountLabels[accountMetric], colour: NAVY, dashed: false }] : [{ index: 1, label: 'Outgoing', colour: NAVY, dashed: false }, { index: 2, label: 'Incoming', colour: '#7ba2ba', dashed: true }];
    const format = share ? percentage : money;
    $('trend-scope').textContent = accountMetric ? 'Financial-sector account' : fallback ? 'Aggregate outgoing / incoming' : '';
    $('trend-title').textContent = code ? accountMetric ? accountLabels[accountMetric] : `${countryName(code)} over time` : 'Select a country to inspect time';
    const gapNote = 'Missing observations and gaps longer than one year are not connected. Coverage can change over time.';
    $('trend-note').textContent = accountMetric ? `${code ? countryName(code) + '. ' : ''}Same-source financial-sector account series. ${gapNote}` : `Observed outgoing and incoming totals. ${gapNote}`;
    if (!code) { container.innerHTML = '<div class="empty-detail">Country-level trends appear when you select an economy.</div>'; return; }
    const rows = manifest.trends?.[state.layer]?.[code];
    if (!Array.isArray(rows) || !rows.some(row => series.some(item => finite(row[item.index])))) { container.innerHTML = '<div class="empty-detail">No observed time series is available for this country and selected metric.</div>'; return; }
    const data = [...rows].sort((a, b) => a[0] - b[0]);
    const values = data.flatMap(row => series.map(item => row[item.index])).filter(finite);
    const width = 430, height = 185, left = 48, right = 10, top = 14, bottom = 29;
    let min = Math.min(0, ...values), max = Math.max(share ? 1 : 0, ...values); if (min === max) max = min + 1;
    const first = data[0][0], last = data.at(-1)[0];
    const x = year => left + (year - first) / Math.max(1, last - first) * (width - left - right);
    const y = value => top + (max - value) / (max - min) * (height - top - bottom);
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${accountMetric ? accountLabels[accountMetric] : 'Aggregate outgoing and incoming observed totals'} for ${countryName(code)}, ${first} to ${last}. ${share ? 'Percentage axis. ' : ''}${accountMetric ? 'Same-source financial-sector account series.' : `${scopeName()} relationship series.`}` });
    for (let i = 0; i < 4; i++) { const value = min + (max - min) * i / 3; svg.append(svgElement('path', { d: `M${left},${y(value)}H${width - right}`, stroke: '#e8edf2', fill: 'none' })); svg.append(svgElement('text', { x: left - 7, y: y(value) + 3, 'text-anchor': 'end', class: 'chart-axis' }, format(value))); }
    for (const year of new Set([first, Math.round((first + last) / 2), last])) svg.append(svgElement('text', { x: x(year), y: height - 8, 'text-anchor': 'middle', class: 'chart-axis' }, String(year)));
    if (state.year >= first && state.year <= last) svg.append(svgElement('path', { d: `M${x(state.year)},${top}V${height - bottom}`, class: 'trend-selected-line' }));
    for (const { index, label, colour, dashed } of series) {
      let path = '', open = false, previousYear = null;
      for (const row of data) {
        if (!finite(row[index])) { open = false; previousYear = null; continue; }
        const year = Number(row[0]);
        if (previousYear !== null && year - previousYear > 1) open = false;
        path += `${open ? 'L' : 'M'}${x(year)},${y(row[index])}`;
        open = true; previousYear = year;
      }
      svg.append(svgElement('path', { d: path, fill: 'none', stroke: colour, 'stroke-width': 2, 'stroke-dasharray': dashed ? '4 3' : null }));
      for (const row of data.filter(row => finite(row[index]))) { const dot = svgElement('circle', { cx: x(row[0]), cy: y(row[index]), r: Number(row[0]) === state.year ? 3 : 1.7, fill: colour }); dot.append(svgElement('title', {}, `${row[0]} · ${label}: ${format(row[index])}`)); svg.append(dot); }
    }
    container.replaceChildren(svg);
    container.insertAdjacentHTML('beforeend', `<div class="trend-key">${series.map(item => `<span><i${item.dashed ? ' class="incoming"' : ''}></i>${esc(item.label)}</span>`).join('')}</div>`);
    if (fallback) $('trend-note').textContent = `Underlying ${scopeName()} gross relationship series: outgoing and incoming totals. ${isAllocated() ? 'Allocated value-added' : isSector() ? state.filterKind === 'demand' ? 'Category-specific' : 'Industry-specific' : state.metric === DEPENDENCY_SHARE ? 'Mapped foreign dependency-share' : 'HHI / PageRank'} trends are unavailable. ${gapNote}`;
  }

  function concentration(code) {
    const values = crossBorderEdges().filter(e => state.direction === 'out' ? e.s === code : e.t === code).map(e => e.value);
    if (!values.length) return { status: 'No Observations' };
    if (values.some(v => v < 0)) return { status: 'Signed Positions: Conventional HHI Not Applicable', partners: values.filter(v => v !== 0).length };
    const sum = values.reduce((a,b) => a+b,0);
    if (sum <= 0) return { status: 'Zero Denominator', partners: 0 };
    const sorted = [...values].sort((a,b) => b-a);
    return {status: 'Observed Mapped Foreign Subtotal', hhi: values.reduce((a,v) => a+(v/sum)**2,0),
      largest: sorted[0]/sum, top3: sorted.slice(0,3).reduce((a,b) => a+b,0)/sum, partners: values.filter(v => v !== 0).length};
  }

  function renderConcentration() {
    const container = $('concentration-metrics'), chart = $('concentration-chart');
    container.innerHTML = ''; chart.innerHTML = '';
    if (isProduction() || state.comparison) {
      $('concentration-note').textContent = isProduction() ? 'Concentration describes relationships, not national production accounts. Choose Corporate Control, Final Demand or an industry/asset relationship.' : 'Concentration is not computed from signed changes. Select a single year.';
      return;
    }
    $('concentration-title').textContent = isControl() ? state.direction === 'in' ? 'Ultimate Parent-Economy Concentration' : 'Host-Economy Concentration' : 'Concentration & Dependence';
    if (!state.country) {
      const rankings = Object.keys(active.view.nodes).map(code => ({code, ...concentration(code)})).filter(r => finite(r.hhi)).sort((a,b) => b.hhi-a.hhi).slice(0,8);
      chart.innerHTML = rankings.map(r => `<button class="concentration-row" data-country="${esc(r.code)}"><span>${esc(countryName(r.code))}</span><strong>${number(r.hhi,3)}</strong><small>${r.partners} Partners</small></button>`).join('') || '<p class="empty-detail">No eligible nonnegative country profiles in this selection.</p>';
      chart.querySelectorAll('[data-country]').forEach(button => button.addEventListener('click', () => selectCountry(button.dataset.country)));
      $('concentration-note').textContent = 'Highest observed HHI values for the selected direction. HHI = sum of squared partner shares (0–1); one partner gives 1. Values depend on disclosure and mapped coverage, not only economic concentration.';
      return;
    }
    const profile = concentration(state.country);
    container.innerHTML = metricCell('Partner Concentration (HHI)', number(profile.hhi,3)) + metricCell('Largest Partner Share', percentage(profile.largest)) + metricCell('Top Three Partner Share', percentage(profile.top3)) + metricCell('Nonzero Partners', number(profile.partners));
    const node = active.view.nodes[state.country];
    if (!isSector() && !isAllocated() && finite(node?.pagerank_observed)) container.innerHTML += metricCell('Observed-Network PageRank', number(node.pagerank_observed,4));
    $('concentration-note').textContent = `${profile.status}. HHI uses nonnegative observed cross-border partner shares, excludes domestic production and does not fill undisclosed/ROW amounts. It is not a complete-population concentration measure. ${isSector() || isAllocated() ? 'This panel reflects the current filtered relationship; aggregate HHI trends are not reused.' : 'Trend observations can change with reporting coverage.'}`;
    if (isSector() || isAllocated()) return;
    const trend = manifest.trends?.[state.layer]?.[state.country] || [];
    const index = state.direction === 'out' ? 7 : 8;
    const values = trend.filter(row => finite(row[index]));
    if (!values.length) return;
    const width=420,height=110,left=30,right=12,top=12,bottom=23,first=trend[0][0],last=trend.at(-1)[0];
    const x = year => left+(year-first)/Math.max(last-first,1)*(width-left-right);
    const y = value => height-bottom-value*(height-top-bottom);
    const svg=svgElement('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Observed partner concentration over time (HHI, 0–1)'});
    for(const value of [0,.5,1]) { svg.append(svgElement('path',{d:`M${left},${y(value)}H${width-right}`,stroke:'#e3eaf0'})); svg.append(svgElement('text',{x:left-5,y:y(value)+3,'text-anchor':'end',class:'chart-axis'},String(value))); }
    let path='',previous=null;
    for(const row of trend) { if(!finite(row[index])) {previous=null;continue;} path+=`${previous!==null&&row[0]-previous===1?'L':'M'}${x(row[0])},${y(row[index])}`;previous=row[0]; }
    svg.append(svgElement('path',{d:path,fill:'none',stroke:NAVY,'stroke-width':2}));
    for(const row of values) {const dot=svgElement('circle',{cx:x(row[0]),cy:y(row[index]),r:2,fill:NAVY});dot.append(svgElement('title',{},`${row[0]} · HHI ${number(row[index],3)}`));svg.append(dot);}
    for(const year of new Set([first,last])) svg.append(svgElement('text',{x:x(year),y:height-5,'text-anchor':'middle',class:'chart-axis'},String(year)));
    chart.append(svg);
  }

  function renderCompanies() {
    $('company-card').hidden = true;
    $('company-detail').replaceChildren();
    if (!isControl()||state.comparison) return;
    const records = (manifest.companyRecords || []).filter(row => Number(String(row.as_of).slice(0,4)) === state.year && (!state.country || row.entity_country === state.country || row.ultimate_parent_country === state.country));
    const intro = '<p>AMNE shows country-level aggregates by ultimate parent economy. Individual firms are not identified by these amounts, and a parent economy is not automatically the state exercising legal control.</p>';
    if (!records.length) return;
    $('company-card').hidden=false;
    $('company-detail').innerHTML = intro+'<div class="company-table-wrap"><table><thead><tr><th>Entity / Residence</th><th>Direct Parent / Residence</th><th>Ultimate Parent / Residence</th><th>Evidence Date</th></tr></thead><tbody>'+records.map(row => `<tr><td>${esc(row.entity_name)}<br>${esc(countryName(row.entity_country))}</td><td>${esc(row.direct_parent_name||'Not Disclosed')}<br>${esc(countryName(row.direct_parent_country||''))}</td><td>${esc(row.ultimate_parent_name||'Not Disclosed')}<br>${esc(countryName(row.ultimate_parent_country||''))}</td><td>${esc(row.as_of)}<br><a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">Source</a></td></tr>`).join('')+'</tbody></table></div><p class="card-footnote">Separately sourced corporate evidence; not a firm-level decomposition of AMNE gross output.</p>';
  }

  function renderCoverage() {
    const quality = active.layer.quality || {};
    const status = String(quality.source_validation_status || 'not_assessed');
    const referenceStatus = active.old?.quality?.source_validation_status || '';
    const failed = /fail|invalid|partial|warning|unverified|pending|not_assessed/i.test(status) || /fail|invalid/i.test(referenceStatus);
    const notes = Array.isArray(quality.notes) ? quality.notes : quality.notes ? [quality.notes] : [];
    $('coverage-banner').className = `coverage-banner${failed ? ' warning' : ''}`;
    $('coverage-banner').innerHTML = `<span class="coverage-icon">${failed ? '!' : 'i'}</span><div><strong>${failed ? 'Source Checks Require Review' : 'Source-Specific Observed Coverage'}</strong> ${failed ? 'Accounting or source checks remain unresolved. These warnings are separate from comparison loading; read the source notes below.' : 'Missing and undisclosed observations remain unknown. Open the coverage notes for the selected source.'}</div>`;
    $('validation-status').textContent = status.replaceAll('_', ' ');
    $('validation-status').className = `status-pill${failed ? ' warn' : ''}`;
    const rawUnit = active.layer.raw_unit ? ` Source unit: ${sourceText(active.layer.raw_unit) || active.layer.raw_unit}.` : '';
    let html = `<div class="coverage-copy"><p><strong>${esc(sourceText(def().source) || 'Source documented in the generated bundle')}</strong> · Reference year ${esc(state.year)}. Display values use USD millions, formatted as millions, billions or trillions.${esc(rawUnit)}</p><p>Direction: source (${esc(directionRole('out'))}) → target (${esc(directionRole('in'))}). ${esc(def().description || '')}</p></div>`;
    if (state.comparison) html += `<p class="coverage-copy">Comparison-year source validation (${esc(state.comparison)}): ${esc(String(referenceStatus || 'not assessed').replaceAll('_', ' '))}. Both years' source limitations remain applicable to matched-dyad changes.</p>`;
    const controls = quality.worldControls || {};
    const code = state.country;
    const control = code ? controls[code] : null;
    if (control) {
      const published = control.published_world_or_host_GO;
      html += `<div class="coverage-facts"><div><span>Published world / host control</span><strong>${esc(money(published))}</strong></div><div><span>Mapped geographic observed sum</span><strong>${esc(money(control.mapped_geographic_observed_sum))}</strong></div><div><span>Raw sum / published control</span><strong>${finite(control.raw_sum_to_control_ratio) ? esc(percentage(control.raw_sum_to_control_ratio)) : 'Not available'}</strong></div><div><span>Observed cells</span><strong>${esc(number(control.observed_cells))}</strong></div><div><span>Missing cells</span><strong>${esc(number(control.missing_cells))}</strong></div><div><span>Negative cells</span><strong>${esc(number(control.negative_cells))}</strong></div></div><p class="coverage-copy">Reporting-economy control: ${esc(String(control.coverage_status || 'not assessed').replaceAll('_', ' '))}. Published world or host controls can include counterparties outside mapped geographic observations. This ratio is a diagnostic and need not be a coverage percentage.</p>`;
    } else if (code) html += '<p class="coverage-copy">No own-reporting world / host control is available for this selected economy in this layer. It may still appear as a counterparty in another economy’s observations. Incoming and outgoing values have different reporting coverage.</p>';
    else html += `<p class="coverage-copy">${number(Object.keys(controls).length)} reporting-economy controls supplied. Select an economy to inspect its published control, mapped geographic sum and missing-cell counts where available. Global sums shown above use observed cross-border dyads, not published world controls.</p>`;
    if (isSector()) html += `<p class="coverage-copy">The ${state.filterKind === 'demand' ? 'final-demand category' : 'industry'} selection recalculates cross-border country sums and partners from ${state.filterKind === 'demand' ? 'category' : 'industry'} edges. Domestic self-links are recorded separately. World controls, national accounts and the trend series refer to the source’s aggregate scope; aggregate HHI, PageRank and profiles are not reused.</p>`;
    if (isAllocated()) html += '<p class="coverage-copy">Allocated direct financial value added = source-industry value added / gross output × direct sales. It assumes a common source-industry coefficient across buyers. It is not an indirect value-added calculation or attribution through the full production chain.</p>';
    if (notes.length) html += `<ul class="note-list">${notes.map(note => `<li>${esc(sourceText(note) || String(note))}</li>`).join('')}</ul>`;
    if (manifest.shareMode) html += `<p class="coverage-copy">${esc(manifest.shareMode)}</p>`;
    if (active.view.missing) html += `<p class="coverage-copy">${number(active.view.missing)} missing edge cells in the current input scope are excluded from sums, rather than converted to zero.</p>`;
    $('coverage-detail').innerHTML = html;
    const definitions = Array.isArray(manifest.definitions) ? manifest.definitions : Object.entries(manifest.definitions || {}).map(([label, description]) => ({ label, description }));
    $('definition-list').innerHTML = `<div class="definition-item"><strong>${esc(def().label || state.layer)}</strong><br>${esc(def().description || '')}<br>Selected layer unit: USD million. Negative observations retain their reported source and target. HHI and PageRank describe observed counterparties and are unavailable where the input or sign conditions do not support them.</div>` + definitions.map(item => typeof item === 'string' ? `<div class="definition-item">${esc(item)}</div>` : `<div class="definition-item"><strong>${esc(item.label || item.title || item.term || '')}</strong><br>${esc(item.description || item.text || item.definition || '')}</div>`).join('');
  }

  initialise();
})();
