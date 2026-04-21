(() => {
  "use strict";

  const API = window.location.origin;
  let selectedTasks = new Set();
  let allTasks = [];

  // ---- DOM refs ----
  const $equipName    = document.getElementById("equipmentName");
  const $taskItems    = document.getElementById("taskItems");
  const $form         = document.getElementById("completeForm");
  const $summary      = document.getElementById("selectedSummary");
  const $userSelect   = document.getElementById("userSelect");
  const $notes        = document.getElementById("notesInput");
  const $submitBtn    = document.getElementById("submitBtn");
  const $refreshBtn   = document.getElementById("refreshBtn");
  const $banner       = document.getElementById("statusBanner");

  // ---- Init ----
  async function init() {
    await loadConfig();
    await loadTasks();
    $refreshBtn.addEventListener("click", loadTasks);
    $submitBtn.addEventListener("click", submitCompletion);
    $userSelect.addEventListener("change", validateForm);
  }

  // ---- Load config (users, equipment name) ----
  async function loadConfig() {
    try {
      const res = await fetch(`${API}/api/config`);
      const data = await res.json();
      $equipName.textContent = data.equipment_name || "Maintenance Tracker";
      document.title = data.equipment_name + " — Maintenance";

      $userSelect.innerHTML = '<option value="">— Select —</option>';
      (data.users || []).forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        $userSelect.appendChild(opt);
      });
    } catch (e) {
      console.error("Failed to load config", e);
    }
  }

  // ---- Load tasks ----
  async function loadTasks() {
    $taskItems.innerHTML = '<p class="loading">Loading tasks&hellip;</p>';
    selectedTasks.clear();
    updateFormVisibility();

    try {
      const res = await fetch(`${API}/api/tasks`);
      const data = await res.json();

      if (data.error) {
        $taskItems.innerHTML = `<p class="loading">Error: ${data.error}</p>`;
        return;
      }

      allTasks = data.tasks || [];

      if (allTasks.length === 0) {
        $taskItems.innerHTML = '<p class="loading">No tasks configured yet. Add tasks to the Google Sheet.</p>';
        return;
      }

      // Sort: overdue first, then by next due date
      allTasks.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return (a.next_due || "").localeCompare(b.next_due || "");
      });

      renderTasks();
    } catch (e) {
      console.error("Failed to load tasks", e);
      $taskItems.innerHTML = '<p class="loading">Could not connect to server.</p>';
    }
  }

  // ---- Render task list ----
  function renderTasks() {
    $taskItems.innerHTML = "";
    allTasks.forEach(task => {
      const row = document.createElement("div");
      row.className = "task-row" + (task.overdue ? " overdue" : "");
      if (selectedTasks.has(task.task)) row.classList.add("selected");

      row.innerHTML = `
        <div class="task-check"></div>
        <div class="task-info">
          <div class="task-name"><span class="task-id">${esc(task.id)}</span> ${esc(task.task)}</div>
          <div class="task-desc">${esc(task.description)}</div>
          <div class="task-meta">
            Due: ${esc(task.next_due)} · Last: ${esc(task.last_completed)}
            ${task.completed_by ? " by " + esc(task.completed_by) : ""}
          </div>
        </div>
        <span class="task-badge ${task.overdue ? "badge-overdue" : "badge-ok"}">
          ${task.overdue ? "Overdue" : "OK"}
        </span>
      `;

      row.addEventListener("click", () => toggleTask(task.task, row));
      $taskItems.appendChild(row);
    });
  }

  // ---- Toggle task selection ----
  function toggleTask(name, row) {
    if (selectedTasks.has(name)) {
      selectedTasks.delete(name);
      row.classList.remove("selected");
    } else {
      selectedTasks.add(name);
      row.classList.add("selected");
    }
    updateFormVisibility();
    validateForm();
  }

  function updateFormVisibility() {
    if (selectedTasks.size > 0) {
      $form.classList.remove("hidden");
      $summary.textContent = `${selectedTasks.size} task${selectedTasks.size > 1 ? "s" : ""} selected: ${[...selectedTasks].join(", ")}`;
    } else {
      $form.classList.add("hidden");
    }
  }

  function validateForm() {
    $submitBtn.disabled = !(selectedTasks.size > 0 && $userSelect.value);
  }

  // ---- Submit completion ----
  async function submitCompletion() {
    $submitBtn.disabled = true;
    $submitBtn.textContent = "Submitting…";

    try {
      const res = await fetch(`${API}/api/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed_by: $userSelect.value,
          tasks: [...selectedTasks],
          notes: $notes.value.trim(),
        }),
      });
      const data = await res.json();

      if (data.error) {
        showBanner(data.error, "error");
      } else {
        showBanner(`Done! ${data.completed.length} task${data.completed.length > 1 ? "s" : ""} completed.`, "success");
        $notes.value = "";
        await loadTasks();
      }
    } catch (e) {
      console.error("Submit failed", e);
      showBanner("Network error — please try again.", "error");
    }

    $submitBtn.textContent = "Submit";
    validateForm();
  }

  // ---- Banner ----
  let bannerTimer;
  function showBanner(msg, type) {
    clearTimeout(bannerTimer);
    $banner.textContent = msg;
    $banner.className = "status-banner " + type;
    $banner.classList.remove("hidden");
    bannerTimer = setTimeout(() => $banner.classList.add("hidden"), 4000);
  }

  // ---- Escape HTML ----
  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  // ---- Go ----
  init();
})();
