// AQmod Data Entry PWA — separate from AQ
// Schema per hole: score, putts, tee_result(L/F/R), shots[{club,quality}],
//   sector, strokes_from_sector, first_putt_slope, first_putt_result, pelz(1-9)
// (Legacy rounds may also carry `gir`; preserved in CSV export. New rounds derive
//  GIR at display time from sector + strokes_from_sector + par.)

const STORAGE_KEY = 'aqmod_rounds_v1';
const CLUBS = ['D','F','H','I','S','W','C','B'];
const CLUB_NAMES = {D:'Driver', F:'Fairway wood', H:'Hybrid', I:'Iron', S:'Sand', W:'Wedge', C:'Chip', B:'Bump and Run'};

// Par per hole
const PAR3_HOLES = new Set([5, 8, 13, 16]);
const PAR5_HOLES = new Set([9, 14, 15, 17]);
function parOf(h) {
  if (PAR3_HOLES.has(h)) return 3;
  if (PAR5_HOLES.has(h)) return 5;
  return 4;
}
function defaultShotCount(par) {
  // par 3 → 2 shots default, par 4 → 3, par 5 → 4
  return par - 1;
}

let rounds = loadRounds();
let currentRoundId = null;
let currentHole = null;
let currentHoleData = null;

function loadRounds() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch(e) { return []; }
}
function saveRounds() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
}
function getRound(id) { return rounds.find(r => r.id === id); }
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function holeStatus(h) {
  if (!h) return 'empty';
  if (h.score && h.score > 0) return 'complete';
  if (h.sector || (h.shots && h.shots.length) || h.first_putt_slope) return 'partial';
  return 'empty';
}

// ── Screens ──
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const backBtn = document.getElementById('backBtn');
  if (name === 'rounds') {
    backBtn.style.display = 'none';
    document.getElementById('topTitle').textContent = 'AQmod';
    document.getElementById('topCrumb').textContent = 'Oberlin';
  } else if (name === 'round') {
    backBtn.style.display = '';
    backBtn.onclick = () => { renderRoundsList(); showScreen('rounds'); };
    document.getElementById('topTitle').textContent = 'Round';
    document.getElementById('topCrumb').textContent = 'Oberlin';
  } else if (name === 'hole') {
    backBtn.style.display = '';
    backBtn.onclick = () => { renderRound(); showScreen('round'); };
    document.getElementById('topTitle').textContent = `Hole ${currentHole}`;
    document.getElementById('topCrumb').textContent = '';
  } else if (name === 'newround') {
    backBtn.style.display = '';
    backBtn.onclick = () => { renderRoundsList(); showScreen('rounds'); };
    document.getElementById('topTitle').textContent = 'New Round';
    document.getElementById('topCrumb').textContent = '';
  }
  window.scrollTo(0, 0);
}

// ── Rounds list ──
function renderRoundsList() {
  const list = document.getElementById('roundsList');
  const sorted = [...rounds].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('roundsCount').textContent =
    sorted.length === 0 ? 'No rounds yet' : `Rounds (${sorted.length})`;
  list.innerHTML = '';
  for (const r of sorted) {
    const filled = Object.keys(r.holes || {}).filter(h => r.holes[h].score).length;
    const totalScore = Object.values(r.holes || {}).reduce((s, h) => s + (h.score || 0), 0);
    const li = document.createElement('li');
    li.className = 'round-item' + (r.completed_at ? ' complete' : '');
    li.innerHTML = `
      <div>
        <div class="date">${fmtDate(r.date)}</div>
        <div class="meta">${filled}/18 holes · ${totalScore || '—'} strokes${r.notes ? ' · ' + r.notes : ''}</div>
      </div>
      <span class="arrow">›</span>
    `;
    li.onclick = () => { currentRoundId = r.id; renderRound(); showScreen('round'); };
    list.appendChild(li);
  }
  if (sorted.length === 0) {
    list.innerHTML = '<li class="empty-state">Tap "+ New Round" to begin.</li>';
  }
}

// ── New round ──
function renderNewRound(existingRound) {
  const isEdit = !!existingRound;
  document.getElementById('roundDateInput').value = isEdit ? existingRound.date : new Date().toISOString().slice(0,10);
  const notesInput = document.getElementById('roundNotesInput');
  notesInput.value = isEdit ? (existingRound.notes || '') : '';
  notesInput.oninput = () => autoGrow(notesInput);
  requestAnimationFrame(() => autoGrow(notesInput));
  document.getElementById('createRoundBtn').textContent = isEdit ? 'Save Pin' : 'Start Round';
  
  const row = document.getElementById('singlePinRow');
  row.innerHTML = '';
  let selectedPin = isEdit && existingRound.pins ? (existingRound.pins[0] || null) : null;
  for (let p = 1; p <= 5; p++) {
    const cell = document.createElement('div');
    cell.className = 'pin-cell';
    cell.textContent = p;
    if (selectedPin === p) cell.classList.add('selected');
    cell.onclick = () => {
      selectedPin = p;
      row.querySelectorAll('.pin-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
    };
    row.appendChild(cell);
  }
  
  document.getElementById('createRoundBtn').onclick = () => {
    if (selectedPin === null) { toast('Pick a pin position'); return; }
    const pins = new Array(18).fill(selectedPin);
    if (isEdit) {
      existingRound.pins = pins;
      saveRounds(); renderRound(); showScreen('round'); toast('Pin updated');
    } else {
      const id = uid();
      const newR = {
        id,
        date: document.getElementById('roundDateInput').value,
        notes: document.getElementById('roundNotesInput').value.trim(),
        pins, holes: {}
      };
      rounds.push(newR);
      saveRounds();
      currentRoundId = id;
      renderRound();
      showScreen('round');
    }
  };
}

// ── Round notes (inline editor) ──
function renderNotesSection(r) {
  const sec = document.getElementById('notesSection');
  sec.className = 'notes-section' + (r.notes ? '' : ' empty');
  sec.innerHTML = '';
  const display = document.createElement('div');
  display.textContent = r.notes || 'Add notes…';
  sec.appendChild(display);
  sec.onclick = () => editNotes(r);
}

function editNotes(r) {
  const sec = document.getElementById('notesSection');
  sec.className = 'notes-section editing';
  sec.onclick = null;
  sec.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.value = r.notes || '';
  ta.placeholder = 'e.g. Saturday morning with Jim';
  ta.oninput = () => autoGrow(ta);
  sec.appendChild(ta);
  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => renderNotesSection(r);
  const done = document.createElement('button');
  done.textContent = 'Done';
  done.className = 'done-btn';
  done.onclick = () => {
    r.notes = ta.value.trim();
    saveRounds();
    renderNotesSection(r);
  };
  actions.appendChild(cancel);
  actions.appendChild(done);
  sec.appendChild(actions);
  requestAnimationFrame(() => { autoGrow(ta); ta.focus(); });
}

// ── Round dashboard ──
function renderRound() {
  const r = getRound(currentRoundId);
  if (!r) { showScreen('rounds'); return; }
  document.getElementById('roundDate').textContent = fmtDate(r.date);
  const filled = Object.keys(r.holes).filter(h => r.holes[h].score).length;
  const totalScore = Object.values(r.holes).reduce((s, h) => s + (h.score || 0), 0);
  document.getElementById('roundMeta').textContent =
    `${filled}/18 holes recorded${totalScore ? ' · ' + totalScore + ' strokes' : ''}`;
  renderNotesSection(r);
  
  const grid = document.getElementById('holesGrid');
  grid.innerHTML = '';
  for (let h = 1; h <= 18; h++) {
    const tile = document.createElement('div');
    const status = holeStatus(r.holes[h]);
    tile.className = 'hole-tile ' + status;
    const scoreVal = r.holes[h] && r.holes[h].score ? r.holes[h].score : '';
    tile.innerHTML = `
      <span class="status-dot"></span>
      ${h}
      <span class="par">P${parOf(h)}</span>
      <span class="score">${scoreVal}</span>
    `;
    tile.onclick = () => { currentHole = h; renderHole(); showScreen('hole'); };
    grid.appendChild(tile);
  }
  
  const putts = Object.values(r.holes).reduce((s, h) => s + (h.putts || 0), 0);
  // Fairways: count drives taken (non-par-3 holes where tee_result is recorded)
  let driveCount = 0;
  let fwCount = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (let h = 1; h <= 18; h++) {
    if (PAR3_HOLES.has(h)) continue;
    const hd = r.holes[h];
    if (hd && hd.tee_result) {
      driveCount++;
      if (hd.tee_result === 'F') fwCount++;
      else if (hd.tee_result === 'L') leftCount++;
      else if (hd.tee_result === 'R') rightCount++;
    }
  }
  // Missed swings = count of shots with quality <= 5
  let missedSwings = 0;
  for (const hd of Object.values(r.holes)) {
    if (!hd.shots) continue;
    for (const shot of hd.shots) {
      if (shot.quality && shot.quality <= 5) missedSwings++;
    }
  }
  // GIR: derived from sector + strokes_from_sector. A hole is GIR when the recorded
  // sector is on the green (description starts "Green,") AND the shot that reached
  // it (score - strokes_from_sector) is at or below par - 2.
  let girAttempted = 0;
  let girMade = 0;
  for (let h = 1; h <= 18; h++) {
    const hd = r.holes[h];
    if (!hd || !hd.score || !hd.sector ||
        hd.strokes_from_sector === undefined || hd.strokes_from_sector === null) continue;
    girAttempted++;
    const desc = (HOLES_DATA[String(h)].descriptions || {})[hd.sector] || '';
    const reachedAt = hd.score - hd.strokes_from_sector;
    if (desc.startsWith('Green,') && reachedAt <= parOf(h) - 2) girMade++;
  }
  document.getElementById('roundStats').innerHTML = `
    <div class="row"><span class="label">Total strokes</span><span class="val">${totalScore || '—'}</span></div>
    <div class="row"><span class="label">Total putts</span><span class="val">${putts || '—'}</span></div>
    <div class="row"><span class="label">Fairways</span><span class="val">${fwCount}/${driveCount || '—'}</span></div>
    <div class="row"><span class="label" style="padding-left:16px; color:var(--ink-muted);">Missed left</span><span class="val">${leftCount}</span></div>
    <div class="row"><span class="label" style="padding-left:16px; color:var(--ink-muted);">Missed right</span><span class="val">${rightCount}</span></div>
    <div class="row"><span class="label">GIR</span><span class="val">${girMade}/${girAttempted || '—'}</span></div>
    <div class="row"><span class="label">Missed swings <span style="font-family:var(--mono); font-size:11px; color:var(--ink-dim);">(quality ≤ 5)</span></span><span class="val">${missedSwings}</span></div>
  `;
  
  const completeBtn = document.getElementById('completeBtn');
  if (r.completed_at) {
    completeBtn.textContent = '✓ Round complete';
    completeBtn.classList.add('done-state');
  } else {
    completeBtn.textContent = 'Round complete';
    completeBtn.classList.remove('done-state');
  }
}

// ── Hole entry ──
function renderHole() {
  const r = getRound(currentRoundId);
  const h = currentHole;
  if (!r.holes[h]) r.holes[h] = {};
  currentHoleData = r.holes[h];
  if (!currentHoleData.shots) currentHoleData.shots = [];
  
  const par = parOf(h);
  document.getElementById('holeTitle').textContent = `Hole ${h}`;
  document.getElementById('holePinDisplay').textContent = r.pins[h-1];
  document.getElementById('parBadge').textContent = `Par ${par}`;
  
  // Strokes 1-8
  buildNumRow('strokesRow', 1, 8, 'score');
  // Putts 0-4
  buildNumRow('puttsRow', 0, 4, 'putts');
  // Strokes from sector 1-4
  buildNumRow('strokesFromSectorRow', 1, 4, 'strokes_from_sector');
  
  // GIR is derived from sector + strokes_from_sector at display time (no per-hole input).
  // Tee result chip row (par 3 → hide)
  bindChipRow('tee_result', v => v);
  document.getElementById('fairwayRow').style.display = PAR3_HOLES.has(h) ? 'none' : '';
  
  // Shots section
  renderShots();
  
  // Sector picker
  const spb = document.getElementById('sectorPickBtn');
  const smc = document.getElementById('sectorMasterCode');
  function updateSectorBtn() {
    if (currentHoleData.sector) {
      const desc = HOLES_DATA[h].descriptions[currentHoleData.sector] || '?';
      spb.classList.add('selected');
      spb.firstChild.textContent = desc;
      smc.textContent = 'S' + currentHoleData.sector;
    } else {
      spb.classList.remove('selected');
      spb.firstChild.textContent = 'Tap to pick sector reached';
      smc.textContent = '';
    }
  }
  updateSectorBtn();
  spb.onclick = () => openSectorPicker(h, code => {
    currentHoleData.sector = code;
    updateSectorBtn();
  });
  
  // First Putt chip rows
  bindChipRow('first_putt_slope', v => v);
  bindChipRow('first_putt_result', v => v);
  
  // First putt distance
  const fpd = document.getElementById('firstPuttDist');
  fpd.value = currentHoleData.first_putt_dist || '';
  fpd.oninput = () => {
    const v = parseInt(fpd.value);
    currentHoleData.first_putt_dist = isNaN(v) ? null : v;
  };
  
  // Pelz 3x3 grid
  buildPelzGrid();
  
  document.getElementById('saveHoleBtn').onclick = () => {
    saveRounds(); toast('Saved'); renderRound(); showScreen('round');
  };
  
  document.getElementById('addShotBtn').onclick = () => {
    currentHoleData.shots.push({club: null, quality: null});
    renderShots();
  };
}

function buildNumRow(elId, min, max, field) {
  const row = document.getElementById(elId);
  row.innerHTML = '';
  // Set the column count class based on the range
  const count = max - min + 1;
  row.className = `num-row cols-${count}`;
  for (let v = min; v <= max; v++) {
    const b = document.createElement('button');
    b.textContent = v;
    b.dataset.val = v;
    if (currentHoleData[field] === v) b.classList.add('on');
    b.onclick = () => {
      currentHoleData[field] = v;
      row.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b));
    };
    row.appendChild(b);
  }
}

function bindChipRow(field, parseFn) {
  const containers = document.querySelectorAll(`[data-field="${field}"]`);
  containers.forEach(container => {
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => {
      const v = parseFn(b.dataset.val);
      b.classList.toggle('on', currentHoleData[field] === v ||
                                (typeof v === 'number' && currentHoleData[field] === b.dataset.val));
      b.onclick = () => {
        currentHoleData[field] = parseFn(b.dataset.val);
        buttons.forEach(bb => bb.classList.toggle('on', bb === b));
      };
    });
  });
}

function buildPelzGrid() {
  const grid = document.getElementById('pelzGrid');
  grid.innerHTML = '';
  // Layout: row 1 = long (7,8,9), row 2 = right dist (4,5,6), row 3 = short (1,2,3)
  const layout = [7,8,9, 4,5,6, 1,2,3];
  layout.forEach(n => {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.val = n;
    if (currentHoleData.pelz === n) b.classList.add('on');
    b.onclick = () => {
      currentHoleData.pelz = n;
      grid.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b));
    };
    grid.appendChild(b);
  });
}

function renderShots() {
  const list = document.getElementById('shotsList');
  list.innerHTML = '';
  const h = currentHole;
  const par = parOf(h);
  const defaultCount = defaultShotCount(par);
  
  // Ensure at least defaultCount shot slots exist
  while (currentHoleData.shots.length < defaultCount) {
    currentHoleData.shots.push({club: null, quality: null});
  }
  
  currentHoleData.shots.forEach((shot, idx) => {
    const block = document.createElement('div');
    block.className = 'shot-block';
    const isExtra = idx >= defaultCount;
    block.innerHTML = `
      <div class="shot-title">
        <span>Shot ${idx + 1}</span>
        ${isExtra ? '<button class="remove" data-idx="'+idx+'">Remove</button>' : ''}
      </div>
      <div class="sublabel">Club</div>
      <div class="chip-row club-chips" data-idx="${idx}"></div>
      <div class="sublabel">Quality</div>
      <div class="num-row cols-5 quality-row" data-idx="${idx}"></div>
    `;
    list.appendChild(block);
    
    // Club chips for this shot
    const clubChips = block.querySelector('.club-chips');
    CLUBS.forEach(c => {
      const b = document.createElement('button');
      b.textContent = c;
      b.title = CLUB_NAMES[c];
      if (shot.club === c) b.classList.add('on');
      b.onclick = () => {
        shot.club = (shot.club === c) ? null : c;
        clubChips.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b && shot.club === c));
      };
      clubChips.appendChild(b);
    });
    
    // Quality 1-10 (split into two rows of 5)
    const qRow = block.querySelector('.quality-row');
    qRow.style.gridTemplateColumns = 'repeat(5, 1fr)';
    qRow.style.gridAutoRows = 'auto';
    for (let q = 1; q <= 10; q++) {
      const b = document.createElement('button');
      b.textContent = q;
      if (shot.quality === q) b.classList.add('on');
      b.onclick = () => {
        shot.quality = q;
        qRow.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b));
      };
      qRow.appendChild(b);
    }
  });
  
  // Remove handlers
  list.querySelectorAll('.remove').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      currentHoleData.shots.splice(idx, 1);
      renderShots();
    };
  });
}

// ── Sector picker modal ──
function openSectorPicker(holeNum, callback) {
  const modal = document.getElementById('sectorModal');
  document.getElementById('sectorModalTitle').textContent = `Hole ${holeNum} — pick sector`;
  
  const hd = HOLES_DATA[holeNum];
  const svgWrap = document.getElementById('sectorSvgWrap');
  const [iw, ih] = hd.photo_dims;
  
  let svg = `<svg viewBox="0 0 ${iw} ${ih}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<image href="data:image/jpeg;base64,${hd.photo_b64}" x="0" y="0" width="${iw}" height="${ih}" opacity="0.85"/>`;
  
  const entryByCode = {};
  hd.entries.forEach(e => entryByCode[e.master_code] = e.entry_num);
  
  for (const sk of hd.sector_order) {
    const poly = hd.sectors[sk];
    const pts = poly.map(p => p.join(',')).join(' ');
    const isGreen = (hd.descriptions[sk] || '').toLowerCase().includes('green');
    const fill = isGreen ? '#8B72B3' : '#C0A878';
    const num = entryByCode[sk] || '?';
    svg += `<polygon points="${pts}" fill="${fill}" stroke="#FFFFFF" stroke-width="1.2" fill-opacity="0.5" data-code="${sk}"/>`;
    const cx = poly.reduce((s,p)=>s+p[0],0) / poly.length;
    const cy = poly.reduce((s,p)=>s+p[1],0) / poly.length;
    const fontSize = Math.max(11, Math.min(iw, ih) / 30);
    svg += `<text x="${cx}" y="${cy}" font-size="${fontSize}" font-family="ui-monospace, monospace" text-anchor="middle" dominant-baseline="middle" fill="#1A1A1A" font-weight="600" pointer-events="none">${num}</text>`;
  }
  
  const pinNum = getRound(currentRoundId).pins[holeNum - 1];
  const pinPos = hd.pin_pos[pinNum];
  if (pinPos) {
    svg += `<circle cx="${pinPos[0]}" cy="${pinPos[1]}" r="${Math.max(5, Math.min(iw,ih)/55)}" fill="#B8472E" stroke="#1A1A1A" stroke-width="1.5"/>`;
  }
  svg += '</svg>';
  svgWrap.innerHTML = svg;
  
  svgWrap.querySelectorAll('polygon').forEach(p => {
    p.addEventListener('click', () => {
      callback(p.dataset.code);
      modal.classList.remove('active');
    });
  });
  
  const ul = document.getElementById('entryList');
  ul.innerHTML = '';
  hd.entries.forEach(e => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="num">${e.entry_num}</span>
      <span>${e.description}</span>
      <span class="master">S${e.master_code}</span>
    `;
    li.onclick = () => {
      callback(e.master_code);
      modal.classList.remove('active');
    };
    ul.appendChild(li);
  });
  
  modal.classList.add('active');
}

document.getElementById('sectorModalClose').onclick = () => {
  document.getElementById('sectorModal').classList.remove('active');
};

// ── JSON Backup / Restore ──
function backupJSON() {
  const data = {
    app: 'AQmod',
    version: 1,
    exported_at: new Date().toISOString(),
    rounds
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const filename = `aqmod_backup_${new Date().toISOString().slice(0,10)}.json`;
  if (navigator.canShare && navigator.canShare({files: [new File([blob], filename, {type:'application/json'})]})) {
    const file = new File([blob], filename, {type: 'application/json'});
    navigator.share({files: [file], title: filename}).catch(()=> downloadBlob(blob, filename));
  } else {
    downloadBlob(blob, filename);
  }
}

function restoreJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let data;
      try { data = JSON.parse(ev.target.result); }
      catch (err) { alert('Not a valid JSON file.'); return; }
      if (!data || !Array.isArray(data.rounds)) {
        alert('This does not look like an AQmod backup (no "rounds" array).');
        return;
      }
      const valid = data.rounds.filter(r => r && r.id && r.date);
      if (valid.length === 0) {
        alert('Backup contained no valid rounds.');
        return;
      }
      const summary = valid.length === data.rounds.length
        ? `Restore ${valid.length} round${valid.length === 1 ? '' : 's'}? Existing rounds with matching IDs will be overwritten.`
        : `Restore ${valid.length} valid round${valid.length === 1 ? '' : 's'} (${data.rounds.length - valid.length} skipped as malformed)? Existing rounds with matching IDs will be overwritten.`;
      if (!confirm(summary)) return;
      const byId = new Map(rounds.map(r => [r.id, r]));
      let added = 0, updated = 0;
      for (const r of valid) {
        if (byId.has(r.id)) updated++; else added++;
        byId.set(r.id, r);
      }
      rounds = Array.from(byId.values());
      saveRounds();
      renderRoundsList();
      toast(`Restored: ${added} new, ${updated} updated`);
    };
    reader.readAsText(file);
  };
  input.click();
}

document.getElementById('backupBtn').onclick = backupJSON;
document.getElementById('restoreBtn').onclick = restoreJSON;

// ── CSV Export ──
function exportCSV() {
  const r = getRound(currentRoundId);
  const rows = [];
  // Header
  const baseCols = ['date','notes','hole','par','pin','score','putts','gir','tee_result',
                    'sector','strokes_from_sector','first_putt_dist','first_putt_slope','first_putt_result','pelz'];
  // Shot columns: 4 fixed + dynamic. Use up to 6 shot slots (par 5 default 4, plus 2 extras).
  const maxShots = Math.max(6, ...Object.values(r.holes).map(h => (h.shots || []).length));
  const shotCols = [];
  for (let i = 1; i <= maxShots; i++) {
    shotCols.push(`shot${i}_club`);
    shotCols.push(`shot${i}_quality`);
  }
  rows.push([...baseCols, ...shotCols]);
  
  for (let h = 1; h <= 18; h++) {
    const hd = r.holes[h] || {};
    const par = parOf(h);
    const row = [
      r.date,
      r.notes || '',
      h,
      par,
      r.pins[h-1],
      hd.score ?? '',
      hd.putts ?? '',
      hd.gir ?? '',
      PAR3_HOLES.has(h) ? '' : (hd.tee_result || ''),
      hd.sector ? 'S' + hd.sector : '',
      hd.strokes_from_sector ?? '',
      hd.first_putt_dist || '',
      hd.first_putt_slope || '',
      hd.first_putt_result || '',
      hd.pelz ?? '',
    ];
    const shots = hd.shots || [];
    for (let i = 0; i < maxShots; i++) {
      const s = shots[i] || {};
      row.push(s.club || '');
      row.push(s.quality ?? '');
    }
    rows.push(row);
  }
  
  const csv = rows.map(row => row.map(c => {
    const s = String(c);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');
  
  const blob = new Blob([csv], {type: 'text/csv'});
  const filename = `aqmod_${r.date}.csv`;
  
  if (navigator.canShare && navigator.canShare({files: [new File([blob], filename, {type:'text/csv'})]})) {
    const file = new File([blob], filename, {type: 'text/csv'});
    navigator.share({files: [file], title: filename}).catch(()=>{
      downloadBlob(blob, filename);
    });
  } else {
    downloadBlob(blob, filename);
  }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportBtn').onclick = exportCSV;

document.getElementById('editPinsBtn').onclick = () => {
  renderNewRound(getRound(currentRoundId));
  showScreen('newround');
};

document.getElementById('completeBtn').onclick = () => {
  const r = getRound(currentRoundId);
  if (r.completed_at) {
    if (!confirm('Mark this round as not yet complete?')) return;
    r.completed_at = null;
  } else {
    const missing = [];
    for (let h = 1; h <= 18; h++) {
      const hd = r.holes[h];
      if (!hd || !hd.score) continue;
      const probs = [];
      if (!hd.sector) probs.push('sector');
      if (hd.strokes_from_sector === undefined || hd.strokes_from_sector === null) probs.push('strokes from sector');
      // First-putt fields only matter when there's at least one putt
      if (hd.putts && hd.putts > 0) {
        if (!hd.first_putt_dist) probs.push('first putt distance');
        if (!hd.first_putt_slope) probs.push('first putt slope');
        if (!hd.first_putt_result) probs.push('first putt result');
        if (!hd.pelz) probs.push('Pelz');
      }
      if (probs.length) missing.push(`H${h}: ${probs.join(', ')}`);
    }
    if (missing.length) {
      const msg = `Missing data:\n\n${missing.join('\n')}\n\nMark round complete anyway?`;
      if (!confirm(msg)) return;
    }
    r.completed_at = new Date().toISOString();
  }
  saveRounds(); renderRound();
  toast(r.completed_at ? 'Round marked complete' : 'Round reopened');
};

document.getElementById('deleteRoundBtn').onclick = () => {
  if (!confirm('Delete this round? This cannot be undone.')) return;
  rounds = rounds.filter(r => r.id !== currentRoundId);
  saveRounds(); renderRoundsList(); showScreen('rounds'); toast('Round deleted');
};

document.getElementById('newRoundBtn').onclick = () => {
  renderNewRound(null);
  showScreen('newround');
};

// ── Toast ──
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}

renderRoundsList();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
