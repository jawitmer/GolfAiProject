// DWmod v0.2 —Desert Willow data entry PWA (Firecliff, Mountain View) — separate from AQmod
// Round: {id, date, notes, course, tee, holes}
// Schema per hole: score, putts, tee_result(L/F/R), gir(1/0), shots[{club,quality}],
//   first_putt_dist, first_putt_slope, first_putt_result, pelz(1-9)

const STORAGE_KEY = 'dwmod_rounds_v1';
const DRAFT_KEY = STORAGE_KEY + '_draft_notes';
const CLUBS = ['D','F','H','I','S','W','C','B'];
const CLUB_NAMES = {D:'Driver', F:'Fairway wood', H:'Hybrid', I:'Iron', S:'Sand', W:'Wedge', C:'Chip', B:'Bump and Run'};

// Par per hole, by course (Desert Willow scorecards)
const COURSES = {
  firecliff:    {name: 'Firecliff',     pars: [5,4,3,4,4,4,5,3,4, 4,4,4,5,3,4,4,3,5]},
  mountainview: {name: 'Mountain View', pars: [4,4,4,4,3,5,4,3,5, 4,3,5,3,4,4,4,4,5]}
};
const TEES = ['Black','Purple','Purple/White','White','White/Tan','Tan','Tan/Green','Green'];
function parOf(h) {
  const r = getRound(currentRoundId);
  return (COURSES[r && r.course] || COURSES.firecliff).pars[h - 1];
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
// 8-stop AQ-score color gradient (matches AQ_Sector_Maps PDF).
function scoreToColor(v) {
  if (v >= 4.5) return '#1B7A2B';
  if (v >= 4.0) return '#4CAF50';
  if (v >= 3.5) return '#8BC34A';
  if (v >= 3.0) return '#CDDC39';
  if (v >= 2.5) return '#FFC107';
  if (v >= 2.0) return '#FF9800';
  if (v >= 1.5) return '#FF5722';
  return '#B71C1C';
}
function holeStatus(h) {
  if (!h) return 'empty';
  if (h.score && h.score > 0) return 'complete';
  if (h.gir !== undefined || (h.shots && h.shots.length) || h.first_putt_slope) return 'partial';
  return 'empty';
}
// Single source of truth for per-hole missing-field checks. Used by both the
// round-complete validation and the per-hole save notification. A hole with no
// real data entered is treated as not-yet-played and reports nothing missing;
// once a hole has any data, a missing score is flagged like any other field.
function holeMissing(hd) {
  if (!hd) return [];
  // "Touched" = any user-entered data. Note: par/pin are display-only and not
  // stored on the hole, and an opened-but-empty hole is just {shots: []}, so an
  // empty shots array does not count as data (keeps 9-hole rounds quiet).
  const touched = hd.score || hd.gir !== undefined || hd.tee_result || hd.putts ||
    hd.first_putt_dist || hd.first_putt_slope || hd.first_putt_result || hd.pelz ||
    (hd.shots && hd.shots.length > 0);
  if (!touched) return [];
  const probs = [];
  if (!hd.score) probs.push('score');
  if (hd.gir !== 0 && hd.gir !== 1) probs.push('GIR');
  // First-putt fields only matter when there's at least one putt
  if (hd.putts && hd.putts > 0) {
    if (!hd.first_putt_dist) probs.push('first putt distance');
    if (!hd.first_putt_slope) probs.push('first putt slope');
    if (!hd.first_putt_result) probs.push('first putt result');
    if (!hd.pelz) probs.push('Pelz');
  }
  return probs;
}

// ── Screens ──
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const backBtn = document.getElementById('backBtn');
  if (name === 'rounds') {
    backBtn.style.display = 'none';
    document.getElementById('topTitle').textContent = 'DWmod';
    document.getElementById('topCrumb').textContent = 'Desert Willow';
  } else if (name === 'round') {
    backBtn.style.display = '';
    backBtn.onclick = () => { renderRoundsList(); showScreen('rounds'); };
    document.getElementById('topTitle').textContent = 'Round';
    document.getElementById('topCrumb').textContent = (COURSES[(getRound(currentRoundId) || {}).course] || {}).name || '';
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
        <div class="meta">${(COURSES[r.course] || {}).name || ''} · ${filled}/18 holes · ${totalScore || '—'} strokes${r.notes ? ' · ' + r.notes : ''}</div>
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
  notesInput.value = isEdit ? (existingRound.notes || '') : (localStorage.getItem(DRAFT_KEY) || '');
  notesInput.oninput = () => { autoGrow(notesInput); if (!isEdit) localStorage.setItem(DRAFT_KEY, notesInput.value); };
  requestAnimationFrame(() => autoGrow(notesInput));
  document.getElementById('createRoundBtn').textContent = isEdit ? 'Save' : 'Start Round';
  
  let selectedCourse = isEdit ? existingRound.course : null;
  let selectedTee = isEdit ? existingRound.tee : null;
  const chips = (id, opts, get, set) => {
    const row = document.getElementById(id);
    row.innerHTML = '';
    opts.forEach(([val, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', get() === val);
      b.onclick = () => { set(val); row.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b)); };
      row.appendChild(b);
    });
  };
  chips('courseRow', Object.entries(COURSES).map(([k, c]) => [k, c.name]), () => selectedCourse, v => selectedCourse = v);
  chips('teeRow', TEES.map(t => [t, t]), () => selectedTee, v => selectedTee = v);
  
  document.getElementById('createRoundBtn').onclick = () => {
    if (!selectedCourse) { toast('Pick a course'); return; }
    if (!selectedTee) { toast('Pick a tee'); return; }
    if (isEdit) {
      existingRound.course = selectedCourse;
      existingRound.tee = selectedTee;
      existingRound.notes = document.getElementById('roundNotesInput').value.trim();
      saveRounds(); renderRound(); showScreen('round'); toast('Round updated');
    } else {
      const id = uid();
      const newR = {
        id,
        date: document.getElementById('roundDateInput').value,
        notes: document.getElementById('roundNotesInput').value.trim(),
        course: selectedCourse, tee: selectedTee, holes: {}
      };
      rounds.push(newR);
      saveRounds();
      localStorage.removeItem(DRAFT_KEY);
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
  ta.oninput = () => { autoGrow(ta); r.notes = ta.value.trim(); saveRounds(); };
  sec.appendChild(ta);
  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  const done = document.createElement('button');
  done.textContent = 'Close';
  done.className = 'done-btn';
  done.onclick = () => {
    r.notes = ta.value.trim();
    saveRounds();
    renderNotesSection(r);
  };
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
  // Cumulative par over holes with a recorded score
  let parSoFar = 0;
  for (let h = 1; h <= 18; h++) {
    if (r.holes[h] && r.holes[h].score) parSoFar += parOf(h);
  }
  const parDiff = totalScore - parSoFar;
  let parDiffStr = '';
  if (totalScore > 0) {
    if (parDiff === 0) parDiffStr = 'even';
    else if (parDiff > 0) parDiffStr = '+' + parDiff;
    else parDiffStr = parDiff;  // already has minus sign
  }
  document.getElementById('roundMeta').textContent =
    `${r.tee} tee · ${filled}/18 holes recorded${totalScore ? ' · ' + totalScore + ' strokes' : ''}`;
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
    if (parOf(h) === 3) continue;
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
  // GIR: recorded per hole (yes/no)
  let girAttempted = 0;
  let girMade = 0;
  for (let h = 1; h <= 18; h++) {
    const hd = r.holes[h];
    if (!hd || !hd.score || (hd.gir !== 0 && hd.gir !== 1)) continue;
    girAttempted++;
    if (hd.gir === 1) girMade++;
  }
  // Weighted average shot quality. Per club, average the qualities of all shots
  // in that category; weights are D:14, F:4, H:9, I:6, S:3, W:6, C:5, B:2.
  // Renormalized over categories that actually have data — empty categories drop out.
  const SHOT_WEIGHTS = {D:14, F:4, H:9, I:6, S:3, W:6, C:5, B:2};
  const sums = {}, counts = {};
  for (const hd of Object.values(r.holes)) {
    if (!hd.shots) continue;
    for (const shot of hd.shots) {
      if (!shot.club || !shot.quality) continue;
      sums[shot.club] = (sums[shot.club] || 0) + shot.quality;
      counts[shot.club] = (counts[shot.club] || 0) + 1;
    }
  }
  let wAvgNum = 0, wAvgDen = 0;
  for (const c of Object.keys(SHOT_WEIGHTS)) {
    if (counts[c]) {
      wAvgNum += SHOT_WEIGHTS[c] * (sums[c] / counts[c]);
      wAvgDen += SHOT_WEIGHTS[c];
    }
  }
  const avgQuality = wAvgDen ? (wAvgNum / wAvgDen) : null;
  document.getElementById('roundStats').innerHTML = `
    <div class="row"><span class="label">Total strokes</span><span class="val">${totalScore || '—'}${parDiffStr ? ` <span class="par-diff${parDiff < 0 ? ' neg' : ''}">${parDiffStr}</span>` : ''}</span></div>
    <div class="row"><span class="label">Total putts</span><span class="val">${putts || '—'}</span></div>
    <div class="row"><span class="label">Fairways</span><span class="val">${fwCount}/${driveCount || '—'}</span></div>
    <div class="row"><span class="label" style="padding-left:16px; color:var(--ink-muted);">Missed left</span><span class="val">${leftCount}</span></div>
    <div class="row"><span class="label" style="padding-left:16px; color:var(--ink-muted);">Missed right</span><span class="val">${rightCount}</span></div>
    <div class="row"><span class="label">GIR</span><span class="val">${girMade}/${girAttempted || '—'}</span></div>
    <div class="row"><span class="label">Missed swings <span style="font-family:var(--mono); font-size:11px; color:var(--ink-dim);">(quality ≤ 5)</span></span><span class="val">${missedSwings}</span></div>
    <div class="row"><span class="label">Avg shot quality</span><span class="val">${avgQuality === null ? '—' : avgQuality.toFixed(1)}</span></div>
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
  document.getElementById('parBadge').textContent = `Par ${par}`;
  
  // Strokes 1-8
  buildNumRow('strokesRow', 1, 8, 'score');
  // Putts 0-4
  buildNumRow('puttsRow', 0, 4, 'putts');
  
  // Tee result chip row (par 3 → hide)
  bindChipRow('tee_result', v => v);
  bindChipRow('gir', v => parseInt(v, 10));
  document.getElementById('fairwayRow').style.display = par === 3 ? 'none' : '';
  
  // Shots section
  renderShots();
  
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
    saveRounds();
    const probs = holeMissing(currentHoleData);
    toast(probs.length ? `Saved — missing: ${probs.join(', ')}` : 'Saved', probs.length ? 4000 : 1500);
    renderRound(); showScreen('round');
  };

  document.getElementById('clearHoleBtn').onclick = () => {
    const r = getRound(currentRoundId);
    const h = currentHole;
    if (!confirm(`Clear all data for hole ${h}? This cannot be undone.`)) return;
    r.holes[h] = {};
    currentHoleData = r.holes[h];
    saveRounds();
    toast('Hole cleared');
    renderHole();
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
    block.innerHTML = `
      <div class="shot-title">
        <span>Shot ${idx + 1}</span>
        <button class="remove" data-idx="${idx}">Remove</button>
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

// ── JSON Backup / Restore ──
function backupJSON() {
  const data = {
    app: 'DWmod',
    version: 1,
    exported_at: new Date().toISOString(),
    rounds
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const filename = `dwmod_backup_${new Date().toISOString().slice(0,10)}.json`;
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
        alert('This does not look like a DWmod backup (no "rounds" array).');
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
  const baseCols = ['date','notes','course','tee','hole','par','score','putts','gir','tee_result',
                    'first_putt_dist','first_putt_slope','first_putt_result','pelz'];
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
      COURSES[r.course].name,
      r.tee,
      h,
      par,
      hd.score ?? '',
      hd.putts ?? '',
      hd.gir ?? '',
      par === 3 ? '' : (hd.tee_result || ''),
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
  const filename = `dwmod_${r.date}.csv`;
  
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
      const probs = holeMissing(r.holes[h]);
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
  if (!confirm('Delete this entire round? All hole data will be permanently lost. This cannot be undone.')) return;
  rounds = rounds.filter(r => r.id !== currentRoundId);
  saveRounds(); renderRoundsList(); showScreen('rounds'); toast('Round deleted');
};

document.getElementById('newRoundBtn').onclick = () => {
  renderNewRound(null);
  showScreen('newround');
};

// ── Toast ──
let toastTimer = null;
function toast(msg, ms = 1500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

renderRoundsList();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
