"use client";

/**
 * Last resort: this replaces the root layout, so it cannot assume the stylesheet
 * or fonts loaded. Everything here is inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          background: "#06070a",
          color: "#edeff3",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 440 }}>
          <p
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#737c8a",
              margin: 0,
            }}
          >
            Cutlist
          </p>
          <h1
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontWeight: 400,
              fontSize: 30,
              lineHeight: 1.12,
              margin: "12px 0 0",
            }}
          >
            The app failed to start
          </h1>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.65,
              color: "#7d8593",
              margin: "16px 0 0",
            }}
          >
            This is an error outside every page, usually a bad{" "}
            <code>.env.local</code>, most often a missing{" "}
            <code>AUTH_SECRET</code> or <code>APP_ENCRYPTION_KEY</code>. Your
            data on disk is untouched.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 28,
              height: 40,
              padding: "0 16px",
              borderRadius: 10,
              border: "none",
              background: "#d6f55e",
              color: "#06070a",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.message ? (
            <pre
              style={{
                marginTop: 28,
                fontSize: 11,
                lineHeight: 1.6,
                color: "#737c8a",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              {error.message}
            </pre>
          ) : null}
        </div>
      </body>
    </html>
  );
}
