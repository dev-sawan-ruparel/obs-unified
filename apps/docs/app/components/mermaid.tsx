import { useEffect, useId, useState } from "react";

type MermaidProps = {
  chart: string;
};

export function Mermaid({ chart }: MermaidProps) {
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        const result = await mermaid.render(id, chart);

        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to render diagram.");
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="my-4 overflow-x-auto rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
        {error}
      </pre>
    );
  }

  if (!svg) {
    return <div className="my-4 h-32 rounded-md border bg-fd-muted/30" />;
  }

  return (
    <div
      className="mermaid-rendered my-6 overflow-x-auto rounded-md border bg-white p-4 dark:bg-fd-background"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
