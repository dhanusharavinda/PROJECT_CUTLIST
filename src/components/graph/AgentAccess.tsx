"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Chip, Labeled, Modal, Panel, PanelHeader, Spinner, useToast } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { api } from "@/components/project/useProject";

/**
 * Letting an outside AI read this project.
 *
 * A token is minted here, shown once, and pasted into ChatGPT, Astra or any
 * MCP client as a bearer. It can read this one project and nothing else, and
 * it can never write. Below it, what can execute an edit on this instance and
 * where footage can live, so the agent (and the creator) know what is real.
 */

interface TokenView {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked: boolean;
}

interface Capability {
  provider: string;
  label: string;
  kind?: string;
  capabilities: string[];
  configured: boolean;
}

export function AgentAccess({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const toast = useToast();
  const [tokens, setTokens] = useState<TokenView[] | null>(null);
  const [caps, setCaps] = useState<{ connectors: Capability[]; media: Capability[] } | null>(null);
  const [minting, setMinting] = useState(false);
  const [name, setName] = useState("ChatGPT");
  const [fresh, setFresh] = useState<{ token: string; url: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        canManage ? api<{ tokens: TokenView[] }>(`/api/projects/${projectId}/tokens`) : Promise.resolve({ tokens: [] }),
        api<{ connectors: Capability[]; media: Capability[] }>(`/api/connectors`),
      ]);
      setTokens(t.tokens);
      setCaps(c);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [projectId, canManage, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    setMinting(true);
    try {
      const res = await api<{ token: string; mcp: { url: string } }>(`/api/projects/${projectId}/tokens`, {
        method: "POST",
        json: { name },
      });
      setFresh({ token: res.token, url: res.mcp.url });
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/projects/${projectId}/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
      toast("Token revoked. That agent can no longer read this project.", "ok");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast("Could not copy. Select the text and copy it yourself.", "error");
    }
  }

  const live = (tokens ?? []).filter((t) => !t.revoked);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Outside AI, read only"
        title="Let an agent read this project"
        action={
          canManage ? (
            <form onSubmit={mint} className="flex items-center gap-2">
              <input
                className="field !w-[150px] !py-1.5 text-[12.5px]"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                aria-label="Name for the token"
              />
              <Button type="submit" size="sm" variant="primary" icon={<KeyRound size={13} />} loading={minting}>
                New token
              </Button>
            </form>
          ) : null
        }
      />

      <div className="px-5 pb-5 space-y-5">
        <p className="text-[12.5px] text-mute leading-relaxed max-w-[66ch]">
          ChatGPT, Astra or any tool that speaks MCP can read this project with a token:
          the brief, the template, every shot, the transcript, your instructions and the
          AI suggestions. It cannot change anything here. Give each agent its own token
          and revoke it when the job is done.
        </p>

        {tokens === null ? (
          <p className="text-[12.5px] text-mute flex items-center gap-2">
            <Spinner /> Loading
          </p>
        ) : live.length === 0 ? (
          <p className="text-[12.5px] text-faint">No tokens yet.</p>
        ) : (
          <ul className="space-y-2">
            {live.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.07] bg-white/[0.02] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] text-chalk truncate flex items-center gap-2">
                    <ShieldCheck size={13} className="text-ok shrink-0" />
                    {t.name}
                    <Chip color="#8b94a3">{t.scopes}</Chip>
                  </p>
                  <p className="text-[11.5px] text-faint mt-0.5 tabular">
                    Issued {relativeTime(t.created_at)}
                    {t.last_used_at ? ` · last read ${relativeTime(t.last_used_at)}` : " · never used"}
                  </p>
                </div>
                {canManage ? (
                  <Button size="sm" variant="quiet" icon={<Trash2 size={13} />} onClick={() => revoke(t.id)}>
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {caps ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Plug size={11} /> Where this edit can go
              </p>
              <ul className="space-y-1.5">
                {caps.connectors.map((c) => (
                  <li key={c.provider} className="text-[12.5px] flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: c.configured ? "#5fd3b0" : "#545c6a" }}
                      aria-hidden
                    />
                    <span className={c.configured ? "text-chalk" : "text-faint"}>
                      {c.label}
                      <span className="block text-[11px] text-faint">
                        {c.configured ? c.capabilities.join(", ") : "declared, not wired on this instance"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] text-faint uppercase tracking-wide mb-2">Where footage can live</p>
              <ul className="space-y-1.5">
                {caps.media.map((m) => (
                  <li key={m.provider} className="text-[12.5px] flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: m.configured ? "#5fd3b0" : "#545c6a" }}
                      aria-hidden
                    />
                    <span className={m.configured ? "text-chalk" : "text-faint"}>
                      {m.label}
                      <span className="block text-[11px] text-faint">
                        {m.configured ? m.capabilities.join(", ") : "needs credentials in Settings"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={fresh !== null}
        onClose={() => setFresh(null)}
        title="Copy this token now"
        description="It is shown once. Cutlist keeps only a hash, so if you lose it, revoke it and make another."
        width={520}
      >
        {fresh ? (
          <div className="space-y-4">
            <Labeled label="Token">
              <div className="flex gap-2">
                <input readOnly className="field font-mono text-[12px]" value={fresh.token} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="quiet"
                  icon={copied === "token" ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() => copy(fresh.token, "token")}
                >
                  {copied === "token" ? "Copied" : "Copy"}
                </Button>
              </div>
            </Labeled>
            <Labeled label="MCP server URL" hint="Paste this as a remote MCP server or a ChatGPT connector. It must be reachable from the internet: deploy the app, or tunnel it (see the README).">
              <div className="flex gap-2">
                <input readOnly className="field font-mono text-[12px]" value={fresh.url} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="quiet"
                  icon={copied === "url" ? <Check size={14} /> : <Copy size={14} />}
                  onClick={() => copy(fresh.url, "url")}
                >
                  {copied === "url" ? "Copied" : "Copy"}
                </Button>
              </div>
            </Labeled>
            <p className="text-[12px] text-mute leading-relaxed">
              Header: <code className="text-chalk-dim">Authorization: Bearer {"<token>"}</code>.
              Tools it gets: project, brief, template, media manifest, shots, frames,
              transcript, your instructions, AI suggestions, the full edit graph, the current
              revision and what is unresolved. All reads.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}
