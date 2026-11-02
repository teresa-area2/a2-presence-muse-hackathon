// components.mjs — pinned component loading with unified setup resolution.
//
// Canonical startup uses the verified in-repo Lab snapshot. Explicit external
// selection still uses the shared setup rules and exact Git pin/cleanliness.
// Optional desktop runtime selection retains its documentation-only allowance;
// no collector code or installed runtime packaging is included here.

import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {readDependencyBundle} from './dependency-bundle.mjs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveSetupConfig} from './setup-config.mjs';
import {loadProjectProfile, freezeProjectPlan} from './project-task.mjs';
import {runGit} from './git-ops.mjs';

const execute = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));

// Trusted LOCAL startup selection for the real-project task profile.
// A2_MUSE_TASK_PROFILE points at a local project profile JSON file and is
// read once here, before server startup, before either arm opens. The
// profile is strictly validated; the exact source commit and the complete
// trusted baseline bytes are frozen from the selected commit at this point.
// A malformed selection refuses (throw) — there is never a silent fallback
// to the sample task. When the variable is unset, the sample task default
// is preserved and project is null. Repository paths, revisions, commands
// and verification policy are never accepted from browser requests: the
// browser-facing routes admit only arm/text/approval/review fields.
export async function loadProjectPlan(env = process.env) {
  const selected = env.A2_MUSE_TASK_PROFILE;
  if (selected === undefined || selected === null || String(selected).trim() === '') return null;
  const profilePath = String(selected);
  if (profilePath.includes('\0') || /[\x00-\x1f\x7f]/.test(profilePath)) throw Error('project_profile_invalid');
  const profile = await loadProjectProfile(profilePath);
  if (profile.repository.root !== path.resolve(profile.repository.root)) throw Error('project_profile_repository_invalid');
  return freezeProjectPlan({profile, env});
}

export async function loadComponents(env = process.env, {bundleRoot=null}={}) {
  const source=env.A2_MUSE_PRESENCE_SOURCE??'desktop';if(!['desktop','textbox'].includes(source))throw Error('presence_source_invalid');const textbox=source==='textbox';
  const pins = JSON.parse(await fs.readFile(new URL('../components.json', import.meta.url)));
  // Freeze the project plan (if selected) before any component probing, so
  // a malformed trusted selection refuses even when prerequisites are off.
  const project = await loadProjectPlan(env);
  const setup = await resolveSetupConfig({env});
  const dependencies=JSON.parse(await fs.readFile(new URL('../dependencies.json',import.meta.url)));
  const bundled=env.A2_AGENT_LAB_ROOT?null:await readDependencyBundle({repoRoot:root,id:'agent-lab',bundleRoot,manifestSha256:dependencies.agent_lab.bundle_manifest_sha256,required:!!dependencies.agent_lab.bundle_manifest_sha256});
  if(bundled&&bundled.manifest.sources?.commit!==pins.agent_lab)throw Error('component_pin_mismatch');
  if (!bundled&&!setup.agentLabRoot) throw Error('agent_lab_dependency_missing');
  if (!textbox&&!setup.presenceRuntimeRoot) throw Error('Set A2_OPEN_PRESENCE_LOCAL to the existing runtime directory');
  const labRoot = bundled?bundled.root:path.resolve(setup.agentLabRoot);
  const runtimeRoot = textbox?null:path.resolve(setup.presenceRuntimeRoot);
  // Hermetic component pin reads through the shared helper: scrubbed
  // GIT_* overrides, no global/system config, forced fsmonitor-off plus
  // hooks/signing isolation. A poisoned core.fsmonitor helper or GIT_DIR
  // must never execute or redirect here.
  for (const [folder, pin, allowDocs] of [...(!bundled?[[labRoot,pins.agent_lab,false]]:[]),...(!textbox?[[runtimeRoot,pins.presence_runtime,true]]:[])]) {
    if (String(await runGit(['rev-parse', 'HEAD'], folder, {env})).trim() !== pin) throw Error('component_pin_mismatch');
    const changed = String(await runGit(['status', '--porcelain', '--untracked-files=all'], folder, {env})).trim().split('\n').filter(Boolean);
    if (changed.some(line => !allowDocs || line.trim() !== 'M docs/WORKSTATE.md')) throw Error('component_source_changed');
  }
  const load = name => import(pathToFileURL(path.join(labRoot, name)).href);
  const [msp, events, factory, telemetry, presence, museInteractive, warmBroker] = await Promise.all([
    load('core/muse-msp.mjs'), load('core/muse-public-events.mjs'), load('core/muse-harness-factory.mjs'),
    load('core/telemetry.mjs'), load('presence.ts'), load('agents/muse-interactive.mjs'), load('agents/muse-warm-broker.mjs'),
  ]);
  const executable=async value=>{if(path.isAbsolute(value))return value;if(value.includes('/'))throw Error('absolute_tool_paths_required');for(const dir of (env.PATH??process.env.PATH??'').split(path.delimiter).filter(Boolean)){const candidate=path.resolve(dir,value);try{if(!(await fs.stat(candidate)).isFile())continue;await fs.access(candidate,constants.X_OK);return candidate;}catch{}}return value;};
  const task = await fs.readFile(path.join(labRoot, 'repo-task.txt'), 'utf8');
  const projectWorkspacesRoot = env.A2_MUSE_PROJECT_WORKSPACES
    ? path.resolve(env.A2_MUSE_PROJECT_WORKSPACES)
    : path.resolve(root, '../agent-workspaces/project-tasks');
  if (/[\x00-\x1f\x7f]/.test(projectWorkspacesRoot)) throw Error('project_workspace_invalid');
  return {
    labRoot, runtimeRoot, presenceSource:source, pins:textbox?{...pins,presence_runtime:null}:pins, msp, events, factory, telemetry, presence,
    prepareMuseBoundary: museInteractive.prepareMuseBoundary,
    museEnvironment: museInteractive.museEnvironment,
    startMuseWarmBroker: warmBroker.startMuseWarmBroker,
    task: project ? `${project.taskPrompt}\n\n${project.universalInstructions ?? ''}`.trim() : task,
    project,
    projectWorkspacesRoot,
    binary: await executable(setup.labMuse || env.A2_LAB_MUSE || 'muse'),
    python: await executable(setup.labPython || env.A2_LAB_PYTHON || 'python3'),
    runtimePython: textbox?null:path.join(runtimeRoot, '.venv/bin/python'),
    probe: textbox?null:path.join(runtimeRoot, 'presence-pa'),
    state: textbox?null:env.A2_DEMO_STATE || path.join(runtimeRoot, '.a2/live/selected.json'),
    public: {lab: {commit: pins.agent_lab, verified: true,distribution:bundled?'bundled':'external',manifest_sha256:bundled?.manifestSha256??null}, runtime: textbox?{used:false,commit:null,verified:false}:{commit: pins.presence_runtime, verified: true, verification: 'source_code; running installation assessed on reads'}},
  };
}
