# OpenCode Links Graph

OpenCode Links Graph is an Obsidian plugin that makes raw OpenCode references visible as edges in Obsidian's native graph view.

It is designed for vaults that use OpenCode-style references as the canonical link syntax:

```md
@.opencode/knowledge/README.md
@.opencode/agents/manager.md
```

## What It Does

- Scans Markdown files for raw OpenCode links.
- Resolves each `@.opencode/...md` target to a real vault file.
- Adds synthetic entries to Obsidian's resolved-link metadata.
- The native Graph and Local Graph can then render those relationships as if they were ordinary internal links.
- Does **not** rewrite your Markdown files.

## What It Does Not Do

- It does not convert OpenCode links into Markdown links or wikilinks.
- It does not change file contents.
- It does not create missing target files.
- It does not currently add hover previews or editor decorations.

## Why Synthetic Metadata?

Obsidian's native graph only reads links that Obsidian's metadata cache recognizes. Raw custom text like `@.opencode/...` is not a native Markdown link, so the graph ignores it.

This plugin bridges that gap by adding resolved-link metadata at runtime. The source files remain OpenCode-native; Obsidian sees graph edges.

## Installation For Development

1. Clone or copy this folder into an Obsidian vault under `.obsidian/plugins/opencode-links-graph/`.
2. Install dependencies:

```sh
npm install
```

3. Build:

```sh
npm run build
```

4. Enable the plugin in Obsidian settings.

For active development:

```sh
npm run dev
```

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| OpenCode link regex | See default settings | Pattern used to find OpenCode links. Default: `@.opencode/...md`. |
| Refresh delay | `400` | Debounce after vault/metadata changes. |
| Show notices | `false` | Show indexed-edge count after automatic refreshes. Manual refresh always shows a notice. |
| Debug logging | `false` | Print details to the developer console. |

## Limitations

- This plugin uses Obsidian's internal `metadataCache.resolvedLinks` shape. That shape is widely used by plugins but is not a formal public API, so future Obsidian versions may require updates.
- Existing native Markdown or wikilink edges are preserved. Synthetic OpenCode edges are removed on plugin unload.
- The plugin only creates graph edges for targets that already exist as files in the vault.
- Links to headings or block IDs are not supported in the first version.

## Release Checklist

1. Update `manifest.json` version.
2. Run `npm version <version>` or update `package.json` manually.
3. Run `npm run version` to update `versions.json`.
4. Run `npm run build`.
5. Publish `manifest.json`, `main.js`, and `styles.css` if present.

## License

MIT
