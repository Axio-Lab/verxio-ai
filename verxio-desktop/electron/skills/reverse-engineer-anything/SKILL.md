---
name: reverse-engineer-anything
description: "Reverse engineer an app, binary, package, or site the user points at, using Verxio's built-in REA tools. Use when they ask how a shipped feature works, want evidence from an artifact, or want a similar feature built in the open project. Skip it for ordinary work inside a source repository you can already read."
version: 1.0.0
author: Verxio
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Reverse Engineering, REA, Binaries, Electron, Investigation]
    homepage: https://github.com/morluto/rea
---

# Reverse engineer anything

Verxio connects REA for you. The tools are already registered as MCP tools named `mcp_rea_<tool>`. Do not run `npx rea-agents setup`, do not edit MCP config, and do not install Hopper, Ghidra, or IDA unless the user asks.

This chat is the Verxio workspace. Download the target, unpack it, and call the REA tools here. `verxio_start_task` is only for a live video call and is not in this session. Do not ask the user to open another chat.

Use this when the user wants to understand a shipped app, installer, binary, package, or site they point at, and then explain it or rebuild the feature in their open project. For a repository whose source you can already read, use the normal file and terminal tools and leave REA alone.

## How to investigate

1. Load this skill, then look at the live `mcp_rea_*` tool list and use those schemas. A tool named here may be absent from an older server. Pick the closest advertised tool instead of inventing arguments.
2. Start from the target the user gave. Ask for a path only when the request has no target.
3. Read the evidence, limitations, and unknowns in the result before you explain anything. Quote the evidence in the reply. Say what is still unknown.
4. When they want the feature in their project, implement it there after the explanation. Keep the investigation notes in the workspace so a later turn can use them.

Analysis runs on this machine. JavaScript and Electron apps need no extra engine. Native binaries need Hopper, Ghidra, or IDA already installed. If that engine is missing, say so and continue with whatever the tools can still show.

## First tool

Call the matching `mcp_rea_` tool:

- Extracted JavaScript, Electron, or an ASAR: `analyze_javascript_application`.
- A native binary, archive, or package inventory: `open_binary` with the local path. Use `inspect_artifact` when its findings answer the question. Start with a summary on large inventories.
- Apple plist, Interface Builder, asset catalogs, or keyed archives: `open_bundle_resources`, then the resource tool.
- Android code, classes, or references: `inspect_android_package`.
- A .NET or other managed assembly: `inspect_managed_artifact`.
- Firmware: `inspect_firmware_regions` when it is advertised. Extract only when the user asks, into a new directory they choose.
- A website or running app: use the advertised runtime or browser tool, and stay on the target they named.

If the first call says the provider is unavailable, report that and keep going with static evidence. Do not install an analysis engine to get past it.

## When the tools are missing

Say that REA did not connect. One retry of the same call is enough. Do not reconfigure the agent. Node.js 22.23.4+, 24.22.1+, or 26.12.1+ has to be on PATH for the built-in server. A missing native engine blocks only native decompilation.
