# References — claude-governance

Canonical index of all external resources. Cite by identifier (e.g., `[tweakcc1]`) in
planning docs instead of raw URLs. Grouped by category, sorted by relevance.

---

## Core Projects — Fork Targets & Governance Tools

| ID | URL | Description |
|----|-----|-------------|
| tweakcc1 | https://github.com/Piebald-AI/tweakcc | **THE FORK TARGET.** Binary patching tool for CC. Prompt extraction, pieces-based matching, data pipeline. We fork this entire repo. |
| ccPrompts1 | https://github.com/Piebald-AI/claude-code-system-prompts/tree/main | All CC prompt text, updated per release (148+ versions with CHANGELOG). Source of truth for what Anthropic ships. |
| clawgod1 | https://github.com/0Chencc/clawgod/tree/main | Wrapper approach for CC. Architectural reference for Phase 1b. |
| clawgodSite1 | https://clawgod.0chen.cc/ | Clawgod documentation site. |
| clawback1 | https://github.com/LZong-tw/clawback | Hooks-based governance. Active on Tom's setup. |
| nanoclaw1 | https://github.com/qwibitai/nanoclaw | Minimal CC patching tool. Reference implementation. |

## System Prompt Leaks & Extraction

| ID | URL | Description |
|----|-----|-------------|
| ccLeaks1 | https://ccleaks.com/ | Aggregated CC system prompt leaks. |
| promptLeaks1 | https://github.com/asgeirtj/system_prompts_leaks/tree/main/Anthropic | Historical prompt leaks. |
| tweakccCustom1 | https://github.com/matheusmoreira/.files/tree/master/~/.tweakcc/system-prompts | Example tweakcc prompt customizations by community user. |
| promptAnalysis1 | https://gist.github.com/roman01la/483d1db15043018096ac3babf5688881 | CC prompt analysis gist. |

## Billing, Proxy & Usage Monitoring

| ID | URL | Description |
|----|-----|-------------|
| billingProxy1 | https://github.com/zacdcook/openclaw-billing-proxy | HTTP proxy for CC billing visibility. Reference for M5. |
| cliProxy1 | https://github.com/router-for-me/CLIProxyAPI/issues/2599 | CLI proxy API discussion. |
| sessionViewer1 | https://github.com/d-kimuson/claude-code-viewer | CC session viewer. |
| usageTracker1 | https://github.com/phuryn/claude-usage | CC usage tracking. |
| ralphCC1 | https://github.com/frankbria/ralph-claude-code | CC enhancement tool. |
| claude-dev-tools | https://github.com/matt1398/claude-devtools | CC session viewer. |

## Cache, Performance & Configuration

| ID | URL | Description |
|----|-----|-------------|
| cacheFix1 | https://old.reddit.com/r/ClaudeCode/comments/1shkgg2/your_claude_code_cache_is_probably_broken_and_its/ | Cache fix discovery post. |
| cacheFixTool1 | https://github.com/cnighswonger/claude-code-cache-fix | Cache fix tool. |
| adaptiveThinking1 | https://old.reddit.com/r/ClaudeCode/comments/1sfihyr/psa_if_your_opus_is_lobotomized_disable_adaptive/ | Adaptive thinking degradation fix. |
| settingsBestPractice1 | https://github.com/shanraisshan/claude-code-best-practice/blob/main/best-practice/claude-settings.md#environment-variables-via-env | Settings best practices. |

## Official Anthropic Docs

| ID | URL | Description |
|----|-----|-------------|
| ccRepo1 | https://github.com/anthropics/claude-code | Official CC repo. |
| stellaraccident1 | https://github.com/anthropics/claude-code/issues/42796 | Stellaraccident degradation analysis (quantitative). |
| promethean1 | https://github.com/anthropics/claude-code/issues/28158#issuecomment-4230030386 | Promethean CLAUDE.md dismissal evidence. |
| ccEnvVars1 | https://code.claude.com/docs/en/env-vars | Official env var documentation. |
| ccCliFlags1 | https://code.claude.com/docs/en/cli-reference#cli-flags | Official CLI flags. |
| ccNativeMigration1 | https://code.claude.com/docs/en/setup#migrate-from-npm-to-native | Native install migration. |
| promptCaching1 | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Prompt caching docs. |
| versionPinning1 | https://www.reddit.com/r/ClaudeAI/comments/1rlpa05/how_do_i_install_a_specific_version_of_claude/ | Version pinning guide. |

## Research & Analysis

| ID | URL | Description |
|----|-----|-------------|
| haseebAnalysis1 | https://gist.github.com/Haseeb-Qureshi/d0dc36844c19d26303ce09b42e7188c1 | CC internals analysis. Documents ant vs external prompt divergence. |
| unknownResearch1 | https://gist.github.com/unkn0wncode/f87295d055dd0f0e8082358a0b5cc467 | CC internals research. |
| cattusResearch1 | https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a | CC research gist. |
| ceaksanResearch1 | https://gist.github.com/ceaksan/57af569318917940c9e1e1160c02a982 | CC research gist. |

## Channels API & Inter-Session Communication

| ID | URL | Description |
|----|-----|-------------|
| channelsRef1 | https://code.claude.com/docs/en/channels-reference | Official Channels API reference. Covers MCP server setup, notification schema, reply tools, permission relay. |
| fakechat1 | https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat | Reference implementation of a channel plugin. Demonstrates bidirectional messaging: inbound via notifications, outbound via exposed MCP tools. |
| pluginsOfficial1 | https://github.com/anthropics/claude-plugins-official | Official Claude Code plugins repository. Contains channel examples and plugin patterns. |

## Programmatic Tool Calling & REPL Research

| ID | URL | Description |
|----|-----|-------------|
| ptcDocs1 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling | Anthropic PTC documentation. |
| advancedToolUse1 | https://github.com/shanraisshan/claude-code-best-practice/blob/main/reports/claude-advanced-tool-use.md | Advanced tool use report. |
| advancedToolUsePost1 | https://www.anthropic.com/engineering/advanced-tool-use | Anthropic engineering post on advanced tool use. |
| replScratchpad1 | https://github.com/knot0-com/repl-scratchpad | REPL scratchpad project. |

## Local Paths (Not URLs — Machine-Specific)

| ID | Path | Description |
|----|------|-------------|
| projectRoot | `/Users/tom.kyser/dev/claude-code-patches` | Project root. |
| governanceDir | `/Users/tom.kyser/dev/claude-code-patches/claude-governance` | The product (tweakcc fork). |
| promptOverrides | `/Users/tom.kyser/dev/claude-code-patches/prompts` | 9 degradation-fix prompt overrides. |
| tweakccLocal | `/Users/tom.kyser/dev/tweakcc` | Local tweakcc checkout. Fork source. |
| ccSource | `/Users/tom.kyser/dev/cc-source` | Leaked CC source code. Reference for internals. |
| clawbackLocal | `/Users/tom.kyser/dev/clawback` | Clawback hooks project. Active on Tom's setup. |
| dynamoWire | `/Users/tom.kyser/Library/Mobile Documents/com~apple~CloudDocs/dev/dynamo/core/services/wire/` | Dynamo Wire service (2526 lines). Port source for M-3.5. |
