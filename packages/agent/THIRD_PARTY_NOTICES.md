# Third-party notices

Parts of `packages/agent` are adapted from **Hermes Agent**
(https://github.com/NousResearch/hermes-agent), ported from Python to JavaScript
and reduced to what RECALLER needs:

| RECALLER file | Adapted from |
| --- | --- |
| `src/registry.js` | `tools/registry.py` |
| `src/toolsets.js` | `toolsets.py` |
| `src/loop.js` | `agent/conversation_loop.py`, `run_agent.py` |
| `src/delegate.js` | `tools/delegate_tool.py` |
| `src/skills.js`, `skills/` layout | the Hermes skill format (`SKILL.md` + `references/`) |
| `src/structured.js` | the pattern in `optional-skills/mlops/instructor` |

Hermes Agent is distributed under the following licence:

```
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
