import { FallbackLink, FullPageState } from "@/components/Fallback";

export default function NotFound() {
  return (
    <FullPageState
      eyebrow="404"
      title="Nothing lives here"
      body={
        <>
          The page, project or clip you followed either moved, was deleted, or
          belongs to a workspace you are not a member of — Cutlist treats those
          the same on purpose, so a stray link never confirms what exists
          elsewhere.
        </>
      }
      actions={
        <>
          <FallbackLink href="/app" primary>
            Back to your workspace
          </FallbackLink>
          <FallbackLink href="/">Cutlist home</FallbackLink>
        </>
      }
    />
  );
}
