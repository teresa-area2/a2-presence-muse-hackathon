#!/usr/bin/env bash
# Synthetic only: no credentials, real login, OP capture or external model calls.
set -euo pipefail
[[ "$(uname -r)" =~ [Mm]icrosoft.*WSL2 ]] || exit 2
[[ "$(uname -m)" == x86_64 ]] || exit 2
umask 077
qual_root="$(mktemp -d /tmp/a2-wsl-echo.XXXXXXXX)"
trap 'rm -rf -- "$qual_root"' EXIT
if ! command -v curl >/dev/null || ! command -v xz >/dev/null; then
  apt-get update -qq >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends curl ca-certificates xz-utils >/dev/null 2>&1
fi
curl --proto '=https' --proto-redir '=https' -fsSL --max-time 60 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz' -o "$qual_root/node.tar.xz"
printf '%s  %s\n' '22982235e1b71fa8850f82edd09cdae7e3f32df1764a9ec298c72d25ef2c164f' "$qual_root/node.tar.xz" | sha256sum --check --status
tar -xJf "$qual_root/node.tar.xz" -C "$qual_root"
curl --proto '=https' --proto-redir '=https' -fsSL --max-time 90 --max-filesize 414927192 'https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=1.4.14-R7309.1&file=muse-x86-linux' -o "$qual_root/muse"
printf '%s  %s\n' '0809aac7cb58d18f5022b6d05e02aa1974683c0ec430e5f04d25b60ed17de2da' "$qual_root/muse" | sha256sum --check --status
chmod 700 "$qual_root/muse"
mkdir "$qual_root/home" "$qual_root/config" "$qual_root/work"
env -i HOME="$qual_root/home" XDG_CONFIG_HOME="$qual_root/config" PATH="$qual_root/node-v22.12.0-linux-x64/bin:/usr/bin:/bin" MUSE_NO_AUTO_UPDATE=1 \
  "$qual_root/muse" exec --json --provider echo --preset empty --contributor-mode off --max-model-steps 1 \
  --workspace "$qual_root/work" --no-session-log --no-foreign-personal-context --disable-reminders \
  --disable-web-tools --disable-request-user-input --disable-shell --disable-write --approval-mode on-request \
  --approval-judge off 'Synthetic Echo probe.' >"$qual_root/events.jsonl" 2>"$qual_root/native-error"
"$qual_root/node-v22.12.0-linux-x64/bin/node" --input-type=module - "$qual_root/events.jsonl" <<'JS'
import fs from 'node:fs';
const text=fs.readFileSync(process.argv[2],'utf8');
if(Buffer.byteLength(text)>2*1024*1024)process.exit(1);
const rows=text.split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x));
if(rows.some(r=>typeof r.payload_type!=='string'||/(subagent|child|approval|tool)[._]/i.test(r.payload_type)))process.exit(1);
if(rows.filter(r=>r.payload_type==='run.terminal.completed'&&r.payload?.terminal==='completed').length!==1)process.exit(1);
console.log(JSON.stringify({status:'passed',node_version:process.versions.node,muse_version:'1.4.14-R7309.1',echo_completed:true,actual_model_calls:0,op_calls:0,login:'not_attempted'}));
JS
