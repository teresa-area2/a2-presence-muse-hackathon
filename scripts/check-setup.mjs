#!/usr/bin/env node
// check-setup.mjs — read-only local setup preflight (BUILD-04).
//
// Complete preflight checks supplied local checkouts/pins/cleanliness and
// required executable/interface files with useful failures. Offline mode
// (--offline) requires Node only and makes no external calls: it bypasses
// machine configuration entirely, so a malformed setup.json or
// A2_SETUP_CONFIG never affects --offline, and no component/Git/tool calls
// occur in offline mode.
//
// Never clones, downloads, installs, starts the runtime, reads production
// state, or probes auth/provider/collector.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveSetupConfig, describeSetupConfig} from '../src/setup-config.mjs';
import {runSetupCheck} from '../src/setup-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function usage() {
  return `usage: check-setup.mjs [--offline] [--config <path>] [--json]\n`;
}

const args = process.argv.slice(2);
let offline = false, configPath = null, json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--offline') offline = true;
  else if (args[i] === '--json') json = true;
  else if (args[i] === '--config') {
    const value = args[++i];
    // A missing value, or another flag as the value, is a usage error.
    if (value === undefined || value.startsWith('--')) {
      process.stderr.write(usage());
      process.exit(2);
    }
    configPath = value;
  }
  else { process.stderr.write(usage()); process.exit(2); }
}
if (!configPath && process.env.A2_SETUP_CONFIG) configPath = process.env.A2_SETUP_CONFIG;

if (offline) {
  // Repository-only mode: Node only, no external calls. Machine
  // configuration (setup.json, A2_SETUP_CONFIG) is deliberately not read,
  // so malformed configuration cannot affect the offline result.
  const result = await runSetupCheck({mode: 'offline', config: {}, requirements: {}});
  if (json) {
    console.log(JSON.stringify({mode: result.mode, ok: result.ok, checks: result.checks}, null, 2));
  } else {
    console.log(`setup preflight (offline): ${result.ok ? 'PASS' : 'FAIL'}`);
    for (const c of result.checks) console.log(`  ${c.ok ? 'ok' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  process.exit(result.ok ? 0 : 1);
}

const requirements = JSON.parse(await fs.readFile(path.join(root, 'setup-requirements.json'), 'utf8'));
// components.json is the one canonical exact-pin manifest. Supply its pins
// so preflight detects requirements/components pin drift.
try {
  const canonical = JSON.parse(await fs.readFile(path.join(root, 'components.json'), 'utf8'));
  requirements.canonicalPins = { 'agent-lab': canonical.agent_lab, 'presence-runtime': canonical.presence_runtime };
} catch {
  // A missing canonical manifest fails closed below via the pin check.
}
const config = await resolveSetupConfig({configPath}).catch(error => {
  if (json) console.log(JSON.stringify({mode: 'complete', ok: false, checks: [{name: 'config', ok: false, detail: error.message}]}));
  else process.stderr.write(`setup preflight failed: ${error.message}\n`);
  process.exit(1);
});

const result = await runSetupCheck({mode: 'complete', config, requirements});
if (json) {
  console.log(JSON.stringify({mode: result.mode, ok: result.ok, checks: result.checks, config: describeSetupConfig(config)}, null, 2));
} else {
  const summary = describeSetupConfig(config);
  console.log(`setup preflight (complete): ${result.ok ? 'PASS' : 'FAIL'}`);
  console.log(`config source: ${config.source}`);
  console.log(`config: agent_lab_root=${summary.agent_lab_root} presence_runtime_root=${summary.presence_runtime_root} lab_python=${summary.lab_python} lab_muse=${summary.lab_muse}`);
  for (const c of result.checks) console.log(`  ${c.ok ? 'ok' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  if (!result.ok && result.mode === 'complete') {
    console.log('See setup.example.json and docs/SETUP.md. A local pin alone is not a fresh-clone installable release.');
  }
}
process.exit(result.ok ? 0 : 1);
