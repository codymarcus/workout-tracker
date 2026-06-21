// ---------- Storage ----------
const STORAGE_KEY = 'workoutTrackerData';
const DEFAULT_BAR_WEIGHT = 45;

const TYPE_LABELS = {
  normal: 'Normal',
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  bodyweight: 'Bodyweight',
  timed: 'Timed',
};

// Migrate older saved data into the current shape WITHOUT touching any
// numbers the user already logged. Exercises gain a `type` (defaulting to
// 'normal', which is exactly how the app behaved before types existed) and
// barbell exercises gain a `barWeight` if missing.
function migrateState(s) {
  s.workouts = (s.workouts || []).map(w => ({
    ...w,
    exercises: (w.exercises || []).map(e => ({
      id: e.id,
      name: e.name,
      type: e.type || 'normal',
      barWeight: (e.type || 'normal') === 'barbell' ? (e.barWeight ?? DEFAULT_BAR_WEIGHT) : e.barWeight,
    })),
  }));
  s.logs = s.logs || [];
  return s;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workouts: [], logs: [] };
    const parsed = JSON.parse(raw);
    return migrateState({ workouts: parsed.workouts || [], logs: parsed.logs || [] });
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

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SHORT_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// dateStr is YYYY-MM-DD; parse as local components to avoid UTC shift.
function formatDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${SHORT_DOW[date.getDay()]}, ${SHORT_MONTHS[m - 1]} ${d}`;
}

function findLogByDate(dateStr) {
  return state.logs.find(l => l.date === dateStr);
}

function getWorkout(id) {
  return state.workouts.find(w => w.id === id);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function roundTo(n, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function formatSeconds(total) {
  const s = Math.max(0, Math.round(total || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ---------- Exercise type math ----------
// "Canonical" set values are what get persisted: {reps, weight} for
// normal/barbell/dumbbell, {reps} for bodyweight, {seconds} for timed.
// The per-type input fields are just convenient ways to produce/consume
// that canonical weight (e.g. barbell asks for plates-per-side).

function barWeightOf(ex) {
  return ex.barWeight ?? DEFAULT_BAR_WEIGHT;
}

// Convert a canonical set into the values shown in the editable inputs.
function decomposeSet(ex, set) {
  switch (ex.type) {
    case 'barbell':
      return { reps: set.reps, perSide: roundTo((set.weight - barWeightOf(ex)) / 2) };
    case 'dumbbell':
      return { reps: set.reps, perDb: roundTo(set.weight / 2) };
    case 'bodyweight':
      return { reps: set.reps };
    case 'timed':
      return { seconds: set.seconds };
    default:
      return { reps: set.reps, weight: set.weight };
  }
}

// Convert input field values back into a canonical set.
function composeSet(ex, vals) {
  switch (ex.type) {
    case 'barbell':
      return { reps: Number(vals.reps) || 0, weight: (Number(vals.perSide) || 0) * 2 + barWeightOf(ex) };
    case 'dumbbell':
      return { reps: Number(vals.reps) || 0, weight: (Number(vals.perDb) || 0) * 2 };
    case 'bodyweight':
      return { reps: Number(vals.reps) || 0 };
    case 'timed':
      return { seconds: Number(vals.seconds) || 0 };
    default:
      return { reps: Number(vals.reps) || 0, weight: Number(vals.weight) || 0 };
  }
}

function formatSetSummary(ex, set) {
  const type = ex.type;
  if (type === 'timed') return formatSeconds(set.seconds || 0);
  if (type === 'bodyweight') return `${set.reps || 0} reps`;
  if (type === 'barbell') {
    const perSide = roundTo((set.weight - barWeightOf(ex)) / 2);
    return `${set.reps || 0}×${perSide}/side (${roundTo(set.weight) || 0} lb)`;
  }
  if (type === 'dumbbell') {
    const perDb = roundTo(set.weight / 2);
    return `${set.reps || 0}×${perDb}/db (${roundTo(set.weight) || 0} lb)`;
  }
  return `${set.reps || 0}×${set.weight || 0}`;
}

function trendMetric(type, sets) {
  if (type === 'timed') return formatSeconds(Math.max(...sets.map(s => s.seconds || 0)));
  if (type === 'bodyweight') return `${Math.max(...sets.map(s => s.reps || 0))} reps`;
  return `${Math.max(...sets.map(s => s.weight || 0))} lb`;
}

// Sessions strictly before `beforeDate` that logged this exercise with at
// least one set, most recent first.
function getExerciseHistory(exerciseId, beforeDate, excludeLogId, limit = 4) {
  return state.logs
    .filter(l => l.id !== excludeLogId && l.date < beforeDate)
    .map(l => ({
      date: l.date,
      sets: (l.exerciseLogs.find(el => el.exerciseId === exerciseId) || { sets: [] }).sets,
    }))
    .filter(h => h.sets.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

function lastSetFor(st, history) {
  if (st.sets.length) return st.sets[st.sets.length - 1];
  if (history.length) return history[0].sets[history[0].sets.length - 1];
  return null;
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
let editingDraftIndex = -1;

document.getElementById('newWorkoutBtn').addEventListener('click', () => {
  editingWorkoutId = null;
  draftExercises = [];
  document.getElementById('workoutModalTitle').textContent = 'New Workout';
  document.getElementById('workoutNameInput').value = '';
  resetExerciseDraftForm();
  renderExerciseTagList();
  openModal('workoutModal');
});

document.getElementById('cancelWorkoutBtn').addEventListener('click', () => {
  closeModal('workoutModal');
});

document.getElementById('exerciseTypeInput').addEventListener('change', updateBarWeightVisibility);
function updateBarWeightVisibility() {
  const isBarbell = document.getElementById('exerciseTypeInput').value === 'barbell';
  document.getElementById('exerciseBarWeightContainer').classList.toggle('hidden', !isBarbell);
}

function resetExerciseDraftForm() {
  editingDraftIndex = -1;
  document.getElementById('exerciseNameInput').value = '';
  document.getElementById('exerciseTypeInput').value = 'normal';
  document.getElementById('exerciseBarWeightInput').value = DEFAULT_BAR_WEIGHT;
  updateBarWeightVisibility();
  document.getElementById('addExerciseToWorkoutBtn').textContent = '+ Add Exercise';
}

document.getElementById('addExerciseToWorkoutBtn').addEventListener('click', addOrUpdateExerciseDraft);
document.getElementById('exerciseNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addOrUpdateExerciseDraft();
  }
});

function addOrUpdateExerciseDraft() {
  const nameInput = document.getElementById('exerciseNameInput');
  const name = nameInput.value.trim();
  if (!name) return;
  const type = document.getElementById('exerciseTypeInput').value;
  const barWeight = type === 'barbell'
    ? (Number(document.getElementById('exerciseBarWeightInput').value) || DEFAULT_BAR_WEIGHT)
    : undefined;

  if (editingDraftIndex >= 0) {
    const existing = draftExercises[editingDraftIndex];
    draftExercises[editingDraftIndex] = { id: existing.id, name, type, barWeight };
  } else {
    draftExercises.push({ id: uid(), name, type, barWeight });
  }
  resetExerciseDraftForm();
  renderExerciseTagList();
  nameInput.focus();
}

function renderExerciseTagList() {
  const container = document.getElementById('exerciseTagList');
  if (draftExercises.length === 0) {
    container.innerHTML = '<span class="small-muted">No exercises added yet.</span>';
    return;
  }
  container.innerHTML = draftExercises.map((ex, i) => `
    <div class="exercise-def-row">
      <div>
        <span class="name">${escapeHtml(ex.name)}</span>
        <span class="type-badge type-${ex.type}">${TYPE_LABELS[ex.type] || 'Normal'}${ex.type === 'barbell' ? ` · bar ${barWeightOf(ex)}lb` : ''}</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="icon-btn" type="button" data-edit-draft="${i}">Edit</button>
        <button class="danger" type="button" data-remove-draft="${i}">Remove</button>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-edit-draft]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.editDraft);
      const ex = draftExercises[i];
      editingDraftIndex = i;
      document.getElementById('exerciseNameInput').value = ex.name;
      document.getElementById('exerciseTypeInput').value = ex.type;
      document.getElementById('exerciseBarWeightInput').value = ex.barWeight ?? DEFAULT_BAR_WEIGHT;
      updateBarWeightVisibility();
      document.getElementById('addExerciseToWorkoutBtn').textContent = 'Update Exercise';
    });
  });
  container.querySelectorAll('[data-remove-draft]').forEach(btn => {
    btn.addEventListener('click', () => {
      draftExercises.splice(Number(btn.dataset.removeDraft), 1);
      if (editingDraftIndex === Number(btn.dataset.removeDraft)) resetExerciseDraftForm();
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
      <div class="info">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="meta">${w.exercises.map(e => `${escapeHtml(e.name)} (${TYPE_LABELS[e.type] || 'Normal'})`).join(', ')}</div>
      </div>
      <div class="actions">
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
        'This will not delete past logs, but you will not be able to start this workout again unless you recreate it.',
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
  resetExerciseDraftForm();
  renderExerciseTagList();
  openModal('workoutModal');
}

// ---------- Start Workout flow ----------
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
      <div class="info">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="meta">${w.exercises.map(e => escapeHtml(e.name)).join(', ')}</div>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const date = document.getElementById('logDateInput').value || todayStr();
      closeModal('pickWorkoutModal');
      startSession(el.dataset.pick, date);
    });
  });
}

function startSession(workoutId, date) {
  const workout = getWorkout(workoutId);
  if (!workout) return;

  const existing = findLogByDate(date);
  if (existing && existing.workoutId !== workoutId) {
    confirmDialog(
      'Replace existing log?',
      `You already logged "${existing.workoutName}" on ${date}. Starting a different workout will replace it. Continue?`,
      () => openSessionModal(workout, date, null)
    );
    return;
  }
  openSessionModal(workout, date, existing || null);
}

// ---------- Session modal (Start Workout -> Start Exercise -> Add Set) ----------
let activeSession = null;
/* {
  date, workoutId, existingLogId,
  exStates: { [exerciseId]: { sets: [...], opened: bool } },
  timers: { [exerciseId]: { running, startTs, intervalId } },
} */

function stopAllTimers() {
  if (!activeSession) return;
  Object.values(activeSession.timers).forEach(t => {
    if (t.intervalId) clearInterval(t.intervalId);
    t.running = false;
    t.intervalId = null;
    t.startTs = null;
  });
}

function openSessionModal(workout, date, existingLog) {
  stopAllTimers();
  activeSession = {
    date, workoutId: workout.id, existingLogId: existingLog ? existingLog.id : null,
    exStates: {}, timers: {}, activeExerciseId: null,
    baseTitle: existingLog ? 'Edit Logged Workout' : 'Start Workout',
  };

  workout.exercises.forEach(ex => {
    const exLog = existingLog && existingLog.exerciseLogs.find(el => el.exerciseId === ex.id);
    const sets = exLog ? exLog.sets.map(s => ({ ...s })) : [];
    activeSession.exStates[ex.id] = { sets };
    activeSession.timers[ex.id] = { running: false, startTs: null, intervalId: null };
  });

  document.getElementById('sessionDateInput').value = date;
  document.getElementById('sessionWorkoutName').value = workout.name;
  document.getElementById('deleteSessionBtn').classList.toggle('hidden', !existingLog);

  renderSessionModal(workout);
  openModal('sessionModal');
}

function renderSessionModal(workout) {
  const container = document.getElementById('sessionExercisesContainer');
  const metaRow = document.getElementById('sessionMetaRow');
  const backBtn = document.getElementById('sessionBackBtn');
  const titleSpan = document.getElementById('sessionModalTitle');
  const actions = document.getElementById('sessionModalActions');
  container.innerHTML = '';

  const activeEx = activeSession.activeExerciseId
    ? workout.exercises.find(e => e.id === activeSession.activeExerciseId)
    : null;

  if (activeEx) {
    metaRow.classList.add('hidden');
    backBtn.classList.remove('hidden');
    actions.classList.add('hidden');
    titleSpan.textContent = activeEx.name;
    container.appendChild(renderExerciseDetail(activeEx, workout));
  } else {
    metaRow.classList.remove('hidden');
    backBtn.classList.add('hidden');
    actions.classList.remove('hidden');
    titleSpan.textContent = activeSession.baseTitle;
    container.appendChild(renderExerciseListView(workout));
  }
}

// Step 1: pick which exercise to log. Exercises with sets already logged
// this session sink to the bottom so the remaining ones stay at the top.
function renderExerciseListView(workout) {
  const wrap = document.createElement('div');
  wrap.className = 'exercise-list';

  const ordered = workout.exercises
    .map((ex, i) => ({ ex, i, done: activeSession.exStates[ex.id].sets.length > 0 }))
    .sort((a, b) => (a.done === b.done ? a.i - b.i : (a.done ? 1 : -1)));

  let dividerShown = false;
  ordered.forEach(({ ex, done }) => {
    if (done && !dividerShown) {
      dividerShown = true;
      const divider = document.createElement('div');
      divider.className = 'exercise-list-divider';
      divider.textContent = 'Completed';
      wrap.appendChild(divider);
    }

    const st = activeSession.exStates[ex.id];
    const row = document.createElement('div');
    row.className = `exercise-list-row type-${ex.type}${done ? ' is-done' : ''}`;
    row.innerHTML = `
      <div class="row-main">
        <div class="status-dot">✓</div>
        <div>
          <div class="name">${escapeHtml(ex.name)} <span class="type-badge type-${ex.type}">${TYPE_LABELS[ex.type] || 'Normal'}</span></div>
          <div class="status${done ? ' done' : ''}">${done ? `✓ ${st.sets.length} set${st.sets.length > 1 ? 's' : ''} logged` : 'Not started'}</div>
        </div>
      </div>
      <div class="chevron">›</div>
    `;
    row.addEventListener('click', () => {
      activeSession.activeExerciseId = ex.id;
      renderSessionModal(workout);
    });
    wrap.appendChild(row);
  });

  return wrap;
}

// Step 2: a single exercise filling the whole modal — recent history,
// already-logged sets as removable chips, and a guided add-set flow.
function renderExerciseDetail(ex, workout) {
  const st = activeSession.exStates[ex.id];
  const wrap = document.createElement('div');
  wrap.className = `exercise-detail type-${ex.type}`;

  function refresh() {
    wrap.innerHTML = '';
    renderBody();
  }

  function renderBody() {
    const history = getExerciseHistory(ex.id, activeSession.date, activeSession.existingLogId);

    const histDiv = document.createElement('div');
    histDiv.className = 'history-block';
    if (history.length === 0) {
      histDiv.innerHTML = '<div class="label">Recent</div><div class="small-muted">No previous history for this exercise yet.</div>';
    } else {
      const days = history.map(h => `
        <div class="history-day">
          <div class="history-day-header">
            <span class="history-day-date">${escapeHtml(formatDateDisplay(h.date))}</span>
            <span class="history-day-count">${h.sets.length} set${h.sets.length > 1 ? 's' : ''}</span>
          </div>
          <div class="history-set-list">
            ${h.sets.map((s, i) => `<span class="history-set-pill"><span class="idx">${i + 1}</span>${escapeHtml(formatSetSummary(ex, s))}</span>`).join('')}
          </div>
        </div>
      `).join('');
      const trendVals = [...history].reverse().map(h => trendMetric(ex.type, h.sets));
      histDiv.innerHTML = `
        <div class="label">Recent</div>
        ${days}
        ${trendVals.length > 1 ? `<div class="trend-line">Trend: ${trendVals.map(escapeHtml).join(' → ')}</div>` : ''}
      `;
    }
    wrap.appendChild(histDiv);

    if (st.sets.length > 0) {
      const chipList = document.createElement('div');
      chipList.className = 'set-chip-list';
      st.sets.forEach((set, i) => {
        const chip = document.createElement('span');
        chip.className = 'set-chip';
        chip.innerHTML = `${escapeHtml(`${i + 1}. ${formatSetSummary(ex, set)}`)} <button type="button" class="set-chip-remove" title="Remove set">✕</button>`;
        chip.querySelector('.set-chip-remove').addEventListener('click', () => {
          st.sets.splice(i, 1);
          refresh();
        });
        chipList.appendChild(chip);
      });
      wrap.appendChild(chipList);
    }

    const addArea = document.createElement('div');
    addArea.className = 'add-set-area';
    wrap.appendChild(addArea);

    function showAddButton() {
      addArea.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary add-set-btn-big';
      btn.textContent = '+ Add Set';
      btn.addEventListener('click', () => {
        if (ex.type === 'timed') showTimedWizard();
        else showStandardWizard();
      });
      addArea.appendChild(btn);
    }

    function showStandardWizard() {
      const lastSet = lastSetFor(st, history);
      const decomposed = lastSet ? decomposeSet(ex, lastSet) : {};
      let repsVal = decomposed.reps ?? '';

      function stepReps() {
        addArea.innerHTML = '';
        const step = document.createElement('div');
        step.className = 'wizard-step';
        step.innerHTML = `
          <div class="wizard-label">Reps</div>
          <input type="number" inputmode="numeric" class="wizard-input wiz-reps" min="0" value="${repsVal}">
        `;
        const actions = document.createElement('div');
        actions.className = 'wizard-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button'; cancelBtn.className = 'secondary'; cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', showAddButton);
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.className = 'primary';
        nextBtn.textContent = ex.type === 'bodyweight' ? 'Add Set' : 'Next';
        actions.appendChild(cancelBtn);
        actions.appendChild(nextBtn);
        step.appendChild(actions);
        addArea.appendChild(step);

        const input = step.querySelector('.wiz-reps');
        input.focus();
        input.select();

        function proceed() {
          repsVal = input.value;
          if (ex.type === 'bodyweight') {
            st.sets.push(composeSet(ex, { reps: repsVal }));
            refresh();
          } else {
            stepExtra();
          }
        }
        nextBtn.addEventListener('click', proceed);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); proceed(); } });
      }

      function stepExtra() {
        addArea.innerHTML = '';
        const label = ex.type === 'barbell' ? 'Plates/side' : ex.type === 'dumbbell' ? 'Weight/DB' : 'Weight';
        const extraKey = ex.type === 'barbell' ? 'perSide' : ex.type === 'dumbbell' ? 'perDb' : 'weight';
        const extraVal = decomposed[extraKey] ?? '';
        const step = document.createElement('div');
        step.className = 'wizard-step';
        step.innerHTML = `
          <div class="wizard-label">${label}</div>
          <input type="number" inputmode="decimal" class="wizard-input wiz-extra" min="0" step="any" value="${extraVal}">
          ${ex.type !== 'normal' ? '<div class="wizard-total"></div>' : ''}
        `;
        const actions = document.createElement('div');
        actions.className = 'wizard-actions';
        const backBtn2 = document.createElement('button');
        backBtn2.type = 'button'; backBtn2.className = 'secondary'; backBtn2.textContent = 'Back';
        backBtn2.addEventListener('click', stepReps);
        const addBtn2 = document.createElement('button');
        addBtn2.type = 'button'; addBtn2.className = 'primary'; addBtn2.textContent = 'Add Set';
        actions.appendChild(backBtn2);
        actions.appendChild(addBtn2);
        step.appendChild(actions);
        addArea.appendChild(step);

        const input = step.querySelector('.wiz-extra');
        const totalDisplay = step.querySelector('.wizard-total');
        function updateTotal() {
          if (!totalDisplay) return;
          const v = Number(input.value) || 0;
          const total = ex.type === 'barbell' ? v * 2 + barWeightOf(ex) : v * 2;
          totalDisplay.textContent = `Total: ${roundTo(total)} lb`;
        }
        updateTotal();
        input.addEventListener('input', updateTotal);
        input.focus();
        input.select();

        function proceed() {
          const vals = { reps: repsVal };
          vals[extraKey] = input.value;
          st.sets.push(composeSet(ex, vals));
          refresh();
        }
        addBtn2.addEventListener('click', proceed);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); proceed(); } });
      }

      stepReps();
    }

    function showTimedWizard() {
      addArea.innerHTML = '';
      const timer = activeSession.timers[ex.id];
      const lastSet = lastSetFor(st, history);
      const decomposed = lastSet ? decomposeSet(ex, lastSet) : {};
      const step = document.createElement('div');
      step.className = 'wizard-step';
      step.innerHTML = `
        <div class="wizard-label">Timer</div>
        <div class="timer-display-big">0:00</div>
        <div class="wizard-actions">
          <button type="button" class="secondary start-timer-btn">Start</button>
          <button type="button" class="primary stop-timer-btn hidden">Stop &amp; Add</button>
        </div>
        <div class="wizard-label" style="margin-top:18px;">Or enter seconds manually</div>
        <input type="number" inputmode="numeric" class="wizard-input wiz-seconds" min="0" value="${decomposed.seconds ?? ''}">
        <div class="wizard-actions">
          <button type="button" class="secondary cancel-wizard-btn">Cancel</button>
          <button type="button" class="primary add-seconds-btn">Add Set</button>
        </div>
      `;
      addArea.appendChild(step);

      const display = step.querySelector('.timer-display-big');
      const startBtn = step.querySelector('.start-timer-btn');
      const stopBtn = step.querySelector('.stop-timer-btn');
      const secondsInput = step.querySelector('.wiz-seconds');
      const cancelBtn = step.querySelector('.cancel-wizard-btn');
      const addSecondsBtn = step.querySelector('.add-seconds-btn');

      if (timer.running) {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
      }

      startBtn.addEventListener('click', () => {
        timer.running = true;
        timer.startTs = Date.now();
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        timer.intervalId = setInterval(() => {
          display.textContent = formatSeconds((Date.now() - timer.startTs) / 1000);
        }, 250);
      });

      stopBtn.addEventListener('click', () => {
        const elapsed = Math.round((Date.now() - timer.startTs) / 1000);
        clearInterval(timer.intervalId);
        timer.running = false;
        timer.intervalId = null;
        timer.startTs = null;
        st.sets.push({ seconds: elapsed });
        refresh();
      });

      cancelBtn.addEventListener('click', showAddButton);

      addSecondsBtn.addEventListener('click', () => {
        st.sets.push(composeSet(ex, { seconds: secondsInput.value }));
        refresh();
      });
    }

    showAddButton();
  }

  renderBody();
  return wrap;
}

document.getElementById('sessionBackBtn').addEventListener('click', () => {
  if (!activeSession) return;
  const timer = activeSession.timers[activeSession.activeExerciseId];
  if (timer && timer.running) {
    alert('Stop the timer for this exercise before going back.');
    return;
  }
  activeSession.activeExerciseId = null;
  renderSessionModal(getWorkout(activeSession.workoutId));
});

document.getElementById('cancelSessionBtn').addEventListener('click', () => {
  stopAllTimers();
  closeModal('sessionModal');
});

document.getElementById('saveSessionBtn').addEventListener('click', () => {
  if (!activeSession) return;
  const date = document.getElementById('sessionDateInput').value;
  if (!date) { alert('Please choose a date.'); return; }
  const workout = getWorkout(activeSession.workoutId);
  if (!workout) return;

  const collidingLog = findLogByDate(date);
  if (collidingLog && collidingLog.id !== activeSession.existingLogId) {
    alert(`A workout is already logged on ${date}. Delete or edit that entry first, or pick a different date.`);
    return;
  }

  for (const ex of workout.exercises) {
    if (activeSession.timers[ex.id].running) {
      alert(`Stop the timer for "${ex.name}" before saving.`);
      return;
    }
  }

  const exerciseLogs = workout.exercises.map(ex => ({
    exerciseId: ex.id,
    name: ex.name,
    sets: activeSession.exStates[ex.id].sets.map(s => ({ ...s })),
  }));

  if (activeSession.existingLogId) {
    const log = state.logs.find(l => l.id === activeSession.existingLogId);
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
  stopAllTimers();
  closeModal('sessionModal');
  renderCalendar();
  renderHistoryList();
});

document.getElementById('deleteSessionBtn').addEventListener('click', () => {
  if (!activeSession || !activeSession.existingLogId) return;
  confirmDialog('Delete this log?', 'This cannot be undone.', () => {
    state.logs = state.logs.filter(l => l.id !== activeSession.existingLogId);
    saveData();
    stopAllTimers();
    closeModal('sessionModal');
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
      openSessionModal(workout, dateStr, existing);
    } else {
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
    const workout = getWorkout(log.workoutId);
    const summary = log.exerciseLogs.map(el => {
      const exDef = workout && workout.exercises.find(e => e.id === el.exerciseId);
      const setsStr = el.sets.map(s => formatSetSummary(exDef || { type: 'normal' }, s)).join(', ');
      return `${escapeHtml(el.name)} (${setsStr || 'no sets'})`;
    }).join(' • ');
    return `
      <div class="list-item">
        <div class="info">
          <div class="name">${log.date} — ${escapeHtml(log.workoutName)}</div>
          <div class="meta">${summary}</div>
        </div>
        <div class="actions">
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
      openSessionModal(workout, log.date, log);
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
          state = migrateState({ workouts: parsed.workouts, logs: parsed.logs });
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
