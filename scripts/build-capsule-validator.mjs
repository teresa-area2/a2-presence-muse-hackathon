import {fileURLToPath} from 'node:url';import {buildCapsuleValidator} from '../src/capsule-validator-build.mjs';
console.log(JSON.stringify(await buildCapsuleValidator({repoRoot:fileURLToPath(new URL('../',import.meta.url))})));
