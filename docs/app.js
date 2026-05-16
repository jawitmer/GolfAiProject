// AQ Data Entry PWA — app logic
// Persistence: localStorage. Schema: rounds = [{id, date, notes, pins:[18], holes:{1:{...}, ...}}]

const STORAGE_KEY = 'aq_rounds_v1';
const CLUBS = ['D','3W','5W','3H','4H','5H','6H','7i','8i','9i','W','SW','P'];
const LIES = ['Fwy','Rgh','Sand','Other'];

// Holes that are par 3 (no fairway hit possible). Joel can override these.
const PAR3_HOLES = new Set([5, 8, 13, 16]);

const SCORE_COLORS = {
  4.5: '#1B7A2B', 4.0: '#4CAF50', 3.5: '#8BC34A', 3.0: '#CDDC39',
  2.5: '#FFC107', 2.0: '#FF9800', 1.5: '#FF5722', 1.0: '#B71C1C'
};

// ── State ──
let rounds = loadRounds();
let currentRoundId = null;
let currentHole = null;
let currentHoleData = null;

// ── Utilities ──
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
function holeStatus(h) {
  if (!h) return 'empty';
  if (h.score && h.score > 0) {
    // Complete if scorecard is filled
    return 'complete';
  }
  if (h.sector || h.approach_club || h.first_putt_dist) return 'partial';
  return 'empty';
}

// ── Screens ──
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const backBtn = document.getElementById('backBtn');
  if (name === 'rounds') {
    backBtn.style.display = 'none';
    document.getElementById('topTitle').textContent = 'AQ';
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
    li.className = 'round-item';
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

// ── New round (single pin per round) ──
function renderNewRound(existingRound) {
  const isEdit = !!existingRound;
  document.getElementById('roundDateInput').value = isEdit ? existingRound.date : new Date().toISOString().slice(0,10);
  document.getElementById('roundNotesInput').value = isEdit ? (existingRound.notes || '') : '';
  document.getElementById('createRoundBtn').textContent = isEdit ? 'Save Pin' : 'Start Round';
  
  // Build single-pin row
  const row = document.getElementById('singlePinRow');
  row.innerHTML = '';
  // For edit mode, derive single pin from existingRound.pins[0] (all 18 should be the same now)
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
    if (selectedPin === null) {
      toast('Pick a pin position');
      return;
    }
    const pins = new Array(18).fill(selectedPin);
    if (isEdit) {
      existingRound.pins = pins;
      saveRounds();
      renderRound();
      showScreen('round');
      toast('Pin updated');
    } else {
      const id = uid();
      const newR = {
        id,
        date: document.getElementById('roundDateInput').value,
        notes: document.getElementById('roundNotesInput').value.trim(),
        pins,
        holes: {}
      };
      rounds.push(newR);
      saveRounds();
      currentRoundId = id;
      renderRound();
      showScreen('round');
    }
  };
}

function divWith(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}

// ── Round dashboard ──
function renderRound() {
  const r = getRound(currentRoundId);
  if (!r) { showScreen('rounds'); return; }
  document.getElementById('roundDate').textContent = fmtDate(r.date);
  const filled = Object.keys(r.holes).filter(h => r.holes[h].score).length;
  const totalScore = Object.values(r.holes).reduce((s, h) => s + (h.score || 0), 0);
  document.getElementById('roundMeta').textContent =
    `${filled}/18 holes recorded${totalScore ? ' · ' + totalScore + ' strokes' : ''}${r.notes ? ' · ' + r.notes : ''}`;
  
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
      <span class="score">${scoreVal}</span>
    `;
    tile.onclick = () => { currentHole = h; renderHole(); showScreen('hole'); };
    grid.appendChild(tile);
  }
  
  // Stats
  const putts = Object.values(r.holes).reduce((s, h) => s + (h.putts || 0), 0);
  const girCount = Object.values(r.holes).filter(h => h.gir === 1).length;
  const fwCount = Object.values(r.holes).filter(h => h.fairway === 1).length;
  const stats = document.getElementById('roundStats');
  stats.innerHTML = `
    <div class="row"><span class="label">Total strokes</span><span class="val">${totalScore || '—'}</span></div>
    <div class="row"><span class="label">Total putts</span><span class="val">${putts || '—'}</span></div>
    <div class="row"><span class="label">GIR</span><span class="val">${girCount}/${filled || 18}</span></div>
    <div class="row"><span class="label">Fairways</span><span class="val">${fwCount}/14</span></div>
  `;
}

// ── Hole entry ──
function renderHole() {
  const r = getRound(currentRoundId);
  const h = currentHole;
  if (!r.holes[h]) r.holes[h] = {};
  currentHoleData = r.holes[h];
  
  document.getElementById('holeTitle').textContent = `Hole ${h}`;
  document.getElementById('holePinDisplay').textContent = r.pins[h-1];
  
  // Build chip rows
  buildChips('clubChips', CLUBS, 'approach_club');
  buildChips('lieChips', LIES, 'approach_lie');
  
  // Bind steppers
  document.querySelectorAll('.stepper').forEach(s => {
    const field = s.dataset.field;
    const min = parseInt(s.dataset.min);
    const max = parseInt(s.dataset.max);
    const val = currentHoleData[field];
    s.querySelector('.val').textContent = (val !== undefined && val !== null) ? val : '—';
    const buttons = s.querySelectorAll('button');
    buttons.forEach(b => {
      b.onclick = () => {
        const delta = parseInt(b.dataset.delta);
        let cur = currentHoleData[field];
        if (cur === undefined || cur === null) cur = (delta > 0) ? min : min;
        cur = Math.max(min, Math.min(max, cur + delta));
        currentHoleData[field] = cur;
        s.querySelector('.val').textContent = cur;
      };
    });
  });
  
  // Toggle buttons (gir, fairway)
  document.querySelectorAll('.toggle').forEach(t => {
    const field = t.dataset.field;
    const buttons = t.querySelectorAll('button');
    buttons.forEach(b => {
      b.classList.toggle('on', String(currentHoleData[field]) === b.dataset.val);
      b.onclick = () => {
        const v = parseInt(b.dataset.val);
        currentHoleData[field] = v;
        buttons.forEach(bb => bb.classList.toggle('on', bb === b));
      };
    });
  });
  
  // Fairway visibility (par 3)
  document.getElementById('fairwayRow').style.display = PAR3_HOLES.has(h) ? 'none' : '';
  
  // Distance and first putt inputs
  const distInput = document.getElementById('distInput');
  distInput.value = currentHoleData.approach_distance || '';
  distInput.oninput = () => {
    const v = parseInt(distInput.value);
    currentHoleData.approach_distance = isNaN(v) ? null : v;
  };
  const fpd = document.getElementById('firstPuttDist');
  fpd.value = currentHoleData.first_putt_dist || '';
  fpd.oninput = () => {
    const v = parseInt(fpd.value);
    currentHoleData.first_putt_dist = isNaN(v) ? null : v;
  };
  
  // First putt slope chip row
  document.querySelectorAll('[data-field="first_putt_slope"] button').forEach(b => {
    b.classList.toggle('on', currentHoleData.first_putt_slope === b.dataset.val);
    b.onclick = () => {
      currentHoleData.first_putt_slope = b.dataset.val;
      b.parentElement.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b));
    };
  });
  
  // Sector picker button
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
  spb.onclick = () => openSectorPicker(h, (code) => {
    currentHoleData.sector = code;
    updateSectorBtn();
  });
  
  // Save button
  document.getElementById('saveHoleBtn').onclick = () => {
    saveRounds();
    toast('Saved');
    renderRound();
    showScreen('round');
  };
}

function buildChips(containerId, items, field) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  items.forEach(item => {
    const b = document.createElement('button');
    b.textContent = item;
    b.dataset.val = item;
    if (currentHoleData[field] === item) b.classList.add('on');
    b.onclick = () => {
      // Tap again to deselect
      if (currentHoleData[field] === item) {
        currentHoleData[field] = null;
        b.classList.remove('on');
      } else {
        currentHoleData[field] = item;
        c.querySelectorAll('button').forEach(bb => bb.classList.toggle('on', bb === b));
      }
    };
    c.appendChild(b);
  });
}

// ── Sector picker modal ──
function openSectorPicker(holeNum, callback) {
  const modal = document.getElementById('sectorModal');
  document.getElementById('sectorModalTitle').textContent = `Hole ${holeNum} — pick sector`;
  
  const hd = HOLES_DATA[holeNum];
  const svgWrap = document.getElementById('sectorSvgWrap');
  const [iw, ih] = hd.photo_dims;
  
  // Build SVG with photo background + clickable polygons
  let svg = `<svg viewBox="0 0 ${iw} ${ih}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<image href="data:image/jpeg;base64,${hd.photo_b64}" x="0" y="0" width="${iw}" height="${ih}" opacity="0.85"/>`;
  
  // Polygons in sector_order
  const entryByCode = {};
  hd.entries.forEach(e => entryByCode[e.master_code] = e.entry_num);
  
  for (const sk of hd.sector_order) {
    const poly = hd.sectors[sk];
    const pts = poly.map(p => p.join(',')).join(' ');
    const isGreen = (hd.descriptions[sk] || '').toLowerCase().includes('green');
    const fill = isGreen ? '#5A7F4F' : '#C0A878';
    const num = entryByCode[sk] || '?';
    svg += `<polygon points="${pts}" fill="${fill}" stroke="#FFFFFF" stroke-width="1.2" fill-opacity="0.5" data-code="${sk}"/>`;
    // Label
    const cx = poly.reduce((s,p)=>s+p[0],0) / poly.length;
    const cy = poly.reduce((s,p)=>s+p[1],0) / poly.length;
    const fontSize = Math.max(11, Math.min(iw, ih) / 30);
    svg += `<text x="${cx}" y="${cy}" font-size="${fontSize}" font-family="ui-monospace, monospace" text-anchor="middle" dominant-baseline="middle" fill="#1A1A1A" font-weight="600" pointer-events="none">${num}</text>`;
  }
  
  // Pin
  const pinNum = getRound(currentRoundId).pins[holeNum - 1];
  const pinPos = hd.pin_pos[pinNum];
  if (pinPos) {
    svg += `<circle cx="${pinPos[0]}" cy="${pinPos[1]}" r="${Math.max(5, Math.min(iw,ih)/55)}" fill="#B8472E" stroke="#1A1A1A" stroke-width="1.5"/>`;
  }
  
  svg += '</svg>';
  svgWrap.innerHTML = svg;
  
  // Wire up polygon clicks
  svgWrap.querySelectorAll('polygon').forEach(p => {
    p.addEventListener('click', () => {
      callback(p.dataset.code);
      modal.classList.remove('active');
    });
  });
  
  // Entry list (alternative tap targets)
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

// ── CSV Export ──
function exportCSV() {
  const r = getRound(currentRoundId);
  const rows = [];
  rows.push(['date','notes','hole','pin','score','putts','gir','fairway','penalty',
             'approach_club','approach_lie','approach_distance','approach_qualifies',
             'sector','strokes_from_sector','first_putt_dist','first_putt_slope']);
  for (let h = 1; h <= 18; h++) {
    const hd = r.holes[h] || {};
    const dist = hd.approach_distance;
    const qualifies = (dist && dist >= 40 && dist <= 180) ? 1 : 0;
    rows.push([
      r.date,
      r.notes || '',
      h,
      r.pins[h-1],
      hd.score || '',
      hd.putts || '',
      hd.gir ?? '',
      PAR3_HOLES.has(h) ? '' : (hd.fairway ?? ''),
      hd.penalty || '',
      hd.approach_club || '',
      hd.approach_lie || '',
      hd.approach_distance || '',
      dist ? qualifies : '',
      hd.sector ? 'S' + hd.sector : '',
      hd.strokes_from_sector ?? '',
      hd.first_putt_dist || '',
      hd.first_putt_slope || '',
    ]);
  }
  const csv = rows.map(row => row.map(c => {
    const s = String(c);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');
  
  const blob = new Blob([csv], {type: 'text/csv'});
  const filename = `aq_${r.date}.csv`;
  
  // Try Web Share API first (lets user save to iCloud Drive, email, AirDrop, etc.)
  if (navigator.canShare && navigator.canShare({files: [new File([blob], filename, {type:'text/csv'})]})) {
    const file = new File([blob], filename, {type: 'text/csv'});
    navigator.share({files: [file], title: filename}).catch(()=>{
      // Fallback to download
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

document.getElementById('deleteRoundBtn').onclick = () => {
  if (!confirm('Delete this round? This cannot be undone.')) return;
  rounds = rounds.filter(r => r.id !== currentRoundId);
  saveRounds();
  renderRoundsList();
  showScreen('rounds');
  toast('Round deleted');
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

// ── Init ──
renderRoundsList();

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
