// ---------- Storage ----------
const STORAGE_KEY = 'workoutTrackerData';

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workouts: [], logs: [] };
    const parsed = JSON.parse(raw);
    return {
      workouts: parsed.workouts || [],
      logs: parsed.logs || [],
    };
  } catch (e) {
    console.error('Failed to load data', e);
    return { workouts: [], logs: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();

// ---------- Helpers ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  const d = new Date();
  return formatDateLocal(d);
}

function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function findLogByDate(dateStr) {
  return state.logs.find(l => l.date === dateStr);
}

function getWorkout(id) {
  return state.workouts.find(w => w.id === id);
}

// Find most recent log (before given date, excluding the given date itself)
// for the same workout, to use as placeholder defaults.
function findPreviousLogForWorkout(workoutId, beforeDate) {
  const candidates = state.logs
    .filter(l => l.workoutId === workoutId && l.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return candidates[0] || null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- View navigation ----------
const views = ['calendar', 'workouts', 'history', 'data'];
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view);
  });
});

function showView(name) {
  views.forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
  });
  document.querySelectorAll('nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'workouts') renderWorkoutList();
  if (name === 'history') renderHistoryList();
  if (name === 'calendar') renderCalendar();
}

// ---------- Modal helpers ----------
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function confirmDialog(title, text, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalText').textContent = text;
  openModal('confirmModal');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  function cleanup() {
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
    closeModal('confirmModal');
  }
  function onOk() { cleanup(); onConfirm(); }
  function onCancel() { cleanup(); }
  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
}

// ---------- Workout Definitions ----------
let editingWorkoutId = null;
let draftExercises = [];

document.getElementById('newWorkoutBtn').addEventListener('click', () => {
  editingWorkoutId = null;
  draftExercises = [];
  document.getElementById('workoutModalTitle').textContent = 'New Workout';
  document.getElementById('workoutNameInput').value = '';
  document.getElementById('exerciseNameInput').value = '';
  renderExerciseTagList();
  openModal('workoutModal');
});

document.getElementById('cancelWorkoutBtn').addEventListener('click', () => {
  closeModal('workoutModal');
});

document.getElementById('addExerciseToWorkoutBtn').addEventListener('click', addExerciseToDraft);
document.getElementById('exerciseNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addExerciseToDraft();
  }
});

function addExerciseToDraft() {
  const input = document.getElementById('exerciseNameInput');
  const name = input.value.trim();
  if (!name) return;
  draftExercises.push({ id: uid(), name });
  input.value = '';
  renderExerciseTagList();
  input.focus();
}

function renderExerciseTagList() {
  const container = document.getElementById('exerciseTagList');
  if (draftExercises.length === 0) {
    container.innerHTML = '<span class="small-muted">No exercises added yet.</span>';
    return;
  }
  container.innerHTML = draftExercises.map((ex, i) => `
    <span class="ex-tag">${escapeHtml(ex.name)}<button data-idx="${i}" class="remove-ex-tag">✕</button></span>
  `).join('');
  container.querySelectorAll('.remove-ex-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      draftExercises.splice(Number(btn.dataset.idx), 1);
      renderExerciseTagList();
    });
  });
}

document.getElementById('saveWorkoutBtn').addEventListener('click', () => {
  const name = document.getElementById('workoutNameInput').value.trim();
  if (!name) { alert('Please enter a workout name.'); return; }
  if (draftExercises.length === 0) { alert('Please add at least one exercise.'); return; }

  if (editingWorkoutId) {
    const w = getWorkout(editingWorkoutId);
    w.name = name;
    w.exercises = draftExercises;
  } else {
    state.workouts.push({ id: uid(), name, exercises: draftExercises });
  }
  saveData();
  closeModal('workoutModal');
  renderWorkoutList();
});

function renderWorkoutList() {
  const container = document.getElementById('workoutList');
  if (state.workouts.length === 0) {
    container.innerHTML = '<div class="empty">No workouts defined yet. Click "+ New Workout" to create one.</div>';
    return;
  }
  container.innerHTML = state.workouts.map(w => `
    <div class="list-item">
      <div>
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="meta">${w.exercises.map(e => escapeHtml(e.name)).join(', ')}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" data-edit="${w.id}">Edit</button>
        <button class="danger" data-del="${w.id}">Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editWorkout(btn.dataset.edit));
  });
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDialog(
        'Delete workout?',
        'This will not delete past logs, but you will not be able to log this workout again unless you recreate it.',
        () => {
          state.workouts = state.workouts.filter(w => w.id !== btn.dataset.del);
          saveData();
          renderWorkoutList();
        }
      );
    });
  });
}

function editWorkout(id) {
  const w = getWorkout(id);
  if (!w) return;
  editingWorkoutId = id;
  draftExercises = w.exercises.map(e => ({ ...e }));
  document.getElementById('workoutModalTitle').textContent = 'Edit Workout';
  document.getElementById('workoutNameInput').value = w.name;
  document.getElementById('exerciseNameInput').value = '';
  renderExerciseTagList();
  openModal('workoutModal');
}

// ---------- Logging flow ----------
document.getElementById('logTodayBtn').addEventListener('click', () => {
  if (state.workouts.length === 0) {
    alert('Create a workout first in the "Workouts" tab.');
    return;
  }
  document.getElementById('logDateInput').value = todayStr();
  renderPickWorkoutList();
  openModal('pickWorkoutModal');
});

document.getElementById('cancelPickWorkoutBtn').addEventListener('click', () => {
  closeModal('pickWorkoutModal');
});

function renderPickWorkoutList() {
  const container = document.getElementById('pickWorkoutList');
  container.innerHTML = state.workouts.map(w => `
    <div class="list-item" style="cursor:pointer;" data-pick="${w.id}">
      <div>
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="meta">${w.exercises.map(e => escapeHtml(e.name)).join(', ')}</div>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const date = document.getElementById('logDateInput').value || todayStr();
      closeModal('pickWorkoutModal');
      startLogEntry(el.dataset.pick, date);
    });
  });
}

let currentLogContext = null; // { date, workoutId, existingLogId }

function startLogEntry(workoutId, date) {
  const workout = getWorkout(workoutId);
  if (!workout) return;

  const existing = findLogByDate(date);
  if (existing && existing.workoutId !== workoutId) {
    confirmDialog(
      'Replace existing log?',
      `You already logged "${existing.workoutName}" on ${date}. Logging a different workout will replace it. Continue?`,
      () => openLogModalFor(workout, date, null)
    );
    return;
  }
  openLogModalFor(workout, date, existing || null);
}

function openLogModalFor(workout, date, existingLog) {
  const prevLog = findPreviousLogForWorkout(workout.id, date);

  currentLogContext = { date, workoutId: workout.id, existingLogId: existingLog ? existingLog.id : null };

  document.getElementById('logModalTitle').textContent = existingLog ? 'Edit Logged Workout' : 'Log Workout';
  document.getElementById('logEntryDateInput').value = date;
  document.getElementById('logEntryWorkoutName').value = workout.name;
  document.getElementById('deleteLogBtn').classList.toggle('hidden', !existingLog);

  const container = document.getElementById('logExercisesContainer');
  container.innerHTML = '';

  workout.exercises.forEach(ex => {
    const existingExLog = existingLog && existingLog.exerciseLogs.find(el => el.exerciseId === ex.id);
    const prevExLog = prevLog && prevLog.exerciseLogs.find(el => el.exerciseId === ex.id);

    let sets;
    if (existingExLog) {
      sets = existingExLog.sets.map(s => ({ reps: s.reps, weight: s.weight }));
    } else if (prevExLog && prevExLog.sets.length) {
      sets = prevExLog.sets.map(() => ({ reps: '', weight: '' }));
    } else {
      sets = [{ reps: '', weight: '' }];
    }

    const placeholderSets = prevExLog ? prevExLog.sets : null;

    const block = document.createElement('div');
    block.className = 'exercise-block';
    block.dataset.exerciseId = ex.id;
    block.innerHTML = `
      <h3>${escapeHtml(ex.name)}</h3>
      <table>
        <thead>
          <tr><th style="width:40px;">Set</th><th>Reps</th><th>Weight</th><th></th></tr>
        </thead>
        <tbody class="sets-body"></tbody>
      </table>
      <button class="icon-btn add-set-btn" type="button">+ Add Set</button>
    `;
    container.appendChild(block);

    const tbody = block.querySelector('.sets-body');
    sets.forEach((s, i) => addSetRow(tbody, s, placeholderSets ? placeholderSets[i] : null));

    block.querySelector('.add-set-btn').addEventListener('click', () => {
      const idx = tbody.querySelectorAll('.set-row').length;
      const ph = placeholderSets ? placeholderSets[idx] : null;
      addSetRow(tbody, { reps: '', weight: '' }, ph);
    });
  });

  openModal('logModal');
}

function addSetRow(tbody, values, placeholder) {
  const tr = document.createElement('tr');
  tr.className = 'set-row';
  const setNum = tbody.querySelectorAll('.set-row').length + 1;
  const repsPh = placeholder ? placeholder.reps : '';
  const weightPh = placeholder ? placeholder.weight : '';
  tr.innerHTML = `
    <td class="set-num">${setNum}</td>
    <td><input type="number" class="reps-input" min="0" placeholder="${repsPh}" value="${values.reps ?? ''}"></td>
    <td><input type="number" class="weight-input" min="0" step="any" placeholder="${weightPh}" value="${values.weight ?? ''}"></td>
    <td><button type="button" class="remove-set-btn" title="Remove set" style="background:none;border:none;color:var(--danger);cursor:pointer;">✕</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('.remove-set-btn').addEventListener('click', () => {
    tr.remove();
    renumberSets(tbody);
  });
}

function renumberSets(tbody) {
  tbody.querySelectorAll('.set-row').forEach((tr, i) => {
    tr.querySelector('.set-num').textContent = i + 1;
  });
}

document.getElementById('cancelLogBtn').addEventListener('click', () => closeModal('logModal'));

document.getElementById('saveLogBtn').addEventListener('click', () => {
  if (!currentLogContext) return;
  const date = document.getElementById('logEntryDateInput').value;
  if (!date) { alert('Please choose a date.'); return; }
  const workout = getWorkout(currentLogContext.workoutId);
  if (!workout) return;

  // If date changed, or a different log already exists at this date, handle collisions.
  const collidingLog = findLogByDate(date);
  if (collidingLog && collidingLog.id !== currentLogContext.existingLogId) {
    alert(`A workout is already logged on ${date}. Delete or edit that entry first, or pick a different date.`);
    return;
  }

  const exerciseLogs = [];
  document.querySelectorAll('#logExercisesContainer .exercise-block').forEach(block => {
    const exerciseId = block.dataset.exerciseId;
    const exDef = workout.exercises.find(e => e.id === exerciseId);
    const sets = [];
    block.querySelectorAll('.set-row').forEach(row => {
      const reps = row.querySelector('.reps-input').value;
      const weight = row.querySelector('.weight-input').value;
      if (reps !== '' || weight !== '') {
        sets.push({ reps: reps === '' ? '' : Number(reps), weight: weight === '' ? '' : Number(weight) });
      }
    });
    exerciseLogs.push({ exerciseId, name: exDef ? exDef.name : '', sets });
  });

  if (currentLogContext.existingLogId) {
    const log = state.logs.find(l => l.id === currentLogContext.existingLogId);
    log.date = date;
    log.workoutId = workout.id;
    log.workoutName = workout.name;
    log.exerciseLogs = exerciseLogs;
  } else {
    state.logs.push({
      id: uid(),
      date,
      workoutId: workout.id,
      workoutName: workout.name,
      exerciseLogs,
    });
  }

  saveData();
  closeModal('logModal');
  renderCalendar();
  renderHistoryList();
});

document.getElementById('deleteLogBtn').addEventListener('click', () => {
  if (!currentLogContext || !currentLogContext.existingLogId) return;
  confirmDialog('Delete this log?', 'This cannot be undone.', () => {
    state.logs = state.logs.filter(l => l.id !== currentLogContext.existingLogId);
    saveData();
    closeModal('logModal');
    renderCalendar();
    renderHistoryList();
  });
});

// ---------- Calendar ----------
let calViewDate = new Date(); // current month being viewed

document.getElementById('prevMonth').addEventListener('click', () => {
  calViewDate.setMonth(calViewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  calViewDate.setMonth(calViewDate.getMonth() + 1);
  renderCalendar();
});

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderCalendar() {
  const dowContainer = document.getElementById('calDow');
  dowContainer.innerHTML = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();

  const grid = document.getElementById('calGrid');
  let html = '';
  for (let i = 0; i < startOffset; i++) {
    html += `<div class="cal-day empty-cell"></div>`;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDateLocal(new Date(year, month, day));
    const log = findLogByDate(dateStr);
    const classes = ['cal-day'];
    if (dateStr === today) classes.push('today');
    if (log) classes.push('has-log');
    html += `<div class="${classes.join(' ')}" data-date="${dateStr}" title="${log ? escapeHtml(log.workoutName) : ''}">
      <span>${day}</span>
      ${log ? '<span class="dot"></span>' : ''}
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => onCalendarDayClick(el.dataset.date));
  });
}

function onCalendarDayClick(dateStr) {
  const existing = findLogByDate(dateStr);
  if (existing) {
    const workout = getWorkout(existing.workoutId);
    if (workout) {
      openLogModalFor(workout, dateStr, existing);
    } else {
      // Workout definition was deleted; show read-only-ish via alert fallback
      alert(`Logged "${existing.workoutName}" but its workout definition was deleted, so it can't be edited. Delete it from History if needed.`);
    }
    return;
  }
  if (state.workouts.length === 0) {
    alert('Create a workout first in the "Workouts" tab.');
    return;
  }
  document.getElementById('logDateInput').value = dateStr;
  renderPickWorkoutList();
  openModal('pickWorkoutModal');
}

// ---------- History ----------
function renderHistoryList() {
  const container = document.getElementById('historyList');
  if (state.logs.length === 0) {
    container.innerHTML = '<div class="empty">No workouts logged yet.</div>';
    return;
  }
  const sorted = [...state.logs].sort((a, b) => (a.date < b.date ? 1 : -1));
  container.innerHTML = sorted.map(log => {
    const summary = log.exerciseLogs.map(el => {
      const setsStr = el.sets.map(s => `${s.reps || 0}x${s.weight || 0}`).join(', ');
      return `${escapeHtml(el.name)} (${setsStr || 'no sets'})`;
    }).join(' • ');
    return `
      <div class="list-item">
        <div>
          <div class="name">${log.date} — ${escapeHtml(log.workoutName)}</div>
          <div class="meta">${summary}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="icon-btn" data-edit-log="${log.id}">Edit</button>
          <button class="danger" data-del-log="${log.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-edit-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = state.logs.find(l => l.id === btn.dataset.editLog);
      const workout = getWorkout(log.workoutId);
      if (!workout) { alert('Workout definition was deleted; cannot edit.'); return; }
      openLogModalFor(workout, log.date, log);
    });
  });
  container.querySelectorAll('[data-del-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDialog('Delete this log?', 'This cannot be undone.', () => {
        state.logs = state.logs.filter(l => l.id !== btn.dataset.delLog);
        saveData();
        renderHistoryList();
        renderCalendar();
      });
    });
  });
}

// ---------- Data export/import ----------
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workout-tracker-export-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (!parsed.workouts || !parsed.logs) throw new Error('Invalid file format');
      confirmDialog(
        'Replace all data?',
        'Importing will overwrite your current workouts and logs with the contents of this file.',
        () => {
          state = { workouts: parsed.workouts, logs: parsed.logs };
          saveData();
          renderWorkoutList();
          renderHistoryList();
          renderCalendar();
          alert('Import successful.');
        }
      );
    } catch (err) {
      alert('Failed to import: invalid JSON file.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  confirmDialog('Clear all data?', 'This will permanently delete all workouts and logs from this browser.', () => {
    state = { workouts: [], logs: [] };
    saveData();
    renderWorkoutList();
    renderHistoryList();
    renderCalendar();
  });
});

// ---------- Init ----------
renderCalendar();
