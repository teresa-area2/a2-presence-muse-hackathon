# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Area2
"""Generate workspace-scoped Muse Pre/PostLLMCall hooks; no capture or global settings."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import socket
import time
import math
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess
import sys

CAPABILITY = 'plugin:area2-presence-boundary:hook:pre-llm'
POST_CAPABILITY = 'plugin:area2-presence-boundary:hook:post-llm'
KNOWN_CAPABILITIES = frozenset({CAPABILITY, POST_CAPABILITY})

PRE_HOOK_ID = 'area2-presence-boundary:hook:pre-llm'
POST_HOOK_ID = 'area2-presence-boundary:hook:post-llm'

_UUID = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
_TOKEN = r'[A-Za-z0-9_.:-]{1,160}'


def checked_capability(value):
    if (not isinstance(value, dict) or set(value) != {'enabled', 'trusted_definition_hash'}
            or type(value['enabled']) is not bool
            or not isinstance(value['trusted_definition_hash'], str)
            or not re.fullmatch(r'sha256:[a-f0-9]{64}', value['trusted_definition_hash'])):
        raise ValueError('Invalid reviewed Muse hook capability')
    return dict(value)


def reviewed_settings(config):
    if not isinstance(config, dict) or set(config) - {'schema_version', 'tui', 'runtime_capabilities'}:
        raise ValueError('Muse has unreviewed inherited configuration')
    capabilities = config.get('runtime_capabilities', {})
    if not isinstance(capabilities, dict) or set(capabilities) - KNOWN_CAPABILITIES:
        raise ValueError('Muse has unreviewed inherited capabilities')
    return checked_capability(capabilities[CAPABILITY]) if CAPABILITY in capabilities else None


def reviewed_post_settings(config):
    if not isinstance(config, dict) or set(config) - {'schema_version', 'tui', 'runtime_capabilities'}:
        raise ValueError('Muse has unreviewed inherited configuration')
    capabilities = config.get('runtime_capabilities', {})
    if not isinstance(capabilities, dict) or set(capabilities) - KNOWN_CAPABILITIES:
        raise ValueError('Muse has unreviewed inherited capabilities')
    return checked_capability(capabilities[POST_CAPABILITY]) if POST_CAPABILITY in capabilities else None


def reviewed_hook_settings(config):
    if not isinstance(config, dict) or set(config) - {'schema_version', 'tui', 'runtime_capabilities'}:
        raise ValueError('Muse has unreviewed inherited configuration')
    capabilities = config.get('runtime_capabilities', {})
    if not isinstance(capabilities, dict) or set(capabilities) - KNOWN_CAPABILITIES:
        raise ValueError('Muse has unreviewed inherited capabilities')
    return {
        'pre': checked_capability(capabilities[CAPABILITY]) if CAPABILITY in capabilities else None,
        'post': checked_capability(capabilities[POST_CAPABILITY]) if POST_CAPABILITY in capabilities else None,
    }


def review_user_settings(environment=None):
    env = os.environ if environment is None else environment
    config = Path(env.get('XDG_CONFIG_HOME') or str(Path(env.get('HOME', str(Path.home()))) / '.config'))
    settings = config / 'muse/settings.json'
    if not settings.exists():
        return None
    if settings.stat().st_size > 131072:
        raise ValueError('Muse user settings are too large to review')
    try:
        return reviewed_settings(json.loads(settings.read_text()))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError('Muse user settings could not be reviewed') from exc


def capability_argument(value, enabled=True):
    capability = checked_capability(value)
    capability['enabled'] = enabled
    return 'runtime_capabilities.' + CAPABILITY + '=' + json.dumps(capability, separators=(',', ':'))


def post_capability_argument(value, enabled=True):
    capability = checked_capability(value)
    capability['enabled'] = enabled
    return 'runtime_capabilities.' + POST_CAPABILITY + '=' + json.dumps(capability, separators=(',', ':'))


def hook_capability_arguments(pre=None, post=None, enabled=True):
    args = []
    if pre is not None:
        args.append(capability_argument(pre, enabled))
    if post is not None:
        args.append(post_capability_argument(post, enabled))
    return args


def helper():
    spec = importlib.util.spec_from_file_location('presence_read', Path(__file__).with_name('presence-read.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _valid_uuid(value):
    return isinstance(value, str) and re.fullmatch(_UUID, value) is not None


def _valid_token(value):
    return isinstance(value, str) and re.fullmatch(_TOKEN, value) is not None


def _valid_nonneg_int(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def audit_diagnostic(value):
    """Bounded allowlist; future helper fields or arbitrary strings never leak."""
    if not isinstance(value, dict):
        return {}
    record = {}
    outcome = value.get('probe_outcome')
    if outcome in ('launch_error', 'nonzero_exit', 'oversized_output', 'decode_error',
                   'no_envelope', 'envelope_received', 'timeout', 'subprocess_error'):
        record['probe_outcome'] = outcome
    for key, low, high in (('probe_duration_ms', 0, 60000), ('probe_exit_code', -255, 255), ('probe_attempts', 0, 1)):
        number = value.get(key)
        if type(number) is int and low <= number <= high:
            record[key] = number
    return record


def audit_receipt(value):
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.isoformat() if stamp.tzinfo is not None else None
    except ValueError:
        return None


def audit_age(value):
    return value if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1000000000 else None


def scoped_ids(incoming):
    """Allowlisted native identity metadata only; never messages or content."""
    record = {}
    for key in ('session_id', 'turn_id', 'run_id'):
        value = incoming.get(key)
        if _valid_uuid(value):
            record[key] = value
    # Generation binding per official hook reference (verified for 1.3.0;
    # 1.4.13 payload requires live qualification). Absent fields stay absent
    # and provenance reports unknown rather than inferring linkage.
    request_id = incoming.get('request_id', incoming.get('requestId'))
    if _valid_token(request_id):
        record['request_id'] = request_id
    for key in ('attempt', 'step'):
        value = incoming.get(key)
        if _valid_nonneg_int(value):
            record[key] = value
    return record


def post_ids(incoming):
    record = scoped_ids(incoming)
    response_id = incoming.get('response_id', incoming.get('responseId', incoming.get('model_response_id')))
    if _valid_token(response_id):
        record['response_id'] = response_id
    # PostLLMCall status describes the provider call, not acceptance of the
    # PreLLMCall hook output. Never represent it as hook delivery evidence.
    def outcome(value):
        if value is True:
            return 'successful'
        if value is False:
            return 'failed'
        if isinstance(value, str) and value in ('successful', 'success', 'ok'):
            return 'successful'
        if isinstance(value, str) and value in ('failed', 'failure', 'error'):
            return 'failed'
        return 'unknown'
    outcomes = [outcome(incoming[key]) for key in ('status', 'success') if key in incoming]
    if 'failed' in outcomes and 'successful' in outcomes:
        record['provider_status'] = 'conflicting'
    elif 'failed' in outcomes:
        record['provider_status'] = 'failed'
    elif not outcomes or 'unknown' in outcomes:
        record['provider_status'] = 'unknown'
    else:
        record['provider_status'] = 'successful'
    return record


def generate(workspace, probe, state, python=sys.executable, broker_socket=None):
    if sys.version_info < (3, 11):
        raise ValueError("Muse boundary hooks require Python 3.11+")
    workspace = Path(workspace).resolve()
    for p in (workspace / '.muse', workspace / '.muse/presence-boundary-plugin'):
        if p.is_symlink():
            raise ValueError('Refuse symlinked hook directory')
    root = workspace / '.muse/presence-boundary-plugin'
    source = Path(__file__).resolve()
    lab = source.parents[1]
    # Muse validates each native hook as a distinct source. Keep the reviewed
    # adapter bytes identical while giving Pre and Post separate file paths.
    sources = [(source, 'muse-pre-boundary.py'), (source, 'muse-post-boundary.py'),
               (lab / 'agents/claude-presence-hook.py', 'presence-read.py'),
               (lab / 'agents/collaboration-policy.json', 'collaboration-policy.json')]
    if not all(path.is_file() for path, _name in sources):
        raise ValueError('Muse boundary source files are missing')
    def command(name, event):
        return [str(Path(python).resolve()), 'hooks/'+name, 'hook', '--workspace', str(workspace),
                '--probe', str(Path(probe).resolve()), '--state', str(Path(state).resolve()), '--event', event] + (
                    ['--broker-socket', str(broker_socket)] if broker_socket and event == 'PreLLMCall' else [])
    # The PostLLMCall hook is observation-only: it audits allowlisted
    # generation/response identifiers and never emits policy guidance or
    # additional context. If async execution or hook delivery cannot be proven
    # safe on this native lifecycle path, provenance retains unknown and the
    # limitation is documented in muse-presence-provenance.
    manifest = {'schemaVersion': 1, 'name': 'area2-presence-boundary', 'displayName': 'Area2 Presence boundary',
                'version': '0.1.0', 'description': 'Read live guidance before each model generation; observe the committed response after.',
                'compat': {'source': 'native', 'manifestDir': '.muse-plugin'},
                'capabilities': {'skills': [], 'commands': [], 'hooks': [
                    {'id': 'pre-llm', 'event': 'PreLLMCall', 'command': command('muse-pre-boundary.py', 'PreLLMCall'), 'timeoutMs': 10000},
                    {'id': 'post-llm', 'event': 'PostLLMCall', 'command': command('muse-post-boundary.py', 'PostLLMCall'), 'timeoutMs': 5000}],
                    'mcpServers': [], 'reminders': []}}
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    try:
        (root / 'hooks').mkdir(mode=0o700)
        (root / '.muse-plugin').mkdir(mode=0o700)
        for path, name in sources:
            shutil.copyfile(path, root / 'hooks' / name)
        (root / '.muse-plugin/plugin.json').write_text(json.dumps(manifest, indent=2)+'\n')
        for p in root.rglob('*'):
            p.chmod(0o700 if p.is_dir() else 0o600)
    except Exception:
        shutil.rmtree(root)
        raise
    return root


def native_environment(workspace, environment=None):
    workspace = Path(workspace).resolve()
    folder = workspace / '.presence'
    data = folder / 'muse-native-data'
    native = data / 'muse'
    for path in (folder, data, native):
        if path.is_symlink():
            raise ValueError('Refuse symlinked native data directory')
        path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        # Muse creates its own child as 0755; private ancestors protect it.
        forbidden = 0o022 if path == native else 0o077
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & forbidden or not path.resolve().is_relative_to(workspace)):
            raise ValueError('Native data directory must be private and owned')
    return dict(os.environ if environment is None else environment,
                MUSE_NO_AUTO_UPDATE='1', XDG_DATA_HOME=str(data))


def install(bundle, workspace, binary):
    """Local metadata commands only; both registry and approval config are private."""
    review_user_settings()
    env = native_environment(workspace)
    config = Path(workspace).resolve() / '.presence/muse-approval-config'
    for path in (config, config / 'muse'):
        if path.is_symlink():
            raise ValueError('Refuse linked approval config')
        path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077):
            raise ValueError('Muse approval config must be private and owned')
    if (config / 'muse/auth.json').exists() or (config / 'muse/auth.json').is_symlink():
        raise ValueError('Approval config must not contain authentication')
    settings = config / 'muse/settings.json'
    if settings.is_symlink():
        raise ValueError('Refuse linked private approval settings')
    if settings.exists():
        info = settings.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o022 or info.st_size > 131072):
            raise ValueError('Unsafe private approval settings')
        reviewed_hook_settings(json.loads(settings.read_text()))
    env['XDG_CONFIG_HOME'] = str(config)
    for argv in ([binary, 'plugins', 'validate', str(bundle), '--json'],
                 [binary, 'plugins', 'install', str(bundle), '--scope', 'user', '--json'],
                 [binary, 'plugins', 'approve', PRE_HOOK_ID, '--json'],
                 [binary, 'plugins', 'approve', POST_HOOK_ID, '--json']):
        result = subprocess.run(argv, cwd=workspace, env=env, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise RuntimeError('Native Muse hook setup failed; inspect locally before running')
        if argv[2] == 'validate':
            value = json.loads(result.stdout)
            if value.get('valid') is not True or value.get('diagnostics'):
                raise RuntimeError('Native hook validation did not pass cleanly')
    settings = config / 'muse/settings.json'
    if settings.is_symlink() or not settings.is_file():
        raise ValueError('Missing private Muse approval settings')
    info = settings.lstat()
    if info.st_uid != os.getuid() or info.st_mode & 0o022 or info.st_size > 131072:
        raise ValueError('Unsafe private Muse approval settings')
    hooks = reviewed_hook_settings(json.loads(settings.read_text()))
    capability = hooks['pre']
    post_capability = hooks['post']
    if not capability or capability['enabled'] is not True:
        raise ValueError('Workspace Muse hook was not approved')
    if not post_capability or post_capability['enabled'] is not True:
        raise ValueError('Workspace Muse post hook was not approved')
    if (config / 'muse/auth.json').exists() or (config / 'muse/auth.json').is_symlink():
        raise ValueError('Approval config unexpectedly contains authentication')
    return {'scope': 'isolated_workspace_data_and_approval_config', 'events': ['PreLLMCall', 'PostLLMCall'],
            'event': 'PreLLMCall',
            'approved_hook': PRE_HOOK_ID, 'approved_hooks': [PRE_HOOK_ID, POST_HOOK_ID],
            'capability_override': capability, 'post_capability_override': post_capability}


def warm_read(path):
    """One fresh broker request; loss or malformed data never retries cold."""
    start = time.monotonic()
    diagnostic = {'probe_outcome': 'launch_error', 'probe_duration_ms': 0,
                  'probe_exit_code': None, 'probe_attempts': 1}
    raw = None
    try:
        parent = Path(path).parent.lstat()
        target = Path(path).lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
            raise ValueError('unsafe broker directory')
        if not stat.S_ISSOCK(target.st_mode) or target.st_uid != os.getuid() or target.st_mode & 0o077:
            raise ValueError('unsafe broker socket')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            deadline = time.monotonic() + 8
            client.settimeout(8)
            client.connect(str(path))
            client.sendall(b'{"op":"read"}\n')
            chunks = bytearray()
            while b'\n' not in chunks:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('broker deadline')
                client.settimeout(remaining)
                part = client.recv(16384)
                if not part:
                    break
                chunks.extend(part)
                if len(chunks) > 150000:
                    raise ValueError('oversized response')
            message = json.loads(chunks.split(b'\n', 1)[0])
            if isinstance(message, dict) and isinstance(message.get('result'), dict):
                raw = message['result']
                diagnostic['probe_outcome'] = 'envelope_received'
    except (OSError, ValueError, TypeError):
        pass
    finally:
        diagnostic['probe_duration_ms'] = max(0, round((time.monotonic()-start)*1000))
    return raw, diagnostic


def pre_hook(args, incoming, read):
    broker_socket = getattr(args, 'broker_socket', None)
    raw, diagnostic = warm_read(broker_socket) if broker_socket else read.probe_once(args.probe, args.state)
    now = dt.datetime.now(dt.timezone.utc)
    reason = read.assess(raw, now)
    eligible = reason is None
    policy = json.loads(Path(__file__).with_name('collaboration-policy.json').read_text())
    context = ('Automatic Presence refresh immediately before this model generation, including final-answer generation. '
               'This guidance supersedes earlier Presence context. Manual MCP probing is not required when this automatic hook context is present; never claim a manual call. Correctness and requested substance override compression. '
               + policy['universal'] + '\n')
    if eligible:
        controls = raw['controls']
        context += '\n'.join((policy['timing'][controls['unsolicited_update']], policy['extent'][controls['response_extent']],
                              policy['style'][controls['conversation_style']]))
        if controls['conversation_style'] == 'conversational':
            opportunity = ('the requested answer or final handback' if controls['unsolicited_update'] == 'defer'
                           else 'a useful update or requested answer')
            context += ('\nInteractive collaboration: when a real consequential choice would benefit from the user\'s preference, '
                        'you may offer one optional brief question with your recommendation in '+opportunity+', if the user\'s instructions allow it. '
                        'Ask necessary clarification or a required decision when needed; never delay it. '
                        'Keep doing independent authorized work; never invent a choice or delay required approvals.')
        context += '\nServer guidance (verbatim):\n' + raw['guidance']
    else:
        context += 'Presence unavailable or ineligible: '+reason+'. Use ordinary behavior; do not reuse earlier guidance.'
    consumer = raw.get('consumer') if isinstance(raw, dict) else None
    record = {'adapter_revision': 'muse-generation-boundary.1', 'event': 'PreLLMCall', 'read_at': now.isoformat(),
              'eligible': eligible, 'fallback_reason': reason, 'received_at': audit_receipt(raw.get('received_at')) if isinstance(raw, dict) else None,
              'receipt_age_seconds': audit_age(consumer.get('receipt_age_seconds')) if isinstance(consumer, dict) else None,
              'controls': {k: raw['controls'][k] for k in ('response_extent', 'unsolicited_update', 'conversation_style')} if eligible else None,
              'guidance_sha256': hashlib.sha256(raw['guidance'].encode()).hexdigest() if eligible else None, **audit_diagnostic(diagnostic)}
    # Retain only allowlisted native identity/generation metadata, never
    # incoming messages/tools. Old hosts without request binding remain
    # explicitly unbound in owned telemetry.
    record.update(scoped_ids(incoming))
    record['renderer'] = 'coding-instructions.3' if isinstance(raw, dict) and raw.get('renderer') == 'coding-instructions.3' else None
    try:
        read.audit(args.workspace, record)
    except (OSError, ValueError):
        # A silent write failure must not appear verified: with no record,
        # provenance reports unknown. The hook still delivers guidance.
        pass
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreLLMCall', 'additionalContext': context}}))


def post_hook(args, incoming, read):
    # Observation-only: never probe, never emit policy guidance, never block.
    # Audit allowlisted generation/response identifiers only. Missing fields
    # stay missing; provenance fails closed to unknown/unverified.
    now = dt.datetime.now(dt.timezone.utc)
    record = {'adapter_revision': 'muse-generation-boundary.1', 'event': 'PostLLMCall',
              'observed_at': now.isoformat()}
    record.update(post_ids(incoming))
    try:
        read.audit(args.workspace, record)
    except (OSError, ValueError):
        pass
    # Empty output: no additional context, no policy, no blocking.
    print('{}')


def hook(args):
    # Input includes messages/tools/response text: use only the event label and
    # allowlisted identifiers; never audit content.
    incoming = json.loads(sys.stdin.buffer.read(1_000_001))
    cwd = incoming.get('cwd')
    if not isinstance(cwd, str) or not Path(cwd).is_absolute() or Path(cwd).resolve() != args.workspace.resolve():
        # No probe, Presence read, broker access, or audit outside the bound
        # workspace. A PreLLMCall that cannot establish the bound workspace
        # still needs an explicit replacement so earlier guidance is not
        # reused: emit neutral fallback context. A hook bound to PreLLMCall
        # must also fail closed when the incoming event is missing or wrong;
        # its binding, not untrusted input, identifies the hook invocation.
        event = incoming.get('hook_event_name')
        if args.event == 'PreLLMCall' or (args.event is None and event == 'PreLLMCall'):
            print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreLLMCall',
                'additionalContext': ('Presence unavailable: outside the bound workspace. '
                    'Earlier guidance is superseded; use ordinary behavior and do not reuse earlier guidance.')}}))
        else:
            print('{}')
        return
    event = incoming.get('hook_event_name')
    if args.event is not None and event != args.event:
        raise ValueError('Unexpected hook event')
    if event == 'PreLLMCall':
        pre_hook(args, incoming, helper())
        return
    if event == 'PostLLMCall':
        post_hook(args, incoming, helper())
        return
    raise ValueError('Unexpected hook event')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('prepare', 'install', 'hook'))
    p.add_argument('--workspace', type=Path, required=True)
    p.add_argument('--probe', type=Path)
    p.add_argument('--state', type=Path)
    p.add_argument('--muse', default=shutil.which('muse'))
    p.add_argument('--event', choices=('PreLLMCall', 'PostLLMCall'))
    p.add_argument('--broker-socket', type=Path)
    a = p.parse_args()
    if a.action == 'install':
        print(json.dumps(install(a.workspace.resolve()/'.muse/presence-boundary-plugin', a.workspace.resolve(), a.muse)))
    elif a.action == 'prepare':
        if not a.probe or not a.state:
            p.error('--probe and --state are required')
        print(generate(a.workspace, a.probe, a.state, broker_socket=a.broker_socket))
    else:
        try:
            hook(a)
        except Exception:
            if a.event == 'PreLLMCall':
                print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreLLMCall',
                    'additionalContext': 'Presence boundary unavailable. Earlier guidance is superseded; use ordinary behavior.'}}))
            else:
                print('{}')

if __name__ == '__main__':
    main()
