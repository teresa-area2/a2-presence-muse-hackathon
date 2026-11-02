/**
 * Task-brief card for the local two-terminal Muse comparison UI.
 *
 * Read-only explainer: describes the real coding task before the user
 * starts. It never starts sessions, never submits input, and never issues
 * network calls (no fetch / XHR / WebSocket / form submission).
 */

const UNAVAILABLE_MESSAGE = "Task unavailable";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return false;
  if (!isNonEmptyString(task.title)) return false;
  if (!isNonEmptyString(task.description)) return false;
  if (!Array.isArray(task.nextSteps) || task.nextSteps.length === 0) return false;
  return task.nextSteps.every((step) => typeof step === "string" && step.trim().length > 0);
}

function getDocument(container) {
  if (container && container.ownerDocument && typeof container.ownerDocument.createElement === "function") {
    return container.ownerDocument;
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    return document;
  }
  return null;
}

function clear(container) {
  // Use only DOM removal, never innerHTML.
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function renderUnavailable(container, doc) {
  clear(container);
  const note = doc.createElement("p");
  note.className = "task-card task-card--unavailable";
  note.setAttribute("role", "status");
  note.textContent = UNAVAILABLE_MESSAGE;
  container.appendChild(note);
}

/**
 * Render a compact, accessible task brief into `container`.
 *
 * All user-supplied values are assigned via `textContent` only, so markup
 * in the input is displayed as literal text and never parsed as HTML.
 *
 * @param {Element} container - DOM element that receives the card.
 * @param {{ title: string, description: string, nextSteps: string[] }} task
 */
export function renderTaskCard(container, task) {
  const doc = getDocument(container);
  if (!container || typeof container.appendChild !== "function" || !doc) {
    return;
  }
  if (!isValidTask(task)) {
    renderUnavailable(container, doc);
    return;
  }

  clear(container);

  const card = doc.createElement("article");
  card.className = "task-card";
  card.setAttribute("aria-labelledby", "task-card-title");

  const title = doc.createElement("h2");
  title.className = "task-card__title";
  title.id = "task-card-title";
  title.textContent = task.title.trim();

  const description = doc.createElement("p");
  description.className = "task-card__description";
  description.textContent = task.description.trim();

  const stepsTitle = doc.createElement("h3");
  stepsTitle.className = "task-card__steps-title";
  stepsTitle.id = "task-card-steps";
  stepsTitle.textContent = "Next steps";

  const list = doc.createElement("ol");
  list.className = "task-card__steps";
  list.setAttribute("aria-labelledby", "task-card-steps");

  for (const step of task.nextSteps) {
    const item = doc.createElement("li");
    item.className = "task-card__step";
    item.textContent = step.trim();
    list.appendChild(item);
  }

  card.appendChild(title);
  card.appendChild(description);
  card.appendChild(stepsTitle);
  card.appendChild(list);
  container.appendChild(card);
}
