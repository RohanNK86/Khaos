# MCPify benchmark results (measured)

Measured 2026-11-26T11:42:55.979Z on darwin 27.0.0, Apple M3 (8 cores, 16 GB), Node v22.23.5. Chromium (Playwright 1.65.1), headless, no highlighting. LLM: none configured (LLM_DISABLED=1). Total 88 s.
Path measured: MCP client → MCP server (streamable HTTP) → API → engine → demo portal. Wall time = first tool call → terminal status, including the bench's instant answers to pauses (a real user adds their own think time).

## Flows
| flow | tool | dry run | n | success | mean ms | p50 ms | p95 ms | steps verified | checks | pauses | MCP round trips | model calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apply | `scholarship__apply_scholarship` | no | 20 | 20/20 | 712 | 703 | 723 | 20 | 47 | 4 | 5 | 0 |
| status | `scholarship__check_application_status` | no | 20 | 20/20 | 234 | 229 | 250 | 5 | 10 | 0 | 1 | 0 |
| dues | `fees__check_dues` | no | 20 | 20/20 | 264 | 263 | 268 | 7 | 11 | 1 | 2 | 0 |
| pay_dry | `fees__pay_semester_fee` | yes | 20 | 20/20 | 418 | 417 | 425 | 9 | 18 | 4 | 5 | 0 |
| renew | `buspass__renew_bus_pass` | no | 20 | 20/20 | 777 | 779 | 795 | 15 | 33 | 3 | 4 | 0 |

## Layout changes (Layout Lab, apply_scholarship in dry run, self-repair on, fresh tool v1 each time)
| mutation | outcome | run status | tool version after | ms | repair method | confidence | proposal status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | passed unchanged | dry_run_complete | 1 | 526 | - | - | - |
| M2 | passed unchanged | dry_run_complete | 1 | 504 | - | - | - |
| M1+M2 | healed in-run (tool v+1) | dry_run_complete | 2 | 8886 | heuristic | 0.93 | auto_applied |
| M3 | passed unchanged | dry_run_complete | 1 | 524 | - | - | - |
| M4 | passed unchanged | dry_run_complete | 1 | 516 | - | - | - |
| M5 | passed unchanged | dry_run_complete | 1 | 468 | - | - | - |
| M6 | stopped safely: needs re-record | failed | 1 | 8483 | heuristic | 0.18 | needs_rerecord |
| M7 | passed unchanged | dry_run_complete | 1 | 509 | - | - | - |
| M8 | stopped safely: needs re-record | failed | 1 | 15626 | locator_fallback | 0 | needs_rerecord |
| M9 | healed in-run (tool v+1) | dry_run_complete | 2 | 844 | heuristic | 0.9 | auto_applied |
| M10 | passed unchanged | dry_run_complete | 1 | 536 | - | - | - |

## Baseline (computer-use agent)
Not run: it needs an LLM key and your approval for the cost. See bench/README.md.
