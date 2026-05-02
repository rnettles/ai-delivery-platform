# Component: Artifact Viewer

## Purpose
Displays pipeline artifacts inline in the Side Panel when the user clicks an artifact badge on the Pipeline Timeline.

## Supports
- Markdown (`.md`) — rendered with GitHub Flavored Markdown (headings, lists, tables, code blocks, blockquotes, links)
- JSON — syntax-highlighted without external dependencies
- Plain text — monospace pre-formatted fallback

## Behaviour

- Content is fetched lazily via `GET /api/pipelines/:id/artifact?path=...` on first selection.
- Shows a skeleton placeholder while loading.
- Displays an inline error message if the fetch fails.
- File type is determined from the file extension (case-insensitive).

## Location
`platform/frontend/components/pipeline/ArtifactViewer.tsx`
