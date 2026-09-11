# Third-party notices — `recaller/ai/hermes`

Parts of this package are adapted from **Hermes Agent**
(https://github.com/NousResearch/hermes-agent), reduced to what a credit
underwriting system needs:

| RECALLER file | Adapted from (Hermes Agent) |
| --- | --- |
| `registry.py` | `tools/registry.py` |
| `toolsets.py` | `toolsets.py` |
| `loop.py` | `agent/conversation_loop.py`, `run_agent.py` |
| `delegation.py` | `tools/delegate_tool.py` (`delegate_task` contract) |
| `skills.py`, `skills/` layout | the Hermes skill format (`SKILL.md` + `references/`) |
| `structured.py` | the pattern of `optional-skills/mlops/instructor` |
| `skills/instructor/` | copied unchanged from `optional-skills/mlops/instructor` (frontmatter: author Orchestra Research, license MIT) |

`skills/credit-underwriter/` is RECALLER's own skill.

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
