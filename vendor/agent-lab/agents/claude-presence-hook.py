"""Private Claude command hook. No prompt, tool content, or capsule is audited."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

PROBE = os.environ.get("A2_DEMO_PROBE")
STATE = os.environ.get("A2_DEMO_STATE")

def probe_once(executable, state=None):
    """One bounded read; audit only fixed outcome labels, timing and exit status.

    Preserve the existing eight-second subprocess budget inside the ten-second
    host hook timeout. No retry or retained result is used on a failed read.
    Exception messages, command paths, stdout and stderr never enter diagnostics.
    """
    started = time.monotonic()
    diagnostic = {"probe_outcome": "launch_error", "probe_duration_ms": 0,
                  "probe_exit_code": None, "probe_attempts": 1}
    raw = None
    try:
        if not executable:
            return raw, diagnostic
        result = subprocess.run([executable, "--state", state or STATE or "", "probe"], capture_output=True,
            timeout=8, check=False,
            env={k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG")})
        diagnostic["probe_exit_code"] = result.returncode
        if result.returncode != 0:
            diagnostic["probe_outcome"] = "nonzero_exit"
        elif len(result.stdout) > 150_000:
            diagnostic["probe_outcome"] = "oversized_output"
        else:
            try:
                output = result.stdout.decode("utf-8")
            except UnicodeDecodeError:
                diagnostic["probe_outcome"] = "decode_error"
            else:
                diagnostic["probe_outcome"] = "no_envelope"
                for line in output.splitlines():
                    try:
                        envelope = json.loads(line)
                        if isinstance(envelope, dict) and envelope.get("transport") == "stdio" and isinstance(envelope.get("result"), dict):
                            raw = envelope["result"]
                            diagnostic["probe_outcome"] = "envelope_received"
                            break
                    except ValueError:
                        pass
    except subprocess.TimeoutExpired:
        diagnostic["probe_outcome"] = "timeout"
    except subprocess.SubprocessError:
        diagnostic["probe_outcome"] = "subprocess_error"
    except OSError:
        diagnostic["probe_outcome"] = "launch_error"
    finally:
        diagnostic["probe_duration_ms"] = max(0, round((time.monotonic()-started)*1000))
    return raw, diagnostic

def assess(raw, now):
    if not isinstance(raw, dict): return "probe_unavailable"
    if raw.get("environment") != "production" or raw.get("mode") != "live": return "not_production_live"
    if raw.get("renderer") != "coding-instructions.3" or raw.get("profile") != "coding": return "unsupported_contract"
    consumer = raw.get("consumer")
    if not isinstance(consumer, dict): return "consumer_missing"
    if raw.get("eligible") is not True or raw.get("retained") is not False or raw.get("conformance_only") is not False or consumer.get("adaptation_eligible") is not True or consumer.get("fallback_reason") is not None: return "source_ineligible"
    try:
        stamp = dt.datetime.fromisoformat(raw["received_at"].replace("Z", "+00:00"))
        if stamp.tzinfo is None: return "invalid_receipt"
        age = (now-stamp).total_seconds()
        if age < 0: return "stale_or_future_receipt"
    except (TypeError, KeyError, ValueError): return "invalid_receipt"
    controls = raw.get("controls")
    if not isinstance(controls, dict) or controls.get("response_extent") not in ("terse", "standard", "full") or controls.get("unsolicited_update") not in ("send", "defer") or controls.get("conversation_style") not in ("self_contained", "conversational"): return "invalid_controls"
    if not isinstance(raw.get("guidance"), str) or not raw["guidance"].strip() or len(raw["guidance"]) > 9000: return "guidance_unavailable"
    return None

def audit(workspace, record):
    # Refuse unsafe paths rather than leaking metadata into an existing symlink.
    folder = Path(workspace) / ".presence"
    folder.mkdir(mode=0o700, exist_ok=True)
    info = folder.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077: raise ValueError("unsafe audit directory")
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(folder / "hook-events.jsonl", flags, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077: raise ValueError("unsafe audit file")
        os.write(fd, (json.dumps(record, separators=(",", ":"))+"\n").encode())
    finally: os.close(fd)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--arm", choices=("with", "without"), required=True)
    parser.add_argument("--event", choices=("UserPromptSubmit", "PostToolUse", "PostToolUseFailure"), required=True)
    # Test-only override is explicit. The generated production settings never supplies it.
    parser.add_argument("--synthetic-probe")
    parser.add_argument("--probe", default=PROBE)
    parser.add_argument("--state", default=STATE)
    args = parser.parse_args()
    raw = None
    try:
        incoming = json.loads(sys.stdin.buffer.read(1_000_000))
        valid_event = incoming.get("hook_event_name") == args.event
    except (ValueError, AttributeError): valid_event = False
    reason = "baseline_disabled" if args.arm == "without" else "probe_unavailable"
    diagnostic = {"probe_outcome": "not_run_baseline" if args.arm == "without" else "not_run_invalid_input",
                  "probe_duration_ms": 0, "probe_exit_code": None, "probe_attempts": 0}
    if not valid_event and args.arm == "with": reason = "hook_input_unavailable"
    if args.arm == "with" and valid_event:
        raw, diagnostic = probe_once(args.synthetic_probe or args.probe, args.state)
        reason = assess(raw, dt.datetime.now(dt.timezone.utc))
    now = dt.datetime.now(dt.timezone.utc)
    # Recheck at use after subprocess and decoding, rather than trusting the source's age.
    if args.arm == "with" and reason is None: reason = assess(raw, now)
    eligible = reason is None
    record = {"adapter_revision": "presence-host-hooks.7", "event": args.event, "read_at": now.isoformat(), "received_at": raw.get("received_at") if isinstance(raw, dict) else None,
        "controls": {k:raw["controls"][k] for k in ("response_extent","unsolicited_update","conversation_style")} if eligible else None,
        "eligible": eligible, "fallback_reason": reason,
        "max_age_seconds": raw.get("consumer",{}).get("max_age_seconds") if isinstance(raw,dict) and isinstance(raw.get("consumer"),dict) else None,
        "receipt_age_seconds": raw.get("consumer",{}).get("receipt_age_seconds") if isinstance(raw,dict) and isinstance(raw.get("consumer"),dict) else None,
        "guidance_sha256": hashlib.sha256(raw["guidance"].encode()).hexdigest() if eligible else None,
        "evidence": "synthetic" if args.synthetic_probe else "live_adapter" if args.arm == "with" else "baseline",
        **diagnostic}
    try: audit(args.workspace, record)
    except (OSError, ValueError): pass  # Audit problems never block the coding task.
    if args.arm == "without": return
    context = (f"Automatic host Presence read at {now.isoformat()} for {args.event}. This runs on every submitted user turn, including simple Q&A, independently of your choice to call a tool. "
        "Do not say you skipped the probe or ask whether to enable it. Describe the actual latest read status accurately if asked. "
        "Current Presence collaboration context supersedes all earlier Presence reminders. "
        "There is no consumer age cutoff. Apply the latest source-eligible guidance to presentation and optional updates; receipt age is not proof of current human state. Correctness, user instructions and required approvals take precedence. ")
    if eligible:
        controls = {k: raw["controls"][k] for k in ("response_extent", "unsolicited_update", "conversation_style")}
        policy = json.loads((Path(__file__).parent / "collaboration-policy.json").read_text())
        execution = "\n".join((policy["timing"][raw["controls"]["unsolicited_update"]], policy["extent"][raw["controls"]["response_extent"]], policy["style"][raw["controls"]["conversation_style"]]))
        context += (f"Eligible production coding-instructions.3 receipt: {raw['received_at']}. "
            f"Canonical capsule controls: {json.dumps(controls, separators=(',', ':'))}. "
            "Adapter interpretation: unsolicited_update=defer means omit optional progress messages and self-initiated nudges; it never suppresses required approvals, errors, essential notices or the requested final answer. "
            "When unsolicited_update=send, useful optional updates may be sent; this does not require extra messages. "
            "Notification delivery is controlled by the consuming application. These controls do not intercept native terminal output or OS notifications. "
            f"Adapter execution rules ({policy['revision']}):\n{execution}\n"
            f"Server guidance (verbatim):\n{raw['guidance']}")
    else:
        context += f"Read status: {reason}. Presence is currently unavailable or ineligible. Ordinary behavior applies now; earlier Presence guidance must not be reused."
    print(json.dumps({"hookSpecificOutput":{"hookEventName":args.event,"additionalContext":context}}))

if __name__ == "__main__":
    try: main()
    except Exception:
        # Fail open even on an unexpected implementation error. Never print exception data.
        event = sys.argv[sys.argv.index("--event")+1] if "--event" in sys.argv else "UserPromptSubmit"
        if event not in ("UserPromptSubmit", "PostToolUse", "PostToolUseFailure"): event = "UserPromptSubmit"
        print(json.dumps({"hookSpecificOutput":{"hookEventName":event,"additionalContext":"Presence hook unavailable. Earlier Presence guidance is superseded; ordinary behavior applies."}}))
