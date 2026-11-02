import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTaskCard } from "../web/terminal-task-card.mjs";

// Minimal DOM fakes: no dependencies, no network, no real browser.
class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.text = String(text);
  }
  get textContent() {
    return this.text;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.className = "";
    this.id = "";
    this._text = "";
    this.parentNode = null;
  }
  get nodeType() {
    return 1;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this._text;
  }
  set textContent(value) {
    // Mirrors real DOM: assigning text clears child nodes.
    this._text = String(value);
    this.children = [];
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("child not found");
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    const found = [];
    const wantClass = selector.startsWith(".") ? selector.slice(1) : null;
    const wantTag = wantClass ? null : selector.toUpperCase();
    const visit = (node) => {
      if (!(node instanceof FakeElement)) return;
      const classMatch =
        wantClass != null && node.className.split(/\s+/).includes(wantClass);
      const tagMatch = wantTag != null && node.tagName === wantTag;
      if (classMatch || tagMatch) found.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
  createTextNode(text) {
    return new FakeText(text);
  }
}

function makeContainer() {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  return { doc, container };
}

describe("terminal-task-card", () => {
  it("renders title, description, and ordered steps as text", () => {
    const { container } = makeContainer();
    const task = {
      title: "Repair comparison table",
      description: "Check both arms side by side.",
      nextSteps: ["Read the task", "Approve each pane", "Stop the review window"],
    };
    renderTaskCard(container, task);

    const card = container.querySelector("ARTICLE");
    assert.ok(card, "expected an article element");
    assert.equal(card.getAttribute("aria-labelledby"), "task-card-title");

    const heading = container.querySelector("H2");
    assert.equal(heading.textContent, task.title);

    const description = container.querySelector("P");
    assert.equal(description.textContent, task.description);

    const items = container.querySelectorAll("LI");
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => item.textContent),
      task.nextSteps,
    );
  });

  it("renders markup-looking input as literal text, never as elements", () => {
    const { container } = makeContainer();
    const evil = '<img src=x onerror="alert(1)">';
    renderTaskCard(container, {
      title: evil,
      description: evil,
      nextSteps: [`<b>${evil}</b>`],
    });

    assert.equal(container.querySelector("IMG"), null);
    assert.equal(container.querySelector("B"), null);
    assert.equal(container.querySelector("H2").textContent, evil);
    assert.equal(container.querySelector("P").textContent, evil);
    assert.equal(container.querySelector("LI").textContent, `<b>${evil}</b>`);
  });

  it("fails closed with 'Task unavailable' for malformed data", () => {
    const badTasks = [
      null,
      undefined,
      "task",
      {},
      { title: "", description: "ok", nextSteps: ["ok"] },
      { title: "ok", description: 42, nextSteps: ["ok"] },
      { title: "ok", description: "ok", nextSteps: [] },
      { title: "ok", description: "ok", nextSteps: "not-an-array" },
      { title: "ok", description: "ok", nextSteps: ["ok", 7] },
      { title: "ok", description: "ok", nextSteps: ["   "] },
    ];
    for (const bad of badTasks) {
      const { container } = makeContainer();
      renderTaskCard(container, bad);
      assert.equal(container.textContent, "Task unavailable", `for ${String(bad)}`);
      assert.equal(container.querySelector("ARTICLE"), null);
    }
  });

  it("ignores an unusable container without throwing", () => {
    assert.doesNotThrow(() => renderTaskCard(null, { title: "a", description: "b", nextSteps: ["c"] }));
    assert.doesNotThrow(() => renderTaskCard({}, { title: "a", description: "b", nextSteps: ["c"] }));
  });
});
