"""Run the synthetic book through the live model, end to end, over the HTTP API.

For every seeded file: underwrite it, clear any held fields as an officer would
(CONFIRM), then run the multi-agent review (delegate_task), the decision
explanation and one question. The model only reads and explains; every verdict
and figure comes from the deterministic engines. Results are written as they
arrive to var/nemotron-demo/ (git-ignored): results.json and report.md.

  .venv\\Scripts\\python scripts\\nemotron_demo.py [--base http://127.0.0.1:4180] [--only RCL-2026-0418] [--parallel 2]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, List

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "var" / "nemotron-demo"
QUESTION = (
    "Walk me through why this file got its decision: the reason codes that drove it, the figures behind them, "
    "and anything in the evidence or reconciliation I should double-check. Cite where each fact comes from."
)
PER_FILE_LIMIT_S = 1800


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


async def record_of(client: httpx.AsyncClient, app_id: str) -> Dict[str, Any]:
    r = await client.get(f"/api/applications/{app_id}")
    r.raise_for_status()
    return r.json()["record"] or {}


async def run_file(client: httpx.AsyncClient, app: Dict[str, Any]) -> Dict[str, Any]:
    app_id = app["id"]
    out: Dict[str, Any] = {"id": app_id, "borrower": app["borrower_name"], "segment": app["segment"]}
    started = time.perf_counter()
    try:
        r = await client.post(f"/api/applications/{app_id}/underwrite", json={"paced": False})
        r.raise_for_status()
        rec = await record_of(client, app_id)
        if rec.get("status") == "WAITING_FOR_OFFICER":
            held = [h["path"] for h in (rec.get("assist") or {}).get("queue", [])]
            log(f"{app_id} held {len(held)} field(s); confirming as the officer")
            r = await client.post(
                f"/api/applications/{app_id}/resume",
                json={
                    "paced": False,
                    "resolutions": [
                        {"path": p, "action": "CONFIRM", "by": "demo-officer", "note": "Checked against the source document."}
                        for p in held
                    ],
                },
            )
            r.raise_for_status()
            out["officer_confirmed"] = held
            rec = await record_of(client, app_id)

        decision = rec.get("decision") or {}
        out.update(
            status=rec.get("status"),
            decision=decision.get("decision"),
            reason_codes=[c.get("code") for c in decision.get("reason_codes", [])],
            headline=rec.get("headline"),
        )
        if not out["decision"]:
            out["note"] = "no decision; agents skipped"
            return out
        log(f"{app_id} {out['decision']} — starting review + explain on the model")

        ids = {}
        for kind in ("review", "explain"):
            r = await client.post(f"/api/applications/{app_id}/agent/{kind}")
            r.raise_for_status()
            ids[kind] = r.json()["id"]
        # Ask while the review and explanation run; all three read the same record.
        ask_task = asyncio.create_task(client.post(f"/api/applications/{app_id}/agent/ask", json={"question": QUESTION}))

        pending = dict(ids)
        while pending and time.perf_counter() - started < PER_FILE_LIMIT_S:
            await asyncio.sleep(4)
            runs = (await client.get(f"/api/applications/{app_id}/agent-runs")).json()
            for kind, rid in list(pending.items()):
                run = next((x for x in runs if x["id"] == rid), None)
                if run and run["status"] != "RUNNING":
                    out[kind] = run
                    pending.pop(kind)
                    log(f"{app_id} {kind} {run['status']}")
        for kind in pending:
            out[kind] = {"status": "TIMEOUT"}

        r = await ask_task
        out["ask"] = r.json() if r.status_code == 200 else {"status": "FAILED", "error": r.json().get("error")}
        log(f"{app_id} ask {out['ask'].get('status')}")
    except Exception as exc:  # keep going; one file's failure is reported, not fatal
        out["error"] = f"{type(exc).__name__}: {exc}"
        log(f"{app_id} ERROR {out['error']}")
    out["seconds"] = round(time.perf_counter() - started, 1)
    return out


def _tokens(*runs: Any) -> int:
    total = 0
    for run in runs:
        o = (run or {}).get("output") or {}
        total += sum(int(v or 0) for v in (o.get("usage") or {}).values())
        for child in o.get("children") or []:
            total += sum(int(v or 0) for v in (child.get("usage") or {}).values())
    return total


def report(results: List[Dict[str, Any]], llm: Dict[str, Any]) -> str:
    lines = [
        "# RECALLER — synthetic book on the live model",
        "",
        f"Model: **{llm.get('provider')} · {llm.get('model')}** at {llm.get('host') or '—'}  ",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')}. Verdicts and figures come from the deterministic engines; "
        "the model reviewed, explained and answered questions only.",
        "",
        "| File | Borrower | Decision | Review | Explanation | Q&A grounded | Seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    for f in results:
        review = f.get("review") or {}
        explain = f.get("explain") or {}
        ask = (f.get("ask") or {}).get("output") or {}
        rev_out = review.get("output") or {}
        lines.append(
            f"| {f['id']} | {f['borrower']} | {f.get('decision') or f.get('status') or '—'} | "
            f"{review.get('status', '—')} · {len(rev_out.get('findings') or [])} finding(s) | "
            f"{explain.get('status', '—')} · {((explain.get('output') or {}).get('source') or '—')} | "
            f"{'yes' if ask.get('grounded') else ('no' if ask else '—')} | {f.get('seconds')} |"
        )
    for f in results:
        lines += ["", f"## {f['id']} — {f['borrower']} ({f.get('segment')})", ""]
        if f.get("error"):
            lines += [f"**Error:** {f['error']}", ""]
        lines += [
            f"**Decision:** {f.get('decision')} · reason codes {', '.join(f.get('reason_codes') or []) or '—'}  ",
            f"**Headline (engine):** {f.get('headline')}",
        ]
        if f.get("officer_confirmed"):
            lines.append(f"  \n**Officer confirmed:** {', '.join(f['officer_confirmed'])}")

        rev = f.get("review") or {}
        ro = rev.get("output") or {}
        syn = ro.get("synthesis") or {}
        lines += ["", f"### Multi-agent review — {rev.get('status', '—')}"]
        if rev.get("error"):
            lines.append(f"Error: {rev['error']}")
        if syn:
            lines += ["", syn.get("summary") or "", ""]
            lines += [f"- {p}" for p in syn.get("priorities") or []]
            if syn.get("accepted") is False:
                lines.append(f"\n_Synthesis replaced by the deterministic summary ({syn.get('error') or syn.get('unsupported_numbers')})._")
        for fd in ro.get("findings") or []:
            lines.append(
                f"- **[{fd.get('area')} · {fd.get('severity')}]** {fd.get('title')} — {fd.get('detail')}"
                f"{'' if fd.get('grounded') else ' _(cites a path not in the record)_'}"
            )

        ex = f.get("explain") or {}
        eo = ex.get("output") or {}
        exp = eo.get("explanation") or {}
        lines += ["", f"### Explanation — {ex.get('status', '—')} · source: {eo.get('source', '—')}"]
        if eo.get("rejected_reason"):
            lines.append(f"_Model text rejected: {eo['rejected_reason']}_")
        if exp:
            lines += ["", f"**{exp.get('headline')}**", ""] + [p for p in exp.get("paragraphs") or []]

        ask = f.get("ask") or {}
        ao = ask.get("output") or {}
        lines += ["", f"### Q&A — {ask.get('status', '—')}", "", f"> {QUESTION}", ""]
        if ask.get("error"):
            lines.append(f"Error: {ask['error']}")
        if ao:
            lines += [ao.get("answer") or "", ""]
            tools = ", ".join(dict.fromkeys(c["name"] for c in ao.get("tool_calls") or [])) or "none"
            lines.append(
                f"_Tools used: {tools} · grounded: {'yes' if ao.get('grounded') else 'no ' + str(ao.get('unsupported_numbers'))}"
                f" · {ao.get('iterations')} turn(s)_"
            )
            if ao.get("reasoning"):
                excerpt = ao["reasoning"][:1200] + ("…" if len(ao["reasoning"]) > 1200 else "")
                lines += ["", "<details><summary>Model reasoning</summary>", "", excerpt, "", "</details>"]
        lines += ["", f"_Model tokens for this file: {_tokens(f.get('review'), f.get('explain'), f.get('ask'))} · {f.get('seconds')} s_"]
    return "\n".join(lines) + "\n"


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default="http://127.0.0.1:4180")
    ap.add_argument("--only", nargs="*", help="application ids (default: every seeded file)")
    ap.add_argument("--parallel", type=int, default=2)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(base_url=args.base, timeout=httpx.Timeout(900.0, connect=10.0)) as client:
        llm = (await client.get("/api/health")).json()["llm"]
        if not llm.get("enabled"):
            raise SystemExit("The backend has no model configured; see .env.example.")
        log(f"model: {llm.get('provider')} · {llm.get('model')} at {llm.get('host')}")
        apps = [a for a in (await client.get("/api/applications")).json() if not a.get("custom")]
        if args.only:
            apps = [a for a in apps if a["id"] in args.only]
        log(f"{len(apps)} file(s), {args.parallel} at a time")

        results: Dict[str, Dict[str, Any]] = {}
        gate = asyncio.Semaphore(max(1, args.parallel))

        async def one(app: Dict[str, Any]) -> None:
            async with gate:
                results[app["id"]] = await run_file(client, app)
                ordered = [results[a["id"]] for a in apps if a["id"] in results]
                (OUT / "results.json").write_text(json.dumps({"llm": llm, "files": ordered}, indent=2, default=str), encoding="utf-8")
                (OUT / "report.md").write_text(report(ordered, llm), encoding="utf-8")

        await asyncio.gather(*(one(a) for a in apps))
    log(f"done → {OUT / 'report.md'}")


if __name__ == "__main__":
    asyncio.run(main())
