import type { MessageEndEvent, MessageUpdateEvent } from "@oh-my-pi/pi-coding-agent";
import type {
  EvidenceSource,
  HolmesEvidence,
  MessageObservationState,
  ScopeEnvelope,
} from "./types";
import { CLASSIFY_MARKER, LAYER0_TERMS, MAX_SCAN_CHARS } from "./types";

const BARE_CLASSIFY_MARKER =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:HOLMES\s*:\s*Tier\s*([1234])|\[?\s*CLASSIFY\s*:\s*Tier\s*([1234])\s*\]?|\[\s*Tier\s*([1234])\s*\])/i;

export function updateObservation(
  state: MessageObservationState,
  event: MessageUpdateEvent,
): void {
  if (event.message.role !== "assistant") return;

  const update = event.assistantMessageEvent;
  switch (update.type) {
    case "text_start":
      state.visibleByIndex.set(update.contentIndex, "");
      break;
    case "text_delta":
      appendBlock(state.visibleByIndex, update.contentIndex, update.delta);
      break;
    case "text_end":
      setBlock(state.visibleByIndex, update.contentIndex, update.content);
      break;
    case "thinking_start":
      state.thinkingByIndex.set(update.contentIndex, "");
      break;
    case "thinking_delta":
      appendBlock(state.thinkingByIndex, update.contentIndex, update.delta);
      break;
    case "thinking_end":
      setBlock(state.thinkingByIndex, update.contentIndex, update.content);
      break;
    default:
      return;
  }

  refreshEvidence(state);
}

export function reconcileObservation(
  state: MessageObservationState,
  event: MessageEndEvent,
): void {
  if (event.message.role !== "assistant") return;
  if (!Array.isArray(event.message.content)) return;

  state.visibleByIndex.clear();
  state.thinkingByIndex.clear();

  event.message.content.forEach((block, index) => {
    if (block.type === "text") {
      setBlock(state.visibleByIndex, index, block.text);
    } else if (block.type === "thinking") {
      setBlock(state.thinkingByIndex, index, block.thinking);
    }
  });

  refreshEvidence(state);
}

// Non-authoritative telemetry only. Visible assistant text never authorizes
// mutation; the extension-owned classification record and lease do.
export function hasVisibleClassification(
  state: MessageObservationState,
): boolean {
  return state.visibleEvidence?.tier !== undefined;
}

// Telemetry only. HOLMES evidence detected in assistant text is compliance
// signal, not mutation authorization.
export function detectHolmesEvidence(
  text: string,
  source: EvidenceSource,
): HolmesEvidence | undefined {
  const scan = limitText(text);

  CLASSIFY_MARKER.lastIndex = 0;
  BARE_CLASSIFY_MARKER.lastIndex = 0;
  const marker = CLASSIFY_MARKER.exec(scan) ?? BARE_CLASSIFY_MARKER.exec(scan);
  if (!marker) {
    LAYER0_TERMS.lastIndex = 0;
    return LAYER0_TERMS.test(scan)
      ? { source, matchedAt: Date.now(), hasLayer0Terms: true }
      : undefined;
  }

  LAYER0_TERMS.lastIndex = 0;
  return {
    tier: Number(marker[1] ?? marker[2] ?? marker[3]) as HolmesEvidence["tier"],
    marker: marker[0],
    source,
    matchedAt: Date.now(),
    hasLayer0Terms: LAYER0_TERMS.test(scan),
  };
}

// Telemetry helper only. The presence of HOLMES-looking prose is not
// authorization evidence.
export function redactSelfClassification(text: string): string {
  return limitText(text).replace(
    /^.*(?:HOLMES\s*:\s*Tier\s*[1-4]|\[?\s*CLASSIFY\s*:\s*Tier\s*[1-4]\s*\]?|\[\s*Tier\s*[1-4]\s*\]).*$/gim,
    "[HOLMES_SELF_CLASSIFICATION_REDACTED]",
  );
}

export function extractPathMentions(text: string): string[] {
  const mentions: string[] = [];
  const scan = limitText(text);

  collectMatches(scan, INTERNAL_URI_PATTERN, mentions, normalizePathMention);
  collectMatches(scan, PATH_MENTION_PATTERN, mentions, normalizePathMention);

  return mentions;
}

export function detectAssistantBroadenedScope(
  text: string,
  priorScope: ScopeEnvelope,
): boolean {
  const allowedPaths = priorScope.paths.map(normalizePathMention).filter(Boolean);
  const mentionedPaths = extractPathMentions(redactSelfClassification(text));

  return mentionedPaths.some((path) => !pathCoveredByScope(path, allowedPaths));
}

export function detectTier2Compliance(text: string): {
  target?: string;
  delta?: string;
  next?: string;
} {
  const sections = extractLabeledSections(
    text,
    ["target", "delta", "next"],
    ["target", "now", "delta", "next"],
  );

  return {
    target: sections.target,
    delta: sections.delta,
    next: sections.next,
  };
}

export function detectTier3SinglePassCompliance(text: string): {
  hone?: string;
  observe?: string;
  ladder?: string;
  map?: string;
  establish?: string;
  synthesize?: string;
} {
  const sections = extractLabeledSections(text, [
    "hone",
    "observe",
    "ladder",
    "map",
    "establish",
    "synthesize",
  ]);

  return {
    hone: sections.hone,
    observe: sections.observe,
    ladder: sections.ladder,
    map: sections.map,
    establish: sections.establish,
    synthesize: sections.synthesize,
  };
}

export function detectTier4Pass(text: string): {
  passContent: string;
  evidenceRefs: string[];
} {
  const scan = limitText(text);
  const tier4Cue =
    /\bTier\s*4\b|potentially\s+cascading|cascading\s+impact|fixed\s+point|closure|blocking\s+unknowns?|blockers?/i.test(
      scan,
    );
  const holmesCue =
    /\bHOLMES\b|\bHone\s*:|\bObserve\s*:|\bLadder\s*:|\bMap\s*:|\bEstablish\s*:|\bSynthesize\s*:/i.test(
      scan,
    );

  if (!tier4Cue || !holmesCue) {
    return { passContent: "", evidenceRefs: [] };
  }

  return {
    passContent: extractLikelyTier4Content(scan),
    evidenceRefs: extractEvidenceReferences(scan),
  };
}

export function extractEvidenceReferences(text: string): string[] {
  const refs: string[] = [];
  const scan = limitText(text);

  collectMatches(scan, INTERNAL_URI_PATTERN, refs, sanitizeEvidenceReference);
  collectMatches(scan, EVIDENCE_REFERENCE_PATTERN, refs, sanitizeEvidenceReference);
  collectMatches(scan, LINE_REFERENCE_PATTERN, refs, sanitizeEvidenceReference);

  return refs;
}


const INTERNAL_URI_PATTERN =
  /\b(?:agent|artifact|memory|skill|rule|local|vault|mcp|issue|pr):\/\/[^\s<>()\[\]{}"'`]+/gi;
const PATH_MENTION_PATTERN =
  /(?:^|[\s"'`([{<])(¶?(?:\.{1,2}\/|\/|[A-Za-z0-9_.@+-]+\/)[A-Za-z0-9_.@+~:/#-]+|¶?\.?[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|markdown|yaml|yml|toml|css|scss|html|txt|sql|py|rs|go|java|c|cc|cpp|h|hpp|sh|env)(?::\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)?)*)?(?:#[0-9A-Fa-f]{2,})?)/g;
const EVIDENCE_REFERENCE_PATTERN =
  /(?:^|[\s"'`([{<])(¶?(?:\.{1,2}\/|\/|[A-Za-z0-9_.@+-]+\/)[A-Za-z0-9_.@+~:/#-]+|¶?\.?[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|markdown|yaml|yml|toml|css|scss|html|txt|sql|py|rs|go|java|c|cc|cpp|h|hpp|sh|env)(?::\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)?)*)?(?:#[0-9A-Fa-f]{2,})?)/g;
const LINE_REFERENCE_PATTERN = /\blines?\s+\d+(?:\s*[-–]\s*\d+)?\b/gi;
const SECTION_LABEL_PATTERN =
  /^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?\s*([A-Za-z][A-Za-z0-9 ]{0,40})(?:\s*\*\*)?\s*[:：-]\s*(.*)$/;
const WORKSPACE_PATH_ROOTS = new Set([
  ".planning",
  "agents",
  "commands",
  "docs",
  "hooks",
  "lib",
  "packages",
  "research",
  "rules",
  "scripts",
  "skills",
  "src",
  "test",
  "tests",
]);

function collectMatches(
  text: string,
  pattern: RegExp,
  output: string[],
  normalize: (value: string) => string,
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = normalize(match[1] ?? match[0]);
    if (value.length > 0 && !output.includes(value)) output.push(value);
    if (match[0].length === 0) pattern.lastIndex++;
  }
}

function extractLabeledSections(
  text: string,
  captureLabels: readonly string[],
  boundaryLabels: readonly string[] = captureLabels,
): Record<string, string | undefined> {
  const capture = new Set(captureLabels.map(canonicalLabel));
  const boundary = new Set(boundaryLabels.map(canonicalLabel));
  const sections: Record<string, string> = {};
  let current: string | undefined;

  for (const line of limitText(text).split(/\r?\n/)) {
    const labeled = parseSectionLabel(line, boundary);
    if (labeled) {
      current = capture.has(labeled.label) ? labeled.label : undefined;
      if (current) {
        sections[current] = appendSectionContent(
          sections[current],
          labeled.content,
        );
      }
      continue;
    }

    if (current) {
      sections[current] = appendSectionContent(sections[current], line);
    }
  }

  const result: Record<string, string | undefined> = {};
  for (const label of capture) {
    const value = sections[label]?.trim();
    if (value) result[label] = limitText(value);
  }

  return result;
}

function parseSectionLabel(
  line: string,
  boundary: ReadonlySet<string>,
): { label: string; content: string } | undefined {
  const match = SECTION_LABEL_PATTERN.exec(line);
  if (!match) return undefined;

  const label = canonicalLabel(match[1]);
  if (!boundary.has(label)) return undefined;
  return { label, content: match[2].trim() };
}

function appendSectionContent(current: string | undefined, line: string): string {
  if (current === undefined || current.length === 0) return line;
  if (line.length === 0) return `${current}\n`;
  return `${current}\n${line}`;
}

function canonicalLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractLikelyTier4Content(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /\bTier\s*4\b|\bHOLMES\b|potentially\s+cascading|cascading\s+impact|fixed\s+point|closure|blocking\s+unknowns?|blockers?/i.test(
      line,
    ),
  );

  return limitText(lines.slice(start < 0 ? 0 : start).join("\n").trim());
}

function pathCoveredByScope(path: string, allowedPaths: readonly string[]): boolean {
  if (allowedPaths.length === 0) return false;

  return allowedPaths.some((allowed) => {
    if (allowed.length === 0) return false;
    if (path === allowed) return true;
    if (isInternalUri(path) || isInternalUri(allowed)) {
      const prefix = allowed.endsWith("/") ? allowed : `${allowed}/`;
      return path.startsWith(prefix);
    }

    const directory = allowed.endsWith("/") || !lastSegment(allowed).includes(".");
    const prefix = allowed.endsWith("/") ? allowed : `${allowed}/`;
    return directory && path.startsWith(prefix);
  });
}

function normalizePathMention(value: string): string {
  const sanitized = sanitizeEvidenceReference(value);
  if (sanitized.length === 0) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(sanitized) && !isInternalUri(sanitized)) {
    return "";
  }
  if (isInternalUri(sanitized)) return sanitized;

  const withoutSelectors = sanitized
    .replace(/#[0-9A-Fa-f]{2,}$/u, "")
    .replace(/:(?:raw|conflicts)$/iu, "")
    .replace(/:\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)?)*$/u, "");
  const normalized = normalizePathSegments(withoutSelectors.replace(/\\/g, "/"));

  return looksLikeWorkspacePath(normalized) ? normalized : "";
}

function sanitizeEvidenceReference(value: string): string {
  let ref = value.trim().replace(/^¶/u, "");
  while (ref.length > 0 && "`'\"([{<".includes(ref.charAt(0))) {
    ref = ref.slice(1);
  }
  while (ref.length > 0 && "`'\".,;!?)\\]}>".includes(ref.charAt(ref.length - 1))) {
    ref = ref.slice(0, -1);
  }
  return ref;
}

function normalizePathSegments(path: string): string {
  const absolute = path.startsWith("/");
  const trailingSlash = path.endsWith("/");
  const segments: string[] = [];

  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0 || segments[segments.length - 1] === "..") {
        if (!absolute) segments.push(part);
      } else {
        segments.pop();
      }
      continue;
    }
    segments.push(part);
  }

  const normalized = `${absolute ? "/" : ""}${segments.join("/")}`;
  return trailingSlash && normalized.length > 0 ? `${normalized}/` : normalized;
}

function looksLikeWorkspacePath(path: string): boolean {
  if (path.length === 0 || path === "." || path === "..") return false;
  if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) {
    return true;
  }
  const first = path.split("/", 1)[0];
  if (WORKSPACE_PATH_ROOTS.has(first)) return true;
  if (path.includes("/") && lastSegment(path).includes(".")) return true;
  return !path.includes("/") && lastSegment(path).includes(".");
}

function lastSegment(path: string): string {
  const withoutTrailingSlash = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = withoutTrailingSlash.lastIndexOf("/");
  return index < 0 ? withoutTrailingSlash : withoutTrailingSlash.slice(index + 1);
}

function isInternalUri(value: string): boolean {
  return /^(?:agent|artifact|memory|skill|rule|local|vault|mcp|issue|pr):\/\//i.test(
    value,
  );
}
function refreshEvidence(state: MessageObservationState): void {
  state.visibleText = joinBlocks(state.visibleByIndex);
  state.thinkingText = joinBlocks(state.thinkingByIndex);
  state.visibleEvidence = detectHolmesEvidence(state.visibleText, "visible_text");
  state.thinkingEvidence = detectHolmesEvidence(state.thinkingText, "thinking");
}

function appendBlock(
  blocks: Map<number, string>,
  contentIndex: number,
  delta: string,
): void {
  blocks.set(contentIndex, appendBounded(blocks.get(contentIndex), delta));
}

function appendBounded(current: string | undefined, delta: string): string {
  const existing = current ?? "";
  if (delta.length === 0 || existing.length >= MAX_SCAN_CHARS) return existing;
  if (existing.length === 0) return limitText(delta);

  const remaining = MAX_SCAN_CHARS - existing.length;
  return existing + (delta.length <= remaining ? delta : delta.slice(0, remaining));
}

function setBlock(
  blocks: Map<number, string>,
  contentIndex: number,
  text: string,
): void {
  blocks.set(contentIndex, limitText(text));
}

function joinBlocks(blocks: Map<number, string>): string {
  const entries = [...blocks.entries()].sort(([left], [right]) => left - right);
  let joined = "";
  let first = true;

  for (const [, text] of entries) {
    if (!first) {
      if (joined.length >= MAX_SCAN_CHARS) break;
      joined += "\n";
    }
    first = false;

    const remaining = MAX_SCAN_CHARS - joined.length;
    if (remaining <= 0) break;
    joined += text.length <= remaining ? text : text.slice(0, remaining);
  }

  return joined;
}

function limitText(text: string): string {
  return text.length <= MAX_SCAN_CHARS ? text : text.slice(0, MAX_SCAN_CHARS);
}
