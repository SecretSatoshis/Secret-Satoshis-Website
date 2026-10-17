import type OpenAI from "openai";
import type {
  FunctionShellTool,
  SkillReference,
} from "openai/resources/responses/responses";

// The hosted shell (path B): a container with the existing skills mounted, for
// open-ended analysis, the user's spreadsheets and PDFs, and files the user
// asks for. The organization's allowlist must include these domains too.
export const SHELL_DOMAINS = [
  "bitview.space",
  "secretsatoshis.github.io",
  "charts.secretsatoshis.com",
  "newsletter.secretsatoshis.com",
  "gamma-api.polymarket.com",
  "data-api.polymarket.com",
  "clob.polymarket.com",
];
export const OUTPUTS = "/mnt/data/outputs";

/** Skills pinned as "skill_id:version" (or just the ID for its default), comma-separated. */
export function skillRefs(
  spec = process.env.AGENT21_SKILLS ?? "",
): SkillReference[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [skill_id, version] = entry.split(":");
      return {
        type: "skill_reference" as const,
        skill_id,
        ...(version ? { version } : {}),
      };
    });
}

/** A new container for the conversation, or the one it already has. */
export function shellTool(options: {
  containerId?: string;
  fileIds?: string[];
  skills?: SkillReference[];
  domains?: string[];
}): FunctionShellTool {
  if (options.containerId)
    return {
      type: "shell",
      environment: {
        type: "container_reference",
        container_id: options.containerId,
      },
    };
  return {
    type: "shell",
    environment: {
      type: "container_auto",
      ...(options.fileIds?.length ? { file_ids: options.fileIds } : {}),
      network_policy: {
        type: "allowlist",
        allowed_domains: options.domains ?? SHELL_DOMAINS,
      },
      ...(options.skills?.length ? { skills: options.skills } : {}),
    },
  };
}

/** Files the shell left in the outputs folder, with their bytes. */
export async function harvest(client: OpenAI, containerId: string) {
  const out: { name: string; path: string; bytes: Buffer }[] = [];
  for await (const file of client.containers.files.list(containerId)) {
    if (
      !file.path.startsWith(`${OUTPUTS}/`) ||
      file.path.slice(OUTPUTS.length + 1).includes("/")
    )
      continue;
    const response = await client.containers.files.content.retrieve(file.id, {
      container_id: containerId,
    });
    out.push({
      name: file.path.slice(OUTPUTS.length + 1),
      path: file.path,
      bytes: Buffer.from(await response.arrayBuffer()),
    });
  }
  return out;
}
