"use strict";

/* =====================================================
   ZeroDay
   Activities (recurring, reset daily) + To-Dos (carry over)
   Vanilla JS + localStorage + PWA
   ===================================================== */

/* ---------- CONSTANTS ---------- */
const KEYS = {
  activities: "activities",
  todos: "todos",
  lastDate: "lastDate",
  legacy: "items" // single-list key used by the earlier version
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPES = ["daily", "alternate", "specific"];

const OUTER_C = 2 * Math.PI * 54; // activity ring circumference
const INNER_C = 2 * Math.PI * 40; // to-do ring circumference

const OPEN_X = 80;            // where a row rests when Delete is revealed
const OPEN_TRIGGER = 60;      // drag right past this to reveal Delete
const COMPLETE_TRIGGER = 80;  // drag left past this to complete / undo
const MAX_DRAG = 140;         // rubber-band starts here

/* ---------- ELEMENTS ---------- */
const $ = (id) => document.getElementById(id);

const activityList = $("activityList");
const todoList = $("todoList");
const activityRing = $("activityRing");
const todoRing = $("todoRing");
const progressText = $("progressText");
const progressWrapper = $("progressWrapper");
const legendActivity = $("legendActivity");
const legendTodo = $("legendTodo");
const todoCount = $("todoCount");

const activityModal = $("activityModal");
const todoModal = $("todoModal");
const activityInput = $("activityInput");
const todoInput = $("todoInput");
const typeSelect = $("type");
const daysDiv = $("days");

const tabActivity = $("tabActivity");
const tabTodo = $("tabTodo");
const activityView = $("activityView");
const todoView = $("todoView");

/* ---------- DATE HELPERS ---------- */
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Whole-day number from a YYYY-MM-DD key (UTC math avoids DST drift)
function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function makeToday(d = new Date()) {
  const key = dateKey(d);
  return { key, weekday: d.getDay(), num: dayNumber(key) };
}

let today = makeToday();

/* ---------- STORAGE HELPERS ---------- */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("ZeroDay: could not save", key, e);
  }
}

function uid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const isDateKey = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* ---------- DATA MODEL ----------
   Activity: { id, text, type, days[], startDate, doneOn }
     doneOn === today's key  ->  completed today (resets automatically at midnight)
   To-Do:    { id, text, done, doneOn }
     stays until completed; completed ones disappear the day after
---------------------------------- */
function normalizeActivity(a) {
  if (!a || typeof a.text !== "string" || !a.text.trim()) return null;
  const days = Array.isArray(a.days)
    ? [...new Set(a.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : [];
  return {
    id: typeof a.id === "string" ? a.id : uid(),
    text: a.text.trim(),
    type: TYPES.includes(a.type) ? a.type : "daily",
    days,
    startDate: isDateKey(a.startDate) ? a.startDate : today.key,
    doneOn: isDateKey(a.doneOn) ? a.doneOn : null
  };
}

function normalizeTodo(t) {
  if (!t || typeof t.text !== "string" || !t.text.trim()) return null;
  const done = t.done === true;
  return {
    id: typeof t.id === "string" ? t.id : uid(),
    text: t.text.trim(),
    done,
    doneOn: done ? (isDateKey(t.doneOn) ? t.doneOn : today.key) : null
  };
}

function loadActivities() {
  const stored = readJSON(KEYS.activities, null);
  if (Array.isArray(stored)) return stored.map(normalizeActivity).filter(Boolean);

  // One-time migration from the old single "items" list
  const legacy = readJSON(KEYS.legacy, null);
  if (Array.isArray(legacy)) {
    const wasToday = localStorage.getItem(KEYS.lastDate) === new Date().toDateString();
    const migrated = legacy
      .map((i) =>
        normalizeActivity({
          text: i && i.text,
          type: i && i.type,
          days: i && i.days,
          doneOn: i && i.done && wasToday ? today.key : null
        })
      )
      .filter(Boolean);
    writeJSON(KEYS.activities, migrated);
    return migrated;
  }
  return [];
}

function loadTodos() {
  const stored = readJSON(KEYS.todos, []);
  return Array.isArray(stored) ? stored.map(normalizeTodo).filter(Boolean) : [];
}

let activities = loadActivities();
let todos = loadTodos();

function pruneTodos() {
  const before = todos.length;
  todos = todos.filter((t) => !t.done || t.doneOn === today.key);
  return todos.length !== before;
}

function persist() {
  writeJSON(KEYS.activities, activities);
  writeJSON(KEYS.todos, todos);
}

/* ---------- SCHEDULING ---------- */
function shouldShow(a) {
  if (a.type === "daily") return true;
  if (a.type === "alternate") {
    const diff = today.num - dayNumber(a.startDate);
    return ((diff % 2) + 2) % 2 === 0; // start day, then every 2nd day
  }
  if (a.type === "specific") return a.days.includes(today.weekday);
  return true;
}

function scheduleLabel(a) {
  if (a.type === "alternate") return "Alternate days";
  if (a.type === "specific") {
    return [...a.days].sort((x, y) => x - y).map((d) => DAY_NAMES[d]).join(" · ");
  }
  return "Daily";
}

const isActivityDone = (a) => a.doneOn === today.key;

/* ---------- HAPTICS ---------- */
function vibrate(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------- SMALL UI HELPERS ---------- */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function shake(node) {
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
  vibrate(25);
}

let toastTimer = null;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function pulse(ring) {
  ring.classList.remove("pulse");
  void ring.getBoundingClientRect();
  ring.classList.add("pulse");
}

[activityRing, todoRing].forEach((r) =>
  r.addEventListener("animationend", () => r.classList.remove("pulse"))
);

/* ---------- DATE HEADER ---------- */
function renderDate() {
  $("date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short"
  });
}

/* ---------- RENDER SCHEDULING ---------- */
let renderTimer = null;
let dragging = false;

// Delayed render so completion animations can play; waits if a swipe is in progress
function scheduleRender(ms) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(function tick() {
    if (dragging) {
      renderTimer = setTimeout(tick, 120);
      return;
    }
    render();
  }, ms);
}

/* ---------- SWIPE ---------- */
let openSwipe = null;

// Tapping anywhere outside a revealed row closes it
document.addEventListener(
  "touchstart",
  (e) => {
    if (openSwipe && !openSwipe.wrapper.contains(e.target)) openSwipe.close();
  },
  { passive: true }
);

function rubber(v) {
  if (v > MAX_DRAG) return MAX_DRAG + (v - MAX_DRAG) * 0.25;
  if (v < -MAX_DRAG) return -MAX_DRAG + (v + MAX_DRAG) * 0.25;
  return v;
}

/*
  Swipe right  -> reveals Delete (tap it to confirm)
  Swipe left   -> completes (or un-completes) the row
*/
function attachSwipe(parts, actions) {
  const { wrapper, row, deleteBg, doneBg } = parts;

  let startX = 0;
  let startY = 0;
  let base = 0;
  let x = 0;
  let axis = null;
  let tracking = false;
  let settleTimer = null;

  const swipe = {
    open: false,
    wrapper,
    close() {
      settle(0);
      swipe.open = false;
      if (openSwipe === swipe) openSwipe = null;
    }
  };

  function paint(v) {
    x = v;
    row.style.setProperty("--tx", v + "px");
    deleteBg.style.opacity = v > 4 ? Math.min(1, v / 48) : 0;
    doneBg.style.opacity = v < -4 ? Math.min(1, -v / 48) : 0;
  }

  // Spring to a resting position
  function settle(v) {
    row.classList.remove("dragging");
    clearTimeout(settleTimer);
    row.style.transition = "transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)";
    paint(v);
    settleTimer = setTimeout(() => {
      row.style.transition = "";
    }, 400);
  }

  row.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      base = swipe.open ? OPEN_X : 0;
      axis = null;
      tracking = true;
      clearTimeout(settleTimer);
      row.style.transition = "none";
    },
    { passive: true }
  );

  row.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;

      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
        if (axis === "x") {
          dragging = true;
          row.classList.add("dragging");
        } else {
          // vertical scroll: leave it to the browser
          tracking = false;
          row.style.transition = "";
          return;
        }
      }

      paint(rubber(base + mx));
    },
    { passive: true }
  );

  function finish() {
    if (!tracking) return;
    tracking = false;

    if (axis !== "x") {
      row.style.transition = "";
      return;
    }

    dragging = false;

    if (x <= -COMPLETE_TRIGGER) {
      swipe.open = false;
      if (openSwipe === swipe) openSwipe = null;
      settle(0);
      actions.toggle();
    } else if (x >= OPEN_TRIGGER) {
      settle(OPEN_X);
      if (!swipe.open) vibrate(20);
      swipe.open = true;
      openSwipe = swipe;
    } else {
      swipe.close();
    }
  }

  row.addEventListener("touchend", finish);
  row.addEventListener("touchcancel", finish);

  // A tap on a revealed row just closes it (no accidental toggle)
  row.addEventListener(
    "click",
    (e) => {
      if (swipe.open) {
        e.preventDefault();
        e.stopPropagation();
        swipe.close();
      }
    },
    true
  );

  deleteBg.addEventListener("click", () => {
    if (openSwipe === swipe) openSwipe = null;
    actions.remove();
  });
}

/* ---------- ROW BUILDER ---------- */
function buildRow(entry, kind) {
  const isActivity = kind === "activity";
  const isDone = () => (isActivity ? isActivityDone(entry) : entry.done === true);

  const wrapper = el("div", "item-wrapper " + kind);
  const doneBg = el("div", "done-bg", isDone() ? "Undo" : "Done");
  const deleteBg = el("button", "delete-bg", "Delete");
  deleteBg.type = "button";

  const row = el("div", "item" + (isDone() ? " completed" : ""));

  const box = el("input", "check");
  box.type = "checkbox";
  box.checked = isDone();
  box.setAttribute("aria-label", "Complete " + entry.text);

  const body = el("div", "item-body");
  body.appendChild(el("span", "label", entry.text));
  if (isActivity) body.appendChild(el("span", "meta", scheduleLabel(entry)));

  row.append(box, body);
  wrapper.append(doneBg, deleteBg, row);

  function setDone(value) {
    if (isActivity) {
      entry.doneOn = value ? today.key : null;
    } else {
      entry.done = value;
      entry.doneOn = value ? today.key : null;
    }

    box.checked = value;
    row.classList.toggle("completed", value);
    doneBg.textContent = value ? "Undo" : "Done";

    persist();
    updateRings();

    if (value) {
      vibrate(15);
      row.classList.remove("success");
      void row.offsetWidth;
      row.classList.add("success");
      pulse(isActivity ? activityRing : todoRing);
    } else {
      vibrate(8);
    }

    scheduleRender(value ? 320 : 150);
  }

  function remove() {
    vibrate(30);

    // Remove by id (not by list position), so hidden items are never affected
    if (isActivity) {
      activities = activities.filter((a) => a.id !== entry.id);
    } else {
      todos = todos.filter((t) => t.id !== entry.id);
    }
    persist();
    updateRings();

    // Slide out, then collapse
    row.style.transition = "transform 0.22s ease, opacity 0.22s ease";
    row.style.setProperty("--tx", "110%");
    row.style.opacity = "0";

    const h = wrapper.offsetHeight;
    wrapper.style.height = h + "px";
    wrapper.style.transition = "height 0.22s ease 0.1s, margin 0.22s ease 0.1s, opacity 0.22s ease 0.1s";
    void wrapper.offsetHeight;
    wrapper.style.height = "0px";
    wrapper.style.marginTop = "0px";
    wrapper.style.opacity = "0";

    scheduleRender(380);
  }

  box.addEventListener("change", () => setDone(box.checked));

  attachSwipe(
    { wrapper, row, deleteBg, doneBg },
    {
      toggle: () => setDone(!isDone()),
      remove
    }
  );

  return wrapper;
}

/* ---------- RENDER ---------- */
function renderEmpty(container, message) {
  container.appendChild(el("p", "empty", message));
}

function render() {
  openSwipe = null;
  activityList.innerHTML = "";
  todoList.innerHTML = "";

  const todayActivities = activities.filter(shouldShow);

  if (!todayActivities.length) {
    renderEmpty(
      activityList,
      activities.length ? "Nothing scheduled today." : "No activities yet.\nTap + to add one."
    );
  } else {
    todayActivities.forEach((a) => activityList.appendChild(buildRow(a, "activity")));
  }

  if (!todos.length) {
    renderEmpty(todoList, "All clear.\nTap + to add a To-Do.");
  } else {
    todos.forEach((t) => todoList.appendChild(buildRow(t, "todo")));
  }

  updateRings();
}

/* ---------- PROGRESS ---------- */
let ringsReady = false; // lets the rings animate in on first load

function setRing(ring, circumference, ratio) {
  ring.style.strokeDashoffset = circumference * (1 - ratio);
  ring.style.opacity = ratio > 0 ? "1" : "0";
}

function updateRings() {
  const todayActivities = activities.filter(shouldShow);
  const actDone = todayActivities.filter(isActivityDone).length;
  const todoDone = todos.filter((t) => t.done).length;

  const actRatio = todayActivities.length ? actDone / todayActivities.length : 0;
  const todoRatio = todos.length ? todoDone / todos.length : 0;

  progressText.textContent = Math.round(actRatio * 100) + "%";
  legendActivity.textContent = `Activities ${actDone}/${todayActivities.length}`;
  legendTodo.textContent = `To-Dos ${todoDone}/${todos.length}`;
  todoCount.textContent = todos.length ? `${todoDone} of ${todos.length} done` : "";

  progressWrapper.setAttribute(
    "aria-label",
    `${actDone} of ${todayActivities.length} activities and ${todoDone} of ${todos.length} to-dos complete`
  );

  if (ringsReady) {
    setRing(activityRing, OUTER_C, actRatio);
    setRing(todoRing, INNER_C, todoRatio);
  }
}

/* ---------- TABS ---------- */
let activeTab = "activity";

function setTab(name) {
  if (name === activeTab) return;
  activeTab = name;
  if (openSwipe) openSwipe.close();

  const isActivity = name === "activity";
  activityView.classList.toggle("active", isActivity);
  todoView.classList.toggle("active", !isActivity);
  tabActivity.classList.toggle("active", isActivity);
  tabTodo.classList.toggle("active", !isActivity);
  tabActivity.setAttribute("aria-selected", String(isActivity));
  tabTodo.setAttribute("aria-selected", String(!isActivity));

  vibrate(8);
  window.scrollTo(0, 0);
}

tabActivity.addEventListener("click", () => setTab("activity"));
tabTodo.addEventListener("click", () => setTab("todo"));

/* ---------- MODALS ---------- */
function resetForms() {
  activityInput.value = "";
  todoInput.value = "";
  typeSelect.value = "daily";
  daysDiv.classList.add("hidden");
  daysDiv.querySelectorAll("input").forEach((cb) => (cb.checked = false));
}

function openModal(modal, focusEl) {
  if (openSwipe) openSwipe.close();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  vibrate(10);
  setTimeout(() => {
    if (modal.classList.contains("active") && focusEl) focusEl.focus({ preventScroll: true });
  }, 180);
}

function closeModal(modal) {
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  if (document.activeElement && modal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  setTimeout(() => {
    if (!activityModal.classList.contains("active") && !todoModal.classList.contains("active")) {
      resetForms();
    }
  }, 300);
}

$("addActivityBtn").addEventListener("click", () => openModal(activityModal, activityInput));
$("addTodoBtn").addEventListener("click", () => openModal(todoModal, todoInput));

document.querySelectorAll("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => closeModal(btn.closest(".modal")))
);

[activityModal, todoModal].forEach((modal) =>
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal(modal);
  })
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    [activityModal, todoModal].forEach((m) => {
      if (m.classList.contains("active")) closeModal(m);
    });
  }
});

/* Schedule type -> show/hide weekday picker */
typeSelect.addEventListener("change", () => {
  daysDiv.classList.toggle("hidden", typeSelect.value !== "specific");
});

/* ---------- ADD ACTIVITY ---------- */
function saveActivity() {
  const text = activityInput.value.trim();
  if (!text) {
    shake(activityInput);
    activityInput.focus();
    return;
  }

  const type = typeSelect.value;
  let days = [];

  if (type === "specific") {
    days = [...daysDiv.querySelectorAll("input:checked")].map((cb) => parseInt(cb.value, 10));
    if (!days.length) {
      shake(daysDiv);
      return;
    }
  }

  const activity = { id: uid(), text, type, days, startDate: today.key, doneOn: null };
  activities.push(activity);
  persist();
  closeModal(activityModal);
  render();

  if (!shouldShow(activity)) toast("Added. Not scheduled for today.");
  else if (activeTab !== "activity") toast("Activity added");
}

$("saveActivity").addEventListener("click", saveActivity);
activityInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveActivity();
  }
});

/* ---------- ADD TODO ---------- */
function saveTodo() {
  const text = todoInput.value.trim();
  if (!text) {
    shake(todoInput);
    todoInput.focus();
    return;
  }

  todos.push({ id: uid(), text, done: false, doneOn: null });
  persist();
  closeModal(todoModal);
  render();

  if (activeTab !== "todo") toast("To-Do added");
}

$("saveTodo").addEventListener("click", saveTodo);
todoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveTodo();
  }
});

/* ---------- NEW DAY HANDLING ----------
   Activity completion resets on its own (doneOn no longer equals today).
   This just refreshes the UI if the app stays open past midnight. */
function syncDay() {
  if (dateKey() === today.key) return;
  today = makeToday();
  localStorage.setItem(KEYS.lastDate, today.key);
  pruneTodos();
  persist();
  renderDate();
  scheduleRender(0);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncDay();
});
window.addEventListener("pageshow", syncDay);
window.addEventListener("focus", syncDay);
setInterval(syncDay, 60000);

/* ---------- INIT ---------- */
renderDate();
pruneTodos();
persist();
localStorage.setItem(KEYS.lastDate, today.key);
render();

// Let the rings animate in from empty
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    ringsReady = true;
    updateRings();
  })
);

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("ZeroDay: service worker registration failed", err);
    });
  });
}
