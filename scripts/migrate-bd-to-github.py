#!/usr/bin/env python3
"""Migrate active Beads issues to GitHub Issues.

Default mode is dry-run (no GitHub writes). Pass --execute to create issues.

Usage:
  python3 scripts/migrate-bd-to-github.py
  python3 scripts/migrate-bd-to-github.py --limit 5
  python3 scripts/migrate-bd-to-github.py --ids-file scripts/migrate-allowlist.txt
  python3 scripts/migrate-bd-to-github.py --ids-file scripts/migrate-allowlist.txt --execute
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BEADS_DIR = REPO_ROOT / ".beads"
ISSUES_JSONL = BEADS_DIR / "issues.jsonl"
MAP_PATH = BEADS_DIR / "migration-map.json"
DRYRUN_PATH = BEADS_DIR / "migration-dryrun.md"

ACTIVE_STATUSES = frozenset({"open", "in_progress", "deferred"})

STATUS_LABELS = {
    "in_progress": "in-progress",
    "deferred": "deferred",
}

TYPE_LABELS = {
    "feature": "type:feature",
    "task": "type:task",
    "bug": "type:bug",
    "epic": "type:epic",
    "decision": "type:decision",
    "chore": "type:chore",
}

# Label colors (GitHub hex without #)
LABEL_COLORS = {
    "in-progress": "fbca04",
    "deferred": "d4c5f9",
    "p0": "b60205",
    "p1": "d93f0b",
    "p2": "fbca04",
    "p3": "0e8a16",
    "p4": "cfd3d7",
    "type:feature": "1d76db",
    "type:task": "5319e7",
    "type:bug": "d73a4a",
    "type:epic": "3e4b9e",
    "type:decision": "006b75",
    "type:chore": "e4e669",
    "v1": "0052cc",
    "dx": "bfd4f2",
    "validation": "c2e0c6",
    "docs": "0075ca",
    "examples": "a2eeef",
    "ioc": "f9d0c4",
    "zod": "fef2c0",
    "wayfinder:map": "e99695",
}


def run(
    args: list[str],
    *,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        check=check,
        text=True,
        capture_output=True,
        input=input_text,
    )


def load_jsonl() -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    with ISSUES_JSONL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            iid = row.get("id")
            if iid:
                by_id[iid] = row
    return by_id


def bd_show(issue_id: str) -> dict[str, Any]:
    proc = run(["bd", "show", issue_id, "--json"])
    data = json.loads(proc.stdout)
    if isinstance(data, list):
        if not data:
            raise RuntimeError(f"bd show returned empty list for {issue_id}")
        return data[0]
    return data


def reconstruct_dependents(all_issues: dict[str, dict[str, Any]]) -> None:
    """Attach a dependents[] list to each issue by reverse-scanning dependencies."""
    dependents: dict[str, list[dict[str, Any]]] = {iid: [] for iid in all_issues}
    for issue in all_issues.values():
        for dep in issue.get("dependencies") or []:
            target = dep.get("depends_on_id")
            if not target or target not in dependents:
                continue
            dependents[target].append(
                {
                    "id": issue["id"],
                    "title": issue.get("title"),
                    "status": issue.get("status"),
                    "dependency_type": dep.get("type"),
                }
            )
    for iid, deps in dependents.items():
        all_issues[iid]["dependents"] = deps


def enrich_from_jsonl(
    issue_id: str,
    all_issues: dict[str, dict[str, Any]],
    *,
    comments_cache: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Build a bd-show-shaped record from jsonl without touching the dolt lock."""
    record = dict(all_issues[issue_id])
    record["id"] = issue_id
    # Normalize dependency shape to match bd show (id + dependency_type)
    norm_deps: list[dict[str, Any]] = []
    for dep in record.get("dependencies") or []:
        tid = dep.get("depends_on_id") or dep.get("id")
        if not tid:
            continue
        target = all_issues.get(tid, {})
        norm_deps.append(
            {
                "id": tid,
                "title": target.get("title"),
                "status": target.get("status"),
                "dependency_type": dep.get("type") or dep.get("dependency_type"),
            }
        )
    record["dependencies"] = norm_deps
    # Parent from parent-child dependency if not set
    if not record.get("parent"):
        for dep in norm_deps:
            if dep.get("dependency_type") == "parent-child":
                record["parent"] = dep["id"]
                break
    record["comments"] = comments_cache.get(issue_id, [])
    return record


def load_comments_cache(path: Path | None) -> dict[str, list[dict[str, Any]]]:
    if not path or not path.exists():
        return {}
    data = json.loads(path.read_text())
    # Allow {id: [comments]}, {id: {comments: [...]}}, or a bare list (legacy)
    if isinstance(data, list):
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    for k, v in data.items():
        if isinstance(v, list):
            out[k] = v
        elif isinstance(v, dict) and isinstance(v.get("comments"), list):
            out[k] = v["comments"]
    return out


def load_map() -> dict[str, int]:
    if not MAP_PATH.exists():
        return {}
    data = json.loads(MAP_PATH.read_text())
    return {k: int(v) for k, v in data.get("bd_to_gh", {}).items()}


def save_map(bd_to_gh: dict[str, int], *, mode: str) -> None:
    payload = {
        "mode": mode,
        "repo": None,  # filled by caller if desired
        "bd_to_gh": dict(sorted(bd_to_gh.items(), key=lambda kv: kv[1])),
    }
    MAP_PATH.write_text(json.dumps(payload, indent=2) + "\n")


def compute_labels(issue: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    priority = issue.get("priority")
    if priority is not None:
        labels.append(f"p{priority}")
    issue_type = issue.get("issue_type")
    if issue_type in TYPE_LABELS:
        labels.append(TYPE_LABELS[issue_type])
    status = issue.get("status")
    if status in STATUS_LABELS:
        labels.append(STATUS_LABELS[status])
    for lab in issue.get("labels") or []:
        if lab not in labels:
            labels.append(lab)
    return labels


def dep_id(item: dict[str, Any]) -> str | None:
    return item.get("id") or item.get("depends_on_id")


def dep_type(item: dict[str, Any]) -> str | None:
    return item.get("dependency_type") or item.get("type")


def resolve_ref(
    target_id: str | None,
    bd_to_gh: dict[str, int],
    all_issues: dict[str, dict[str, Any]],
) -> str:
    if not target_id:
        return "`(unknown)`"
    if target_id in bd_to_gh:
        return f"#{bd_to_gh[target_id]}"
    status = all_issues.get(target_id, {}).get("status")
    if status == "closed":
        return f"`{target_id}` (closed in bd, not migrated)"
    return f"`{target_id}` (not migrated)"


def collect_relationships(
    issue: dict[str, Any],
) -> dict[str, list[str]]:
    """Return bd-id lists keyed by relationship section name."""
    rel: dict[str, list[str]] = {
        "Parent": [],
        "Children": [],
        "Blocks": [],
        "Blocked by": [],
        "Discovered from": [],
        "Discovered": [],
        "Supersedes": [],
        "Superseded by": [],
    }

    parent = issue.get("parent")
    if isinstance(parent, str) and parent:
        rel["Parent"].append(parent)
    elif isinstance(parent, dict) and parent.get("id"):
        rel["Parent"].append(parent["id"])

    for dep in issue.get("dependencies") or []:
        tid = dep_id(dep)
        dtype = dep_type(dep)
        if not tid or not dtype:
            continue
        if dtype == "parent-child":
            if tid not in rel["Parent"]:
                rel["Parent"].append(tid)
        elif dtype == "blocks":
            # This issue depends on tid; tid blocks this issue.
            rel["Blocked by"].append(tid)
        elif dtype == "blocked-by":
            rel["Blocks"].append(tid)
        elif dtype == "discovered-from":
            rel["Discovered from"].append(tid)
        elif dtype == "supersedes":
            # This issue supersedes tid? Convention varies; beads "supersedes"
            # on dependencies usually means depends_on was superseded by this,
            # or this supersedes depends_on. Treat as Supersedes target.
            rel["Supersedes"].append(tid)

    for dep in issue.get("dependents") or []:
        tid = dep_id(dep)
        dtype = dep_type(dep)
        if not tid or not dtype:
            continue
        if dtype == "parent-child":
            rel["Children"].append(tid)
        elif dtype == "blocks":
            # Dependent depends on this with type blocks → this blocks dependent.
            rel["Blocks"].append(tid)
        elif dtype == "blocked-by":
            rel["Blocked by"].append(tid)
        elif dtype == "discovered-from":
            rel["Discovered"].append(tid)
        elif dtype == "supersedes":
            rel["Superseded by"].append(tid)

    # Deduplicate while preserving order
    for key, ids in list(rel.items()):
        seen: set[str] = set()
        out: list[str] = []
        for i in ids:
            if i not in seen:
                seen.add(i)
                out.append(i)
        rel[key] = out
    return rel


def format_relationships(
    rel: dict[str, list[str]],
    bd_to_gh: dict[str, int],
    all_issues: dict[str, dict[str, Any]],
) -> str:
    lines: list[str] = []
    for section, ids in rel.items():
        if not ids:
            continue
        refs = [resolve_ref(i, bd_to_gh, all_issues) for i in ids]
        lines.append(f"- **{section}:** {', '.join(refs)}")
    if not lines:
        return ""
    return "## Relationships\n\n" + "\n".join(lines) + "\n"


def build_body(
    issue: dict[str, Any],
    *,
    bd_to_gh: dict[str, int] | None = None,
    all_issues: dict[str, dict[str, Any]] | None = None,
    include_relationships: bool = False,
) -> str:
    parts: list[str] = []
    desc = (issue.get("description") or "").strip()
    if desc:
        parts.append(desc)

    design = (issue.get("design") or "").strip()
    if design:
        parts.append("## Design\n\n" + design)

    ac = (issue.get("acceptance_criteria") or "").strip()
    if ac:
        parts.append("## Acceptance Criteria\n\n" + ac)

    notes = (issue.get("notes") or "").strip()
    if notes:
        parts.append("## Notes\n\n" + notes)

    if include_relationships and bd_to_gh is not None and all_issues is not None:
        rel = collect_relationships(issue)
        rel_md = format_relationships(rel, bd_to_gh, all_issues)
        if rel_md:
            parts.append(rel_md.rstrip())

    parts.append(f"<sub>bd: {issue['id']}</sub>")
    return "\n\n".join(parts) + "\n"


def format_comment(comment: dict[str, Any]) -> str:
    author = comment.get("author") or "unknown"
    created = comment.get("created_at") or comment.get("created") or ""
    text = (comment.get("text") or comment.get("body") or "").rstrip()
    header = f"_Migrated from bd — **{author}**"
    if created:
        header += f", {created}"
    header += "_\n\n"
    return header + text + "\n"


def ensure_labels(repo: str, labels: set[str], *, execute: bool) -> None:
    if not execute:
        return
    for name in sorted(labels):
        color = LABEL_COLORS.get(name, "ededed")
        proc = run(
            [
                "gh",
                "label",
                "create",
                name,
                "--repo",
                repo,
                "--color",
                color,
                "--force",
            ],
            check=False,
        )
        if proc.returncode != 0 and "already exists" not in (proc.stderr or "").lower():
            # --force updates; some gh versions error differently — ignore exists
            if "HTTP 422" not in (proc.stderr or "") and "already" not in (
                proc.stderr or ""
            ).lower():
                print(f"  warn: label create {name!r}: {proc.stderr.strip()}", file=sys.stderr)


def create_issue(
    repo: str,
    title: str,
    body: str,
    labels: list[str],
) -> int:
    args = [
        "gh",
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        body,
    ]
    for lab in labels:
        args.extend(["--label", lab])
    proc = run(args)
    # URL like https://github.com/owner/repo/issues/123
    url = proc.stdout.strip()
    number = int(url.rstrip("/").split("/")[-1])
    return number


def edit_issue_body(repo: str, number: int, body: str) -> None:
    run(
        [
            "gh",
            "issue",
            "edit",
            str(number),
            "--repo",
            repo,
            "--body",
            body,
        ]
    )


def add_comment(repo: str, number: int, body: str) -> None:
    run(
        [
            "gh",
            "issue",
            "comment",
            str(number),
            "--repo",
            repo,
            "--body",
            body,
        ]
    )


def add_sub_issue(repo: str, parent_number: int, child_number: int) -> bool:
    """Wire parent/child via GraphQL addSubIssue. Returns False on failure."""
    owner, name = repo.split("/", 1)
    # Resolve node IDs
    q = """
    query($owner: String!, $name: String!, $parent: Int!, $child: Int!) {
      repository(owner: $owner, name: $name) {
        parent: issue(number: $parent) { id }
        child: issue(number: $child) { id }
      }
    }
    """
    proc = run(
        [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={q}",
            "-F",
            f"owner={owner}",
            "-F",
            f"name={name}",
            "-F",
            f"parent={parent_number}",
            "-F",
            f"child={child_number}",
        ],
        check=False,
    )
    if proc.returncode != 0:
        return False
    try:
        data = json.loads(proc.stdout)
        parent_id = data["data"]["repository"]["parent"]["id"]
        child_id = data["data"]["repository"]["child"]["id"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return False

    mut = """
    mutation($parentId: ID!, $childId: ID!) {
      addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
        issue { number }
      }
    }
    """
    proc2 = run(
        [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={mut}",
            "-f",
            f"parentId={parent_id}",
            "-f",
            f"childId={child_id}",
        ],
        check=False,
    )
    return proc2.returncode == 0


def detect_repo(cli_repo: str | None) -> str:
    if cli_repo:
        return cli_repo
    proc = run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    return proc.stdout.strip()


def load_ids_file(path: Path) -> list[str]:
    """Load bd issue ids from a text file (one per line; # comments / blank ok)."""
    ids: list[str] = []
    seen: set[str] = set()
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line in seen:
            continue
        seen.add(line)
        ids.append(line)
    return ids


def write_dryrun_report(
    issues: list[dict[str, Any]],
    bd_to_gh: dict[str, int],
    all_issues: dict[str, dict[str, Any]],
    label_set: set[str],
    closed_target_refs: Counter[str],
) -> None:
    lines: list[str] = [
        "# bd → GitHub Issues dry-run",
        "",
        f"- Active issues to migrate: **{len(issues)}**",
        f"- Labels to ensure: {', '.join(f'`{l}`' for l in sorted(label_set))}",
        f"- Closed-target relationship refs: **{sum(closed_target_refs.values())}** "
        f"({len(closed_target_refs)} unique bd ids)",
        "",
        "## Closed targets referenced",
        "",
    ]
    if closed_target_refs:
        for tid, n in closed_target_refs.most_common():
            lines.append(f"- `{tid}` × {n}")
    else:
        lines.append("_none_")

    lines.extend(["", "---", ""])

    for issue in issues:
        iid = issue["id"]
        number = bd_to_gh[iid]
        labels = compute_labels(issue)
        body = build_body(
            issue,
            bd_to_gh=bd_to_gh,
            all_issues=all_issues,
            include_relationships=True,
        )
        comments = issue.get("comments") or []
        lines.append(f"## Placeholder #{number}: {issue['title']}")
        lines.append("")
        lines.append(f"- **bd id:** `{iid}`")
        lines.append(f"- **status:** `{issue.get('status')}`")
        lines.append(f"- **labels:** {', '.join(f'`{l}`' for l in labels)}")
        lines.append(f"- **comments:** {len(comments)}")
        lines.append("")
        lines.append("### Body")
        lines.append("")
        lines.append("```markdown")
        lines.append(body.rstrip())
        lines.append("```")
        lines.append("")
        if comments:
            lines.append("### Comments")
            lines.append("")
            for c in comments:
                lines.append("```markdown")
                lines.append(format_comment(c).rstrip())
                lines.append("```")
                lines.append("")
        lines.append("---")
        lines.append("")

    DRYRUN_PATH.write_text("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Create/update GitHub issues (default is dry-run)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only process the first N active issues (after stable sort)",
    )
    parser.add_argument(
        "--ids-file",
        default=None,
        help="Only migrate bd ids listed in this file (triage allowlist)",
    )
    parser.add_argument(
        "--from-jsonl",
        action="store_true",
        default=True,
        help="Enrich from issues.jsonl (default; avoids bd dolt lock)",
    )
    parser.add_argument(
        "--bd-show",
        action="store_true",
        help="Enrich via bd show (needs exclusive dolt lock)",
    )
    parser.add_argument(
        "--comments-cache",
        default=None,
        help="JSON file mapping bd id → comments[] (used with --from-jsonl)",
    )
    parser.add_argument(
        "--repo",
        default=None,
        help="GitHub repo (owner/name). Default: gh repo view",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.35,
        help="Seconds between GitHub API writes (execute mode)",
    )
    args = parser.parse_args()
    execute = args.execute
    mode = "execute" if execute else "dry-run"
    use_bd_show = bool(args.bd_show)

    if not ISSUES_JSONL.exists():
        print(f"error: missing {ISSUES_JSONL}", file=sys.stderr)
        return 1

    repo = detect_repo(args.repo)
    all_issues = load_jsonl()
    reconstruct_dependents(all_issues)

    if args.ids_file:
        allow = load_ids_file(Path(args.ids_file))
        allow_set = set(allow)
        missing = sorted(allow_set - set(all_issues))
        if missing:
            print(f"error: ids-file references unknown ids: {missing}", file=sys.stderr)
            return 1
        # Triage allowlist wins even if bd status drifted to closed
        closed_in_allow = [
            iid for iid in allow if all_issues[iid].get("status") == "closed"
        ]
        if closed_in_allow:
            print(
                f"warn: allowlist includes closed bd ids (still migrating): {closed_in_allow}",
                file=sys.stderr,
            )
        active_ids = list(allow)
        print(f"ids-file={args.ids_file} allowlisted={len(allow)} selected={len(active_ids)}")
    else:
        active_ids = [
            iid
            for iid, row in all_issues.items()
            if row.get("status") in ACTIVE_STATUSES
        ]
        active_ids.sort()

    if args.limit and args.limit > 0:
        active_ids = active_ids[: args.limit]

    print(f"mode={mode} repo={repo} active={len(active_ids)} enrich={'bd-show' if use_bd_show else 'jsonl'}")

    comments_cache = load_comments_cache(
        Path(args.comments_cache) if args.comments_cache else None
    )
    # Built-in fallback for the one known commented migrate issue
    default_comments = Path("/tmp/bd-9jk-comments.json")
    if "jsonschema-form-9jk" not in comments_cache and default_comments.exists():
        comments_cache["jsonschema-form-9jk"] = json.loads(default_comments.read_text())

    enriched: list[dict[str, Any]] = []
    for i, iid in enumerate(active_ids, 1):
        print(f"  [{i}/{len(active_ids)}] {iid}", flush=True)
        if use_bd_show:
            record = bd_show(iid)
            record["id"] = record.get("id") or iid
        else:
            record = enrich_from_jsonl(iid, all_issues, comments_cache=comments_cache)
        enriched.append(record)

    # Stable create order: parents before children when possible (topological-ish)
    # Simple heuristic: fewer dots in id first, then lexicographic
    enriched.sort(key=lambda x: (x["id"].count("."), x["id"]))

    existing_map = load_map()
    # In dry-run, always rebuild placeholder numbers for the selected set so
    # the report is self-contained. In execute, preserve already-created ids.
    bd_to_gh: dict[str, int] = dict(existing_map) if execute else {}

    label_set: set[str] = set()
    for issue in enriched:
        label_set.update(compute_labels(issue))

    print(f"labels ({len(label_set)}): {', '.join(sorted(label_set))}")
    ensure_labels(repo, label_set, execute=execute)

    # Pass 1: create issues (body without relationships)
    next_placeholder = 1
    created = 0
    skipped = 0
    for issue in enriched:
        iid = issue["id"]
        labels = compute_labels(issue)
        title = issue["title"]
        body_pass1 = build_body(issue, include_relationships=False)

        if execute:
            if iid in bd_to_gh:
                print(f"  skip create {iid} → #{bd_to_gh[iid]} (already mapped)")
                skipped += 1
                continue
            number = create_issue(repo, title, body_pass1, labels)
            bd_to_gh[iid] = number
            created += 1
            print(f"  created {iid} → #{number}")
            save_map(bd_to_gh, mode=mode)
            time.sleep(args.sleep)
        else:
            # Assign contiguous placeholders in create order
            while next_placeholder in bd_to_gh.values():
                next_placeholder += 1
            bd_to_gh[iid] = next_placeholder
            print(f"  dry-run {iid} → #{next_placeholder}")
            next_placeholder += 1

    # Track closed-target refs
    closed_target_refs: Counter[str] = Counter()
    for issue in enriched:
        rel = collect_relationships(issue)
        for ids in rel.values():
            for tid in ids:
                if tid not in bd_to_gh and all_issues.get(tid, {}).get("status") == "closed":
                    closed_target_refs[tid] += 1

    # Pass 2: relationships, sub-issues, comments
    print("Pass 2: relationships / comments …")
    sub_ok = 0
    sub_fail = 0
    comments_posted = 0
    for issue in enriched:
        iid = issue["id"]
        number = bd_to_gh[iid]
        body_full = build_body(
            issue,
            bd_to_gh=bd_to_gh,
            all_issues=all_issues,
            include_relationships=True,
        )
        comments = issue.get("comments") or []

        if execute:
            edit_issue_body(repo, number, body_full)
            time.sleep(args.sleep)

            # Sub-issues: for each child of this issue, wire parent→child
            rel = collect_relationships(issue)
            for child_id in rel["Children"]:
                if child_id not in bd_to_gh:
                    continue
                ok = add_sub_issue(repo, number, bd_to_gh[child_id])
                if ok:
                    sub_ok += 1
                else:
                    sub_fail += 1
                time.sleep(args.sleep)

            for comment in comments:
                add_comment(repo, number, format_comment(comment))
                comments_posted += 1
                time.sleep(args.sleep)
        else:
            # dry-run: nothing to write to GH
            pass

    save_map(
        {iid: bd_to_gh[iid] for iid in (i["id"] for i in enriched)},
        mode=mode,
    )
    # Restore full map on execute (include previously mapped ids outside limit)
    if execute:
        merged = dict(existing_map)
        merged.update(bd_to_gh)
        save_map(merged, mode=mode)
        # stash repo
        data = json.loads(MAP_PATH.read_text())
        data["repo"] = repo
        MAP_PATH.write_text(json.dumps(data, indent=2) + "\n")
    else:
        data = json.loads(MAP_PATH.read_text()) if MAP_PATH.exists() else {}
        data = {
            "mode": mode,
            "repo": repo,
            "bd_to_gh": dict(
                sorted(
                    ((i["id"], bd_to_gh[i["id"]]) for i in enriched),
                    key=lambda kv: kv[1],
                )
            ),
        }
        MAP_PATH.write_text(json.dumps(data, indent=2) + "\n")
        write_dryrun_report(
            enriched, bd_to_gh, all_issues, label_set, closed_target_refs
        )

    print()
    print("=== summary ===")
    print(f"mode:                 {mode}")
    print(f"repo:                 {repo}")
    print(f"issues processed:     {len(enriched)}")
    if execute:
        print(f"created:              {created}")
        print(f"skipped (mapped):     {skipped}")
        print(f"sub-issues ok/fail:   {sub_ok}/{sub_fail}")
        print(f"comments posted:      {comments_posted}")
    else:
        print(f"dry-run report:       {DRYRUN_PATH}")
    print(f"migration map:        {MAP_PATH}")
    print(f"labels:               {len(label_set)}")
    print(f"closed-target refs:   {sum(closed_target_refs.values())} "
          f"({len(closed_target_refs)} unique)")
    if closed_target_refs:
        for tid, n in closed_target_refs.most_common(10):
            print(f"  - {tid} × {n}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as e:
        print(e.stderr or e.stdout or str(e), file=sys.stderr)
        raise SystemExit(e.returncode)
