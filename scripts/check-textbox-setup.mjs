// Explicit config/installed-package check. No live service or model calls.
import path from'node:path';import fs from'node:fs/promises';import{fileURLToPath}from'node:url';import{loadTextboxPresence}from'../src/textbox-presence-config.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));let code=0;
const report={cipher:{status:'missing'},op:{status:'not_checked'},live_calls:0};
try{const file=path.join(root,'integrations/cipher-textbox/node_modules/@area2-ai/a2-cipher-react/package.json'),pkg=JSON.parse(await fs.readFile(file,'utf8'));await import(path.join(path.dirname(file),'dist/index.js'));report.cipher={status:'installed',package:pkg.name,version:pkg.version};}catch{code=1;}
try{await loadTextboxPresence({repoRoot:root});report.op={status:'configured_not_admission_verified'};}catch(e){code=1;const allowed=new Set(['ENOENT','EACCES','op_config_location_invalid','op_config_permissions_invalid','op_config_changed','op_config_invalid','op_validator_module_required','op_validator_module_invalid','op_client_invalid']);report.op={status:'not_ready',reason:allowed.has(e.code)?e.code:allowed.has(e.message)?e.message:'setup_failed'};}
console.log(JSON.stringify(report));process.exitCode=code;
