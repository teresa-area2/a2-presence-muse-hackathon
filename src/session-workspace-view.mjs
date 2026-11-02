import {CODING_TASKS,FREE_CODING_TASK} from './coding-task-catalog.mjs';
import {sessionMeasurementHtml} from '../web/session-measurement.mjs';
import {sessionEvidenceHtml,presenceObserverHtml} from '../web/session-evidence.mjs';
import {evidencePackageHtml} from '../web/evidence-package.mjs';
function measurementWithEvidenceHtml(){return sessionMeasurementHtml().replace('</details>',sessionEvidenceHtml({includeExport:false})+'</details>');}
// Reuse Claude's reviewed shell for the supported Muse session transport.
// Only fixed local markup is transformed; no agent text enters HTML here.
export function sessionWorkspaceHtml(html){
 return html
  .replace('    <section class="results"','    <section id="session-code-checks" hidden></section>\n    <section class="results"')
  .replace('<title>Open Presence × Muse terminals</title>','<title>Open Presence × Muse workspace</title>')
  .replace('  <link rel="stylesheet" href="/xterm.css">\n','')
  .replace('  <link rel="stylesheet" href="/terminal-panes.css">\n','')
  .replace('<link rel="stylesheet" href="/terminal-app.css">','<link rel="stylesheet" href="/terminal-app.css">\n  <link rel="stylesheet" href="/session-panes.css">\n  <link rel="stylesheet" href="/session-code-checks.css">\n  <link rel="stylesheet" href="/workspace-controls.css">\n  <link rel="stylesheet" href="/evidence-package.css">')
  .replace('  <script src="/xterm.js"></script>\n','')
  .replace('  <script src="/fit.js"></script>\n','')
  .replace('<small>Delivery to Muse not verified</small>','<small id="muse-delivery" role="status">Waiting for a Muse request</small>')
  .replace('<small>Muse default behavior</small>','<small id="muse-baseline-delivery" role="status">Waiting for baseline request</small>')
  .replace('src="/terminal-app.mjs"','src="/session-app.mjs"')
  .replace('aria-label="Policy changes with times"','aria-label="Presence readings with receipt times and policy comparisons"')
  .replace('<div class="rating" role="group" aria-labelledby="rating-heading">','<div class="rating" role="group" aria-labelledby="rating-heading" hidden>')
  .replace('<div id="session-utilities"></div>','<div id="session-utilities">'+measurementWithEvidenceHtml()+presenceObserverHtml()+'</div>')
  .replace('<div class="utilities-content">','<div class="utilities-content">'+evidencePackageHtml())
  .replace('id="send-shared" disabled>Send</button>','id="send-shared" aria-label="Send to both agents" title="Send to both agents (Enter)" disabled><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>')
  .replace('<button id="present"', '<label class="coding-task-control" for="coding-task" hidden><span>Task</span> <select id="coding-task" aria-label="Coding task for both agents" title="Choose a task before opening sessions" disabled><optgroup label="Sample tasks">'+CODING_TASKS.map(t=>'<option value="'+t.id+'">'+t.title+'</option>').join('')+'</optgroup><optgroup label="Start clean"><option value="'+FREE_CODING_TASK.id+'">'+FREE_CODING_TASK.title+'</option></optgroup></select></label><label class="comparison-model-control" for="comparison-model"><span>Model</span> <select id="comparison-model" aria-label="Model for both agents" title="Choose before opening sessions; locked while sessions are open" disabled><option value="muse-spark-1.3">Spark 1.3</option><option value="muse-wonder-1.0">Wonder 1.0</option></select></label><button id="present"')
  .replaceAll('Open terminals','Open sessions')
  .replaceAll('both terminals become interactive','both sessions become ready')
  .replace('Connecting to the local terminal service…','Connecting to the local Muse sessions…')
  .replace('aria-label="Two interactive terminals"','aria-label="Two Muse sessions"')
  .replaceAll('interactive terminal','Muse conversation')
  .replaceAll('Type in Without Presence terminal','Message Without Presence')
  .replaceAll('Type in With Presence terminal','Message With Presence')
  .replaceAll('>Type here</button>','>Message</button>')
  .replace('Approvals are never answered from here. Handle them in each terminal.','Click a pane to select it; Command/Ctrl-click adds the other. Enter sends; Shift+Enter adds a line.');
}

// The shared presentation shell reads rendered labels only. Adapt its native
// TUI labels to supported-session labels without changing transport ownership.
export function sessionWorkspaceShell(source){
 return source.replace("if (text === 'Interactive')", "if (text === 'Interactive' || text === 'Ready')")
  .replace("['Preparing', 'Restoring'].includes(text)", "['Preparing', 'Restoring', 'Starting', 'Working'].includes(text)")
  .replace("$('state-' + arm)?.textContent.trim() === 'Interactive'", "['Ready', 'Working', 'Approval needed'].some(status => $('state-' + arm)?.textContent.trim().startsWith(status))");
}
