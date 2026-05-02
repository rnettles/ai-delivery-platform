"use client";

import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArtifactViewerProps {
  pipelineId: string;
  path: string;
}

async function fetchArtifactContent(pipelineId: string, artifactPath: string): Promise<string> {
  const url = `/api/pipelines/${encodeURIComponent(pipelineId)}/artifact?path=${encodeURIComponent(artifactPath)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to load artifact: ${res.status}`);
  }
  return res.text();
}

function extOf(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}

/** Minimal JSON syntax highlighter — no extra dependency. */
function JsonHighlight({ content }: { content: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Not valid JSON — fall back to raw
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 leading-relaxed">
        {content}
      </pre>
    );
  }

  const highlighted = JSON.stringify(parsed, null, 2).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-blue-600"; // number
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "text-indigo-700 font-semibold" : "text-green-700"; // key vs string
      } else if (/true|false/.test(match)) {
        cls = "text-orange-600";
      } else if (/null/.test(match)) {
        cls = "text-gray-400";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );

  return (
    <pre
      className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 leading-relaxed"
      // Safe: content originates from the backend API response we own; only colour spans inserted
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

/** Prose wrapper for react-markdown output. */
function MarkdownRender({ content }: { content: string }) {
  return (
    <div className="prose-artifact text-sm text-gray-800 leading-relaxed space-y-3
      [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4
      [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3
      [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2
      [&_p]:mb-2
      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2
      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2
      [&_li]:mb-0.5
      [&_code]:bg-gray-100 [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_code]:text-purple-700
      [&_pre]:bg-gray-100 [&_pre]:rounded [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-2
      [&_pre_code]:bg-transparent [&_pre_code]:p-0
      [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600
      [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs
      [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold
      [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1
      [&_a]:text-blue-600 [&_a]:underline
      [&_hr]:border-gray-200 [&_hr]:my-3
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function ArtifactViewer({ pipelineId, path }: ArtifactViewerProps) {
  const { data, isLoading, isError, error } = useQuery<string, Error>({
    queryKey: ["artifact", pipelineId, path],
    queryFn: () => fetchArtifactContent(pipelineId, path),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-3 rounded bg-gray-200" />
        <div className="h-3 w-4/5 rounded bg-gray-200" />
        <div className="h-3 w-3/5 rounded bg-gray-200" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-red-600">{error?.message ?? "Failed to load artifact."}</p>
    );
  }

  if (!data) return null;

  const ext = extOf(path);

  if (ext === "md") {
    return <MarkdownRender content={data} />;
  }

  if (ext === "json") {
    return <JsonHighlight content={data} />;
  }

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800 leading-relaxed">
      {data}
    </pre>
  );
}

