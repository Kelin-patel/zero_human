"""Frozen input verification and read-only database access for reporting."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parent.parent
CUTOFF = datetime(2026, 10, 24, 21, 30, tzinfo=timezone.utc)
FOLLOWUP_CUTOFF = datetime(2026, 10, 24, 22, 10, tzinfo=timezone.utc)
REGISTERED = (
    "policy.v1.md", "cases.frozen.json", "prepared-review.config.json",
    "decisions_v1.json", "assignment.json",
)
BINARY = {"approve", "deny"}
DECISIONS = BINARY | {"out_of_scope"}


class ReportError(Exception):
    """An authored diagnostic safe to display without connection information."""


def timestamp(value):
    if value is None:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ReportError("A source timestamp has no time zone.")
    return parsed.astimezone(timezone.utc)


def iso(value):
    return timestamp(value).isoformat().replace("+00:00", "Z") if value else None


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def followup_window(inputs, round_info):
    if "## Follow-up collection" not in inputs["protocol"] or "18:10 America/New_York" not in inputs["protocol"]:
        raise ReportError("The public follow-up collection note is missing.")
    window = (round_info or {}).get("followup") or {}
    start, stop = timestamp(window.get("startedAt")), timestamp(window.get("stopAt"))
    if not start or start < CUTOFF or start >= FOLLOWUP_CUTOFF or stop != FOLLOWUP_CUTOFF:
        raise ReportError("The follow-up has no confirmed resume time and matching 18:10 hard stop.")
    return start, stop


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf8")


def git_commit(path, first=False):
    args = ["git", "log", "--format=%H"]
    args += ["--reverse"] if first else ["-1"]
    try:
        lines = subprocess.check_output(args + ["--", path], cwd=ROOT, stderr=subprocess.DEVNULL, text=True).splitlines()
        return lines[0] if lines else None
    except (OSError, subprocess.CalledProcessError):
        return None


def load_inputs(root=ROOT):
    protocol = (root / "data/PREREGISTRATION.md").read_text(encoding="utf8")
    if "17:30 America/New_York on October 24, 2026" not in protocol:
        raise ReportError("The registered cutoff is unsupported; review the current protocol before reporting.")
    hashes, parsed = {}, {}
    for name in REGISTERED:
        raw = (root / "data" / name).read_bytes()
        matches = re.findall(r"^\| " + re.escape(name) + r" \| ([a-f0-9]{64}) \|$", protocol, re.MULTILINE)
        if len(matches) != 1 or digest(raw) != matches[0]:
            raise ReportError(f"Registered checksum mismatch: {name}.")
        hashes[name] = matches[0]
        if name.endswith(".json"):
            parsed[name] = json.loads(raw)
    cases = {}
    for record in parsed["cases.frozen.json"]:
        card_id = record["card"]["id"]
        if card_id in cases:
            raise ReportError("Frozen cases contain repeated identifiers.")
        cases[card_id] = {"set_name": record["set_name"], "expected": record.get("expected", {}).get("decision")}
    assignment = parsed["assignment.json"]
    n, cards = assignment["participants"], assignment["cards_per_reviewer"]
    if n != 11 or cards != 8 or assignment["cases_sha256"] != hashes["cases.frozen.json"]:
        raise ReportError("Only the registered eleven-person, eight-card design is supported.")
    primary = sorted((s for s in assignment["slots"] if not s["overflow"]), key=lambda s: s["slot"])
    if [s["slot"] for s in primary] != list(range(1, n + 1)):
        raise ReportError("Primary reviewer slots differ from the registered design.")
    counts = {key: 0 for key in cases}
    for slot in primary:
        ids = slot["case_ids"]
        if len(ids) != cards or len(set(ids)) != cards or any(key not in cases for key in ids):
            raise ReportError("A primary assignment has unknown, repeated or missing cards.")
        sets = [cases[key]["set_name"] for key in ids]
        if [sets.count(s) for s in ("eval", "dev", "gold")] != [5, 2, 1]:
            raise ReportError("A primary assignment has a different case split.")
        for key in ids:
            counts[key] += 1
    evaluation = sorted(key for key, c in cases.items() if c["set_name"] == "eval")
    development = sorted(key for key, c in cases.items() if c["set_name"] == "dev")
    if len(cases) != 53 or len(evaluation) != 27 or len(development) != 22 or sorted(counts[k] for k in evaluation) != [2] * 26 + [3] or any(counts[k] != 1 for k in development):
        raise ReportError("Frozen assignment coverage differs from the registered design.")
    baseline = parsed["decisions_v1.json"]
    if sorted(r["case_id"] for r in baseline) != sorted(evaluation + development) or any(r["decision"] not in DECISIONS for r in baseline):
        raise ReportError("The frozen baseline does not cover the exact prepared cases.")
    config = parsed["prepared-review.config.json"]
    if config["policy_sha256"] != hashes["policy.v1.md"] or config["cases_sha256"] != hashes["cases.frozen.json"] or sorted(config["case_ids"]) != sorted(evaluation + development) or config["decision_options"]["limits"]["maxRefundCents"] != 19900:
        raise ReportError("Prepared decision configuration differs from the frozen inputs.")
    return {"cases": cases, "assignment": assignment, "primary": primary,
            "evaluation": evaluation, "development": development,
            "baseline": {r["case_id"]: r for r in baseline}, "hashes": hashes,
            "protocol_sha256": digest(protocol.encode()), "protocol": protocol,
            "amendment_1": "## Amendment 1" in protocol}


def database_url():
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf8").splitlines():
            match = re.match(r"^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$", line)
            if match:
                values = shlex.split(match[1], comments=True)
                if len(values) == 1:
                    return values[0]
    raise ReportError("DATABASE_URL is missing. Configure it in the host environment or ignored .env.local.")


@contextmanager
def read_database():
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(database_url(), connect_timeout=15, row_factory=dict_row,
                         application_name="refund_analysis") as connection:
        connection.read_only = True
        connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with connection.transaction():
            yield connection
