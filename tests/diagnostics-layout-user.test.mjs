import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sessionWorkspaceHtml} from '../src/session-workspace-view.mjs';

test('diagnostics presents one visible export action and effort before observer', async () => {
 const source = await fs.readFile(new URL('../web/terminal-app.html', import.meta.url), 'utf8');
 const html = sessionWorkspaceHtml(source);
 const diagnostics = html.indexOf('id="testing-diagnostics"');
 const packageAction = html.indexOf('id="export-evidence-package"');
 const effort = html.indexOf('id="session-measurement"');
 const observer = html.indexOf('id="presence-observer"');
 assert.ok(diagnostics < packageAction && packageAction < effort && effort < observer);
 assert.ok(!html.includes('id="evidence-export"'));
 assert.equal((html.match(/id="export-evidence-package"/g) ?? []).length, 1);
});
