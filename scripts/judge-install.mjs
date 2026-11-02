import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertJudgePlatform,judgePlatformMessage} from '../src/judge-platform.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const abort=new AbortController();
// Register before argument parsing, credential access or child creation.
const stop=()=>abort.abort();
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
try{
 assertJudgePlatform();
 const [major,minor]=process.versions.node.split('.').map(Number);if(major!==22||minor<12)throw Error('judge_node_22_12_required');
 const {judgeArguments}=await import('../src/judge-access.mjs');
 const {runJudgeInstall}=await import('../src/judge-install-runner.mjs');
 const options=judgeArguments(process.argv.slice(2));if(options.consent||options.port!==null)throw Error('judge_install_argument_invalid');
 await runJudgeInstall({root,accessPath:options.access??path.join(root,'judge-access/temporary-credentials.json'),signal:abort.signal,onProgress:name=>console.log(name+'…')});
 console.log('Installed and built. Run muse and use first-run sign-in or /login inside Muse with your own entitled account. Then npm run judge:start -- --consent-typing.');
}catch(e){
 console.error(judgePlatformMessage(e)??(/^judge_[a-z0-9_]+$/.test(e.message)?e.message:'judge_install_failed'));
 if(e.message==='judge_access_cleanup_unconfirmed'&&typeof e.recovery?.directory==='string'&&path.isAbsolute(e.recovery.directory)&&path.basename(e.recovery.directory).startsWith('a2-judge-access-'))console.error('Original npm configuration directory (verify identity before recovery): '+JSON.stringify(e.recovery.directory)+'. See docs/JUDGE-QUICKSTART.md#installer-recovery.');
 process.exitCode=1;
}
finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);}
