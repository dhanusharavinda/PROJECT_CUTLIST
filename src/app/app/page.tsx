import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Clapperboard,
  KeyRound,
  ListChecks,
  Mic,
} from "lucide-react";
import { requireCtx, can } from "@/lib/tenancy";
import { many, one } from "@/lib/db";
import { recentActivity } from "@/lib/activity";
import { resolveStt } from "@/lib/ai/stt";
import { resolveLlm } from "@/lib/ai/llm";
import { NewProjectButton } from "@/components/NewProjectButton";
import { Empty, Meter } from "@/components/ui";
import { FilmstripArt } from "@/components/EmptyArt";
import { PROJECT_STATUS_STYLE } from "@/lib/labelStyle";
import { relativeTime, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  status: keyof typeof PROJECT_STATUS_STYLE;
  due_at: number | null;
  updated_at: number;
  video_count: number;
  label_count: number;
  open_count: number;
  high_count: number;
  note_count: number;
  completeness: number;
}

export default async function Dashboard() {
  const ctx = await requireCtx();

  const projects = many<ProjectRow>(
    `SELECT p.id, p.name, p.summary, p.status, p.due_at, p.updated_at,
            (SELECT COUNT(*) FROM videos v WHERE v.project_id = p.id) AS video_count,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id) AS label_count,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id AND l.status IN ('open','doing')) AS open_count,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id AND l.priority = 'high' AND l.status IN ('open','doing')) AS high_count,
            (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS note_count,
            COALESCE((SELECT b.completeness FROM briefs b WHERE b.project_id = p.id), 0) AS completeness
       FROM projects p
      WHERE p.workspace_id = ?
      ORDER BY CASE p.status WHEN 'archived' THEN 1 ELSE 0 END, p.updated_at DESC`,
    ctx.workspace.id,
  );

  const totals = one<{
    videos: number;
    notes: number;
    open: number;
    done: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM videos WHERE workspace_id = ?) AS videos,
       (SELECT COUNT(*) FROM notes WHERE workspace_id = ?) AS notes,
       (SELECT COUNT(*) FROM labels WHERE workspace_id = ? AND status IN ('open','doing')) AS open,
       (SELECT COUNT(*) FROM labels WHERE workspace_id = ? AND status = 'done') AS done`,
    ctx.workspace.id,
    ctx.workspace.id,
    ctx.workspace.id,
    ctx.workspace.id,
  )!;

  const activity = recentActivity(ctx.workspace.id, 14);
  const stt = resolveStt(ctx.workspace.id);
  const llm = resolveLlm(ctx.workspace.id);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Still up" : hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  return (
    <div className="px-5 sm:px-8 py-8 max-w-[1400px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-eyebrow">{ctx.workspace.name}</span>
          <h1 className="text-display text-[clamp(1.9rem,3.4vw,2.6rem)] mt-2">
            {greeting}, {ctx.user.name.split(" ")[0]}
            <span className="text-mute">.</span>
          </h1>
        </div>
        {can.createProject(ctx.role) ? <NewProjectButton /> : null}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
        <Stat
          icon={<ListChecks size={14} />}
          label="Open instructions"
          value={totals.open}
          sub={totals.done ? `${totals.done} done` : "nothing done yet"}
          accent={totals.open > 0}
        />
        <Stat
          icon={<Mic size={14} />}
          label="Notes captured"
          value={totals.notes}
          sub="voice + typed"
        />
        <Stat
          icon={<Clapperboard size={14} />}
          label="Clips"
          value={totals.videos}
          sub={`across ${projects.length} project${projects.length === 1 ? "" : "s"}`}
        />
        <Stat
          icon={<KeyRound size={14} />}
          label="AI"
          value={stt && llm ? "Ready" : stt || llm ? "Partial" : "Offline"}
          sub={
            stt && llm
              ? `${stt.provider.label} · ${llm.provider.label}`
              : "add keys in Settings"
          }
          accent={Boolean(stt && llm)}
          small
        />
      </div>

      {!stt || !llm ? (
        <Link
          href="/app/settings"
          className="mt-4 flex items-center gap-3 glass-soft rounded-[13px] px-4 py-3 hover:bg-white/[0.055] transition-colors group"
        >
          <AlertTriangle size={15} className="text-warn shrink-0" />
          <span className="text-[13px] text-chalk-dim flex-1 leading-snug">
            {!stt && !llm
              ? "No AI keys yet. Voice notes will record but won't transcribe, and labelling falls back to keyword rules."
              : !stt
                ? "No transcription key. Voice notes will record but won't turn into text."
                : "No language-model key. Labelling falls back to keyword rules instead of reading intent."}
          </span>
          <span className="text-[12.5px] text-signal flex items-center gap-1 shrink-0">
            Add keys
            <ArrowUpRight size={13} className="group-hover:translate-x-px group-hover:-translate-y-px transition-transform" />
          </span>
        </Link>
      ) : null}

      <div className="grid lg:grid-cols-[1fr_310px] gap-6 mt-9 items-start">
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[15px] font-semibold">Projects</h2>
            {projects.length > 0 ? (
              <span className="text-[11.5px] text-faint tabular">
                {projects.length}
              </span>
            ) : null}
          </div>

          {projects.length === 0 ? (
            <div className="glass rounded-[16px]">
              <Empty
                art={<FilmstripArt />}
                title="Nothing here yet"
                hint="A project holds one video (or a batch of them) with its brief, footage, notes and cut list."
                action={
                  can.createProject(ctx.role) ? (
                    <NewProjectButton variant="ghost" label="Start the first one" />
                  ) : null
                }
              />
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>

        <aside className="glass rounded-[16px] overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <span className="text-eyebrow">Activity</span>
          </div>
          <div className="rule-x" />
          {activity.length === 0 ? (
            <Empty title="Quiet in here" hint="Everything that happens in this workspace shows up here." />
          ) : (
            <ul className="py-2 max-h-[520px] overflow-y-auto">
              {activity.map((entry) => (
                <li key={entry.id} className="px-5 py-2.5">
                  <p className="text-[12.5px] text-chalk-dim leading-snug">
                    {entry.summary}
                  </p>
                  <p className="text-[10.5px] text-faint mt-1 flex items-center gap-1.5">
                    <span>{relativeTime(entry.created_at)}</span>
                    {entry.project_name ? (
                      <>
                        <span className="size-[3px] rounded-full bg-faint/60" />
                        <span className="truncate">{entry.project_name}</span>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="glass rounded-[14px] px-4 py-3.5">
      <div className="flex items-center gap-2 text-faint">
        {icon}
        <span className="text-[11px] font-medium tracking-wide">{label}</span>
      </div>
      <p
        className={`mt-2.5 text-display leading-none ${small ? "text-[26px]" : "text-[32px]"} ${
          accent ? "text-signal" : "text-chalk"
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-faint mt-1.5 truncate">{sub}</p>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const status = PROJECT_STATUS_STYLE[project.status] ?? PROJECT_STATUS_STYLE.briefing;
  const overdue =
    project.due_at && project.due_at < Date.now() && project.status !== "delivered";

  return (
    <Link
      href={`/app/projects/${project.id}`}
      className="glass rounded-[15px] p-4 block transition-all duration-200 hover:bg-white/[0.055] hover:-translate-y-px group"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14.5px] font-semibold text-chalk leading-snug clamp-2">
          {project.name}
        </h3>
        <span
          className="text-[10.5px] px-2 py-0.5 rounded-full shrink-0 border"
          style={{
            color: status.color,
            background: `${status.color}14`,
            borderColor: `${status.color}30`,
          }}
        >
          {status.label}
        </span>
      </div>

      {project.summary ? (
        <p className="text-[12.5px] text-mute mt-1.5 leading-relaxed clamp-2">
          {project.summary}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-1.5">
        <span className="text-[10.5px] text-faint w-11 shrink-0">Brief</span>
        <Meter value={project.completeness} className="flex-1" />
        <span className="text-[10.5px] tabular text-faint w-8 text-right">
          {project.completeness}%
        </span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span className="tabular">{project.video_count} clips</span>
        <span className="size-[3px] rounded-full bg-faint/50" />
        <span className="tabular">{project.note_count} notes</span>
        <span className="size-[3px] rounded-full bg-faint/50" />
        <span className={project.open_count ? "text-chalk-dim tabular" : "tabular"}>
          {project.open_count} open
        </span>
        {project.high_count > 0 ? (
          <span className="text-danger tabular">{project.high_count} high</span>
        ) : null}
        {project.due_at ? (
          <span className={`ml-auto tabular ${overdue ? "text-danger" : ""}`}>
            {overdue ? "overdue · " : "due "}
            {shortDate(project.due_at)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
