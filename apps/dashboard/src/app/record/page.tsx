import Link from "next/link";
import type { Recording, Tool } from "@mcpify/contracts";
import { CopyButton } from "../../components/CopyButton";
import { Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { compilerCommand, formatTime, recorderCommand } from "../../lib/format";
import { requestSource } from "../../lib/server";

function Command({ text }: { text: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <pre className="code min-w-0 flex-1 whitespace-pre-wrap break-all text-base">{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ site?: string; task?: string }> }) {
  const q = await searchParams;
  const { client } = await requestSource();
  const [sites, tools] = await Promise.all([client.listSites(), client.listTools()]);
  const site = sites.find((s) => s.slug === q.site) ?? sites[0];
  const task = (q.task ?? "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();

  // The API has no "list recordings" endpoint: recent recordings are the ones tools were compiled from.
  const compiled = tools.filter((t): t is Tool & { createdFrom: string } => !!t.createdFrom);
  const recordings = await Promise.all(
    compiled.map(async (tool) => ({ tool, rec: await client.getRecording(tool.createdFrom).catch((): Recording | null => null) })),
  );
  recordings.sort((a, b) => (b.rec?.createdAt ?? "").localeCompare(a.rec?.createdAt ?? ""));

  return (
    <>
      <PageHeader title="Record a task" subtitle="Do the task once in a real browser. MCPify turns it into a verified draft tool." />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="1 · Pick the site and name the task">
          <form className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col font-bold">
              Site
              <select name="site" defaultValue={site?.slug} className="input mt-1">
                {sites.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col font-bold">
              Task name (snake_case)
              <input name="task" defaultValue={task} placeholder="apply_scholarship" className="input mt-1" />
            </label>
            <button className="btn">Update commands</button>
          </form>
          <h3 className="mb-2 mt-6 text-lg">2 · Record</h3>
          <p className="mb-2">
            A browser opens on {site?.origin ?? "your site"}. Complete the task with test data, then type <code>done</code> in
            the terminal (or close the window). The recording is saved under <code>apps/recorder/recordings/</code>.
          </p>
          <Command text={recorderCommand(site?.slug ?? "<site>", task)} />
          <h3 className="mb-2 mt-6 text-lg">3 · Compile into a draft tool</h3>
          <p className="mb-2">Use the file path the recorder printed (paths are relative to the compiler package).</p>
          <Command text={compilerCommand(`../../apps/recorder/recordings/${task || "<task_name>"}-<timestamp>.json`)} />
          <h3 className="mb-2 mt-6 text-lg">4 · Review and approve</h3>
          <p>
            The draft appears under <Link href="/tools" className="underline">Tools</Link>. Check each step&apos;s risk badge,
            then press <b>Approve</b>.
          </p>
        </Card>
        <Card title="Tips for a clean recording">
          <ul className="list-inside list-disc space-y-2 text-lg">
            <li>Use fictional test data only, never a real person&apos;s details.</li>
            <li>Type OTPs and CAPTCHAs yourself: they become <b>auth</b> steps the human always answers.</li>
            <li>Buttons that send data (Send OTP, Submit) become <b>commit</b> steps that pause for confirmation.</li>
            <li>Wait for each page to load before the next click.</li>
          </ul>
        </Card>
      </div>
      <h2 className="mb-4 mt-10 text-2xl">Recent recordings</h2>
      {recordings.length === 0 ? (
        <EmptyState title="No recordings yet">Run the recorder command above, then compile it.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="tbl text-lg">
            <thead>
              <tr>
                <th>Recording</th>
                <th>Site</th>
                <th>Events</th>
                <th>Recorded</th>
                <th>Compiled → tool</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map(({ tool, rec }) => (
                <tr key={tool.id}>
                  <td>
                    <b>{rec?.taskName ?? tool.name}</b>
                    <div className="font-mono text-sm">{tool.createdFrom}</div>
                  </td>
                  <td>{rec?.siteOrigin ?? "—"}</td>
                  <td>{rec?.events.length ?? "—"}</td>
                  <td className="whitespace-nowrap">{rec ? formatTime(rec.createdAt) : "—"}</td>
                  <td>
                    <Link href={`/tools/${tool.id}`} className="font-bold underline">
                      {tool.name} v{tool.version}
                    </Link>{" "}
                    <StatusBadge status={tool.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
