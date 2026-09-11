"""Verify Python server endpoints and static file serving."""

import json
import threading
import time
import urllib.request
import uvicorn
from recaller.app.server import app

def test_server():
    t = threading.Thread(target=lambda: uvicorn.run(app, host="127.0.0.1", port=4189, log_level="error"), daemon=True)
    t.start()
    time.sleep(1.5)

    # 1. Health check
    res = urllib.request.urlopen("http://127.0.0.1:4189/api/health")
    health = json.loads(res.read().decode())
    print("Health check:", health)
    assert health["status"] == "ok"

    # 2. List applications
    res = urllib.request.urlopen("http://127.0.0.1:4189/api/applications")
    apps = json.loads(res.read().decode())
    print(f"Applications loaded: {len(apps)}")
    assert len(apps) == 8

    # 3. Underwrite Rahul Sharma
    req = urllib.request.Request(
        "http://127.0.0.1:4189/api/applications/RCL-2026-0418/underwrite",
        data=json.dumps({"paced": False}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    res = urllib.request.urlopen(req)
    rec = json.loads(res.read().decode())
    print("Underwriting result:", rec["decision"]["decision"], "Reason codes:", [c["code"] for c in rec["decision"]["reason_codes"]])
    assert rec["decision"]["decision"] == "APPROVE"

    # 4. Replay
    req = urllib.request.Request(
        "http://127.0.0.1:4189/api/applications/RCL-2026-0418/replay",
        data=json.dumps({"label": "Test Replay"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    res = urllib.request.urlopen(req)
    replay_res = json.loads(res.read().decode())
    print("Replay identical:", replay_res["identical"])
    assert replay_res["identical"] is True

    # 5. Frontend index.html
    res = urllib.request.urlopen("http://127.0.0.1:4189/")
    content = res.read()
    print("Frontend index.html served:", res.status, f"({len(content)} bytes)")
    assert res.status == 200 and len(content) > 100

    print("\nALL SERVER ENDPOINT CHECKS PASSED!\n")

if __name__ == "__main__":
    test_server()
