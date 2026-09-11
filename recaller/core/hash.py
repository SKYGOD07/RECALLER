"""RECALLER — deterministic hashing and identifiers.

Used to fingerprint policy documents, evidence bundles and calculation
inputs so that a replay can prove it ran against the same material.
Implementation uses 128-bit FNV-1a (four 32-bit interleaved lanes) and
mulberry32 PRNG to match the JavaScript engine byte-for-byte.
"""

import json
from typing import Any, Callable, List, Union


def stable_stringify(value: Any) -> str:
    """Stable JSON: object keys sorted recursively so key order never changes a hash."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            # In JS: JSON.stringify(1.0) is "1"
            return str(int(value))
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, (list, tuple)):
        items = [stable_stringify(v) for v in value]
        return f"[{','.join(items)}]"
    if isinstance(value, dict):
        keys = sorted(k for k in value.keys() if value[k] is not None or value[k] is None)
        body = [
            f"{json.dumps(str(k))}:{stable_stringify(value[k])}"
            for k in keys
            if value[k] is not None or k in value  # keep None as null
        ]
        return f"{{{','.join(body)}}}"
    return json.dumps(str(value))


def fnv1a32(s: str, seed: int) -> int:
    """32-bit FNV-1a hash over unicode string code units."""
    h = seed & 0xFFFFFFFF
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h & 0xFFFFFFFF


def hash_value(value: Any) -> str:
    """128-bit hex digest of any JSON-serialisable value."""
    s = stable_stringify(value)
    lanes = [0x811C9DC5, 0x1B873593, 0x85EBCA6B, 0xC2B2AE35]
    hex_parts = [f"{fnv1a32(s, seed):08x}" for seed in lanes]
    return "".join(hex_parts)


def short_hash(value: Any) -> str:
    """Short human-quotable fingerprint — first 12 hex chars."""
    return hash_value(value)[:12]


def rng(seed: Union[int, str]) -> Callable[[], float]:
    """Deterministic pseudo-random generator (mulberry32)."""
    if isinstance(seed, (int, float)):
        a = int(seed) & 0xFFFFFFFF
    else:
        a = fnv1a32(str(seed), 0x9E3779B9)

    def next_random() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t1 = (t ^ (t >> 15)) & 0xFFFFFFFF
        t2 = (t | 1) & 0xFFFFFFFF
        t = (t1 * t2) & 0xFFFFFFFF
        t3 = (t ^ (t >> 7)) & 0xFFFFFFFF
        t4 = (t | 61) & 0xFFFFFFFF
        t = (t + ((t3 * t4) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return next_random


def make_id(prefix: str, seed_parts: Any) -> str:
    """Monotonic sortable identifier with stable prefix."""
    h = hash_value(seed_parts)[:10].upper()
    return f"{prefix}-{h}"
