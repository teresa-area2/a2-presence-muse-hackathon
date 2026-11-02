// Canonical local entry point. Opening the page does not send a model task.
import {startWorkspace} from './structured-live.mjs';
startWorkspace().catch(error=>{console.error('Workspace could not start:',/^[a-z_]+$/.test(error.message)?error.message:'setup_failed');process.exitCode=1;});
