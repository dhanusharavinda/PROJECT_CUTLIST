"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  AudioLines,
  BrainCircuit,
  Check,
  Copy,
  ExternalLink,
  HardDrive,
  KeyRound,
  Lock,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Avatar,
  Button,
  Chip,
  Labeled,
  Modal,
  Segmented,
  useToast,
} from "@/components/ui";
import { relativeTime } from "@/lib/format";
import type { Member, Role } from "@/lib/types";
import { api } from "@/components/project/useProject";

interface ProviderMeta {
  id: string;
  label: string;
  secret: string;
  defaultModel: string;
  note: string;
}

interface SecretHint {
  key: string;
  configured: boolean;
  source: "workspace" | "env" | null;
  hint: string;
  updatedAt: number | null;
}

type Tab = "ai" | "drive" | "people";

export function SettingsView({
  workspace,
  role,
  me,
  secrets,
  settings,
  sttProviders,
  llmProviders,
  active,
  drive,
  members,
  invites,
  flash,
}: {
  workspace: { id: string; name: string; slug: string };
  role: Role;
  me: string;
  secrets: SecretHint[];
  settings: Record<string, string>;
  sttProviders: ProviderMeta[];
  llmProviders: ProviderMeta[];
  active: {
    stt: { provider: string; label: string; model: string } | null;
    llm: { provider: string; label: string; model: string } | null;
  };
  drive: { available: boolean; connected: boolean; accountEmail: string | null };
  members: Member[];
  invites: { id: string; email: string; role: string; token: string; created_at: number }[];
  flash: { status: string; detail?: string } | null;
}) {
  const toast = useToast();
  const privileged = role === "owner" || role === "creator";
  const [tab, setTab] = useState<Tab>(privileged ? "ai" : "people");

  useEffect(() => {
    if (!flash) return;
    if (flash.status === "connected") toast("Google Drive connected", "ok");
    else if (flash.status === "error")
      toast(flash.detail || "Drive could not be connected.", "error");
    // Leave the URL clean so a refresh doesn't re-toast.
    window.history.replaceState(null, "", "/app/settings");
  }, [flash, toast]);

  return (
    <div className="px-5 sm:px-8 py-8 max-w-[880px]">
      <header>
        <span className="text-eyebrow">{workspace.name}</span>
        <h1 className="text-display text-[clamp(1.8rem,3vw,2.4rem)] mt-2">
          Settings
        </h1>
        <p className="text-[13.5px] text-mute mt-2 max-w-[62ch] leading-relaxed">
          Everything here is scoped to this workspace only. Keys, Drive access
          and people do not carry over to your other workspaces.
        </p>
      </header>

      <div className="mt-7">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            ...(privileged
              ? ([
                  { value: "ai" as const, label: <><KeyRound size={13} /> AI providers</> },
                  { value: "drive" as const, label: <><HardDrive size={13} /> Google Drive</> },
                ])
              : []),
            { value: "people", label: <><Users size={13} /> People</>, count: members.length },
          ]}
        />
      </div>

      <div className="mt-6">
        {tab === "ai" ? (
          <AiSettings
            secrets={secrets}
            settings={settings}
            sttProviders={sttProviders}
            llmProviders={llmProviders}
            active={active}
          />
        ) : null}
        {tab === "drive" ? <DriveSettings drive={drive} /> : null}
        {tab === "people" ? (
          <People members={members} invites={invites} role={role} me={me} />
        ) : null}
      </div>
    </div>
  );
}

// ── AI providers ────────────────────────────────────────────────────────────

function AiSettings({
  secrets,
  settings,
  sttProviders,
  llmProviders,
  active,
}: {
  secrets: SecretHint[];
  settings: Record<string, string>;
  sttProviders: ProviderMeta[];
  llmProviders: ProviderMeta[];
  active: {
    stt: { provider: string; label: string; model: string } | null;
    llm: { provider: string; label: string; model: string } | null;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [hints, setHints] = useState(secrets);
  const [prefs, setPrefs] = useState(settings);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const hintFor = (key: string) => hints.find((h) => h.key === key);

  async function saveKey(key: string) {
    const value = (drafts[key] ?? "").trim();
    if (!value) return;
    setBusy(key);
    try {
      const data = await api<{ secrets: SecretHint[] }>("/api/settings", {
        method: "PUT",
        json: { secrets: { [key]: value } },
      });
      setHints(data.secrets);
      setDrafts((d) => ({ ...d, [key]: "" }));
      toast("Key saved and encrypted", "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(key: string) {
    setBusy(key);
    try {
      const data = await api<{ secrets: SecretHint[] }>("/api/settings", {
        method: "PUT",
        json: { removeSecrets: [key] },
      });
      setHints(data.secrets);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function savePref(key: string, value: string) {
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      await api("/api/settings", { method: "PUT", json: { settings: { [key]: value } } });
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="space-y-5">
      <div className="glass rounded-[15px] p-5">
        <div className="flex items-start gap-3">
          <Lock size={15} className="text-signal shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-mute leading-relaxed">
            Keys are encrypted with AES-256-GCM before they touch the database
            and are only ever decrypted server-side to make a request. They are
            never sent to the browser, never written to a config file, and are
            not readable from any other workspace. Anything set in{" "}
            <code className="text-chalk-dim">.env.local</code> acts only as a
            fallback and is shown here as{" "}
            <span className="text-chalk-dim">env</span>.
          </p>
        </div>
      </div>

      <ProviderGroup
        icon={<AudioLines size={15} />}
        title="Speech to text"
        blurb="Turns voice notes into timestamped transcripts. Without one, recordings are stored but never transcribed."
        providers={sttProviders}
        activeId={active.stt?.provider ?? null}
        activeLabel={active.stt ? `${active.stt.label} · ${active.stt.model}` : null}
        selectKey="STT_PROVIDER"
        modelKey="STT_MODEL"
        prefs={prefs}
        onPref={savePref}
        hintFor={hintFor}
        drafts={drafts}
        setDrafts={setDrafts}
        onSave={saveKey}
        onRemove={removeKey}
        busy={busy}
      />

      <ProviderGroup
        icon={<BrainCircuit size={15} />}
        title="Language model"
        blurb="Reads each transcript and decides what kind of edit was asked for, then reviews the project as a whole. Without one, labelling falls back to keyword rules."
        providers={llmProviders}
        activeId={active.llm?.provider ?? null}
        activeLabel={active.llm ? `${active.llm.label} · ${active.llm.model}` : null}
        selectKey="LLM_PROVIDER"
        modelKey="LLM_MODEL"
        prefs={prefs}
        onPref={savePref}
        hintFor={hintFor}
        drafts={drafts}
        setDrafts={setDrafts}
        onSave={saveKey}
        onRemove={removeKey}
        busy={busy}
      />
    </div>
  );
}

function ProviderGroup({
  icon,
  title,
  blurb,
  providers,
  activeId,
  activeLabel,
  selectKey,
  modelKey,
  prefs,
  onPref,
  hintFor,
  drafts,
  setDrafts,
  onSave,
  onRemove,
  busy,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  providers: ProviderMeta[];
  activeId: string | null;
  activeLabel: string | null;
  selectKey: string;
  modelKey: string;
  prefs: Record<string, string>;
  onPref: (key: string, value: string) => void;
  hintFor: (key: string) => SecretHint | undefined;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSave: (key: string) => void;
  onRemove: (key: string) => void;
  busy: string | null;
}) {
  return (
    <section className="glass rounded-[15px] overflow-hidden">
      <div className="px-5 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[14.5px] font-semibold text-chalk flex items-center gap-2">
              <span className="text-signal">{icon}</span>
              {title}
            </h2>
            <p className="text-[12.5px] text-mute mt-1.5 max-w-[62ch] leading-relaxed">
              {blurb}
            </p>
          </div>
          <span
            className={clsx(
              "shrink-0 text-[11px] px-2.5 py-1 rounded-full border",
              activeId
                ? "text-ok bg-ok/10 border-ok/25"
                : "text-faint bg-white/[0.04] border-white/10",
            )}
          >
            {activeId ? "Active" : "Not set"}
          </span>
        </div>

        {activeLabel ? (
          <p className="text-[11.5px] text-faint mt-3 tabular">
            Using {activeLabel}
          </p>
        ) : null}
      </div>

      <div className="rule-x" />

      <div className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Labeled
            label="Preferred provider"
            hint="Auto picks the first one below that has a key."
          >
            <select
              className="field cursor-pointer"
              value={prefs[selectKey] ?? ""}
              onChange={(e) => onPref(selectKey, e.target.value)}
            >
              <option value="">Auto</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled
            label="Model override"
            hint="Leave blank to use each provider's default."
          >
            <ModelInput
              value={prefs[modelKey] ?? ""}
              placeholder={
                providers.find((p) => p.id === (prefs[selectKey] || activeId))
                  ?.defaultModel ?? "provider default"
              }
              onCommit={(value) => onPref(modelKey, value)}
            />
          </Labeled>
        </div>

        <div className="rule-x" />

        <div className="space-y-3">
          {providers.map((provider) => {
            const hint = hintFor(provider.secret);
            const isActive = activeId === provider.id;
            return (
              <div
                key={provider.id}
                className={clsx(
                  "rounded-[12px] border px-4 py-3.5 transition-colors",
                  isActive
                    ? "border-signal/30 bg-signal/[0.045]"
                    : "border-white/[0.07] bg-white/[0.02]",
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] text-chalk flex items-center gap-2">
                      {provider.label}
                      {isActive ? (
                        <span className="text-[10px] text-signal">in use</span>
                      ) : null}
                    </p>
                    <p className="text-[11.5px] text-faint mt-0.5">{provider.note}</p>
                  </div>
                  {hint?.configured ? (
                    <Chip color={hint.source === "env" ? "#8b94a3" : "#5fd3b0"}>
                      <span className="tabular">{hint.hint}</span>
                      {hint.source === "env" ? "env" : ""}
                    </Chip>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    className="field font-mono text-[12px]"
                    placeholder={
                      hint?.source === "workspace"
                        ? "Paste a new key to replace it"
                        : `Paste your ${provider.label} key`
                    }
                    value={drafts[provider.secret] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [provider.secret]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && onSave(provider.secret)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === provider.secret}
                    disabled={!(drafts[provider.secret] ?? "").trim()}
                    onClick={() => onSave(provider.secret)}
                  >
                    Save
                  </Button>
                  {hint?.source === "workspace" ? (
                    <button
                      onClick={() => onRemove(provider.secret)}
                      title="Remove this key"
              aria-label="Remove this key"
                      className="size-8 shrink-0 grid place-items-center rounded-[9px] text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Saves on blur or Enter rather than on every keystroke. */
function ModelInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      className="field tabular"
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// ── Drive ───────────────────────────────────────────────────────────────────

function DriveSettings({
  drive,
}: {
  drive: { available: boolean; connected: boolean; accountEmail: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? Clips imported from it will stop playing."))
      return;
    setBusy(true);
    try {
      await api("/api/integrations/drive", { method: "DELETE" });
      toast("Drive disconnected", "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass rounded-[15px] overflow-hidden">
      <div className="px-5 pt-4 pb-3.5">
        <h2 className="text-[14.5px] font-semibold text-chalk flex items-center gap-2">
          <HardDrive size={15} className="text-signal" />
          Google Drive
        </h2>
        <p className="text-[12.5px] text-mute mt-1.5 max-w-[62ch] leading-relaxed">
          Attach footage straight from Drive. Clips stream through this server
          using the connected account's token — nothing is copied onto disk.
        </p>
      </div>
      <div className="rule-x" />
      <div className="p-5">
        {!drive.available ? (
          <div className="rounded-[12px] border border-warn/20 bg-warn/[0.06] px-4 py-3.5">
            <p className="text-[13px] text-warn font-medium">
              Not configured on this instance
            </p>
            <p className="text-[12.5px] text-mute mt-2 leading-relaxed">
              Drive needs an OAuth client, which is an instance-level setting
              rather than a per-workspace one. In{" "}
              <code className="text-chalk-dim">.env.local</code>, set{" "}
              <code className="text-chalk-dim">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="text-chalk-dim">GOOGLE_CLIENT_SECRET</code>, then
              restart. The README walks through creating the client and the exact
              redirect URI to register.
            </p>
          </div>
        ) : drive.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="size-9 grid place-items-center rounded-[11px] bg-ok/12 border border-ok/25 text-ok">
                <Check size={16} />
              </span>
              <div>
                <p className="text-[13.5px] text-chalk">Connected</p>
                <p className="text-[12px] text-faint">
                  {drive.accountEmail || "Google account"}
                </p>
              </div>
            </div>
            <Button variant="danger" loading={busy} onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[13px] text-mute max-w-[46ch] leading-relaxed">
              Cutlist asks for read-only access so it can list and stream your
              video files. It cannot modify or delete anything in your Drive.
            </p>
            <a href="/api/integrations/drive/connect">
              <Button variant="primary" icon={<ExternalLink size={14} />}>
                Connect Drive
              </Button>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

// ── People ──────────────────────────────────────────────────────────────────

const ROLE_BLURB: Record<string, string> = {
  owner: "Everything, including deleting the workspace.",
  creator: "Writes the brief, manages people and AI keys.",
  editor: "Works the cut list, uploads footage, records notes.",
  viewer: "Reads everything, changes nothing.",
};

function People({
  members,
  invites,
  role,
  me,
}: {
  members: Member[];
  invites: { id: string; email: string; role: string; token: string; created_at: number }[];
  role: Role;
  me: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const canManage = role === "owner" || role === "creator";
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"creator" | "editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await api<{ url: string }>("/api/members", {
        method: "POST",
        json: { email, role: inviteRole },
      });
      await copy(data.url);
      setEmail("");
      setInviteOpen(false);
      toast("Invite link copied to your clipboard", "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast("Copy failed — select the link and copy it manually.", "error");
    }
  }

  async function changeRole(membershipId: string, next: string) {
    try {
      await api("/api/members", {
        method: "PATCH",
        json: { membershipId, role: next },
      });
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function remove(membershipId: string, name: string) {
    if (!confirm(`Remove ${name} from this workspace?`)) return;
    try {
      await api(`/api/members?membershipId=${membershipId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function revoke(inviteId: string) {
    try {
      await api(`/api/members?inviteId=${inviteId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="space-y-5">
      <section className="glass rounded-[15px] overflow-hidden">
        <div className="px-5 pt-4 pb-3.5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14.5px] font-semibold text-chalk">Members</h2>
            <p className="text-[12.5px] text-mute mt-1">
              Who can see this workspace, and what they can do in it.
            </p>
          </div>
          {canManage ? (
            <Button icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          ) : null}
        </div>
        <div className="rule-x" />
        <ul className="divide-y divide-white/[0.05]">
          {members.map((member) => (
            <li key={member.membership_id} className="px-5 py-3.5 flex items-center gap-3">
              <Avatar name={member.name} seed={member.id} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-chalk truncate">
                  {member.name}
                  {member.id === me ? (
                    <span className="text-faint text-[11.5px] ml-1.5">you</span>
                  ) : null}
                </p>
                <p className="text-[11.5px] text-faint truncate">{member.email}</p>
              </div>

              {canManage && member.role !== "owner" ? (
                <select
                  value={member.role}
                  onChange={(e) => changeRole(member.membership_id, e.target.value)}
                  className="field w-[112px] py-1.5 text-[12px] cursor-pointer"
                >
                  <option value="creator">Creator</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="text-[11.5px] text-mute capitalize w-[112px] text-right pr-1">
                  {member.role}
                </span>
              )}

              {canManage && member.role !== "owner" ? (
                <button
                  onClick={() => remove(member.membership_id, member.name)}
                  className="size-8 shrink-0 grid place-items-center rounded-[9px] text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                  title={`Remove ${member.name}`}
              aria-label={`Remove ${member.name}`}
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                <span className="size-8 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && invites.length > 0 ? (
        <section className="glass rounded-[15px] overflow-hidden">
          <div className="px-5 pt-4 pb-3.5">
            <h2 className="text-[14.5px] font-semibold text-chalk">
              Pending invites
            </h2>
            <p className="text-[12.5px] text-mute mt-1">
              There is no mail server here — send the link yourself.
            </p>
          </div>
          <div className="rule-x" />
          <ul className="divide-y divide-white/[0.05]">
            {invites.map((invite) => {
              const url = `${typeof window === "undefined" ? "" : window.location.origin}/join/${invite.token}`;
              return (
                <li key={invite.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-chalk-dim truncate">
                      {invite.email}
                    </p>
                    <p className="text-[11px] text-faint">
                      {invite.role} · invited {relativeTime(invite.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => copy(url)}
                    className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[9px] text-[12px] text-mute hover:text-chalk hover:bg-white/[0.06] transition-colors"
                  >
                    {copied === url ? <Check size={12} /> : <Copy size={12} />}
                    {copied === url ? "Copied" : "Copy link"}
                  </button>
                  <button
                    onClick={() => revoke(invite.id)}
                    className="size-8 grid place-items-center rounded-[9px] text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                    title="Revoke"
              aria-label="Revoke"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite someone"
        description="You get a link back — send it however you like. It works once."
        width={460}
      >
        <form onSubmit={invite} className="space-y-4">
          <Labeled label="Email" required>
            <input
              autoFocus
              required
              type="email"
              className="field"
              placeholder="editor@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Labeled>

          <div>
            <span className="text-[12px] font-medium text-chalk-dim block mb-2">
              Role
            </span>
            <div className="space-y-1.5">
              {(["creator", "editor", "viewer"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setInviteRole(option)}
                  className={clsx(
                    "w-full text-left rounded-[10px] border px-3 py-2.5 transition-colors",
                    inviteRole === option
                      ? "border-signal/40 bg-signal/[0.07]"
                      : "border-white/[0.08] hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    className={clsx(
                      "block text-[13px] capitalize",
                      inviteRole === option ? "text-signal" : "text-chalk",
                    )}
                  >
                    {option}
                  </span>
                  <span className="block text-[11.5px] text-faint mt-0.5">
                    {ROLE_BLURB[option]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="quiet" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create invite link
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
