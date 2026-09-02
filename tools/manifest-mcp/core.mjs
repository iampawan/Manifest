// Pure state machines for the Manifest MCP contract and delivery cores.
//
// These functions intentionally do not read a checkout or call Jira/GitHub.
// The connected agent supplies fetched content/evidence, executes the returned
// connector calls with its own approvals, and writes the returned artifacts.

const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;
const OPEN = "open";

function isConfluenceSource(source) {
  try {
    const url = new URL(source);
    if (!/^https?:$/.test(url.protocol)) return false;
    return /confluence/i.test(url.hostname)
      || (/\.atlassian\.net$/i.test(url.hostname) && /^\/wiki(?:\/|$)/i.test(url.pathname))
      || /(?:^|\/)confluence(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractJiraIssueKey(value = "") {
  return String(value).match(JIRA_KEY_RE)?.[0] || null;
}

export function detectSourceType(value = "") {
  const source = String(value).trim();
  if (!source) return "unknown";
  // Atlassian hosts both Jira and Confluence. Resolve the more specific wiki
  // shape first so a page title/query containing a Jira key is not misrouted.
  if (isConfluenceSource(source)) return "confluence";
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(source) || (/atlassian\.net/i.test(source) && extractJiraIssueKey(source))) return "jira";
  if (/linear\.app/i.test(source)) return "linear";
  if (/notion\.(?:so|site)/i.test(source)) return "notion";
  if (/docs\.google\.com\/document/i.test(source)) return "google-doc";
  if (/slack\.com\/archives/i.test(source)) return "slack";
  if (/github\.com/i.test(source)) return "github";
  if (/figma\.com/i.test(source)) return "figma";
  if (/^https?:\/\//i.test(source)) return "url";
  return "text";
}

export function contractSummary(parsed) {
  const fm = parsed.frontmatter || {};
  return {
    id: fm.id || null,
    title: fm.title || null,
    status: fm.status || "draft",
    revision: fm.revision || 1,
    complexity: fm.complexity || null,
    platforms: Array.isArray(fm.platforms) ? fm.platforms : [],
    behaviors: (parsed.behaviors || []).map((behavior) => ({ id: behavior.id, title: behavior.title })),
    acceptanceCriteria: (parsed.acs || []).map((ac) => ({ id: ac.id, text: ac.text, behaviorRefs: ac.behaviorRefs || [] })),
    jira: fm.jira || null,
  };
}

export function planContractPickup({ source = "", hasSourceContent = false, hasContract = false, connectorAvailable = true, atlassianCloudId = "" } = {}) {
  const sourceType = detectSourceType(source);
  const jiraIssueKey = sourceType === "jira" ? extractJiraIssueKey(source) : null;
  const steps = [];

  if (sourceType === "jira" && !hasSourceContent && !hasContract) {
    if (jiraIssueKey && connectorAvailable) {
      steps.push({
        id: "fetch-source",
        status: "ready",
        actor: "agent",
        connectorCall: atlassianCloudId
          ? { tool: "getJiraIssue", arguments: { cloudId: atlassianCloudId, issueIdOrKey: jiraIssueKey } }
          : { tool: "getAccessibleAtlassianResources", arguments: {} },
        retryWith: atlassianCloudId ? null : { atlassianCloudId: "<selected Jira cloud ID>" },
      });
    } else {
      steps.push({
        id: "fetch-source",
        status: "blocked",
        actor: "human",
        reason: jiraIssueKey ? "Atlassian connector unavailable; paste the issue content." : "The Jira URL has no issue key; provide a specific issue URL.",
      });
    }
  } else if (!hasSourceContent && !hasContract && !["text", "unknown"].includes(sourceType)) {
    steps.push({
      id: "fetch-source",
      status: "ready",
      actor: "agent",
      action: "Fetch the source with the matching connector/browser, then call pickup again with sourceContent.",
      sourceType,
    });
  } else {
    steps.push({ id: "fetch-source", status: "complete", actor: "agent" });
  }

  steps.push({
    id: "draft-contract",
    status: hasContract ? "complete" : (steps[0].status === "complete" ? "ready" : "pending"),
    actor: "agent",
    resources: ["manifest:///skills/contract-pickup/SKILL.md", "manifest:///reference/CONTRACT-FORMAT.md"],
  });
  steps.push({
    id: "verify-contract",
    status: hasContract ? "ready" : "pending",
    actor: "manifest_contract_verify",
  });
  steps.push({
    id: "sync-jira",
    status: hasContract && jiraIssueKey ? "ready" : "optional",
    actor: "manifest_jira_sync",
  });

  const next = steps.find((step) => ["ready", "blocked"].includes(step.status)) || steps.at(-1);
  return {
    source: { type: sourceType, value: source, jiraIssueKey },
    status: next.status === "blocked" ? "needs_input" : hasContract ? "ready_to_verify" : next.id === "fetch-source" && next.status === "ready" ? "needs_source" : "needs_contract_draft",
    next,
    steps,
    requiredArtifacts: ["<ID>.md", "<ID>.findings.md", "<ID>.findings.json"],
  };
}

function findingKey(finding) {
  return [finding.critic, finding.fragmentRef, finding.message].join("\u0000");
}

export function mergeContractFindings(deterministic = [], judgment = [], prior = []) {
  const priorStatuses = new Map((prior || []).map((finding) => [findingKey(finding), finding.status]));
  const seen = new Set();
  const merged = [];
  for (const raw of [...deterministic, ...judgment]) {
    const finding = { ...raw };
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    if (priorStatuses.has(key) && ["acknowledged", "dismissed", "resolved"].includes(priorStatuses.get(key))) {
      finding.status = priorStatuses.get(key);
    }
    merged.push(finding);
  }
  return merged;
}

function shortFinding(finding) {
  const suggestion = finding.suggestion ? ` ${finding.suggestion}` : "";
  return `${finding.message}${suggestion}  _(${finding.critic} · ${finding.id})_`;
}

export function renderContractFindings({ summary, readiness, findings, verifyMode = "full", verifiedAt, pluginVersion }) {
  const blockers = findings.filter((finding) => finding.status === OPEN && finding.severity === "blocker");
  const warnings = findings.filter((finding) => finding.status === OPEN && finding.severity === "warning");
  const info = findings.filter((finding) => finding.status === OPEN && finding.severity === "info");
  const promotable = verifyMode === "full" && readiness.promotable;
  const lines = [
    "---",
    `contractId: ${summary.id}`,
    `verifiedAt: ${verifiedAt}`,
    `pluginVersion: ${pluginVersion}`,
    `readiness: ${readiness.readiness}`,
    `promotable: ${promotable}`,
    `openBlockers: ${readiness.openBlockers}`,
    `openWarnings: ${readiness.openWarnings}`,
    `verifyMode: ${verifyMode}`,
    "---",
    "",
    `# Findings - ${summary.title} (${summary.id})`,
    "",
    promotable
      ? "**Promotable: yes.** There are no open blockers."
      : `**Promotable: not yet.** ${blockers.length ? `${blockers.length} must-fix item(s) remain.` : "A full verify is required."}`,
    "Edit the contract, not this generated findings file.",
    "",
    "## Must fix (blockers)",
    "",
    ...(blockers.length ? blockers.map((finding, index) => `${index + 1}. ${shortFinding(finding)}`) : ["None."]),
    "",
    "## Worth a look (warnings, advisory)",
    "",
    ...(warnings.length ? warnings.map((finding, index) => `${index + 1}. ${shortFinding(finding)}`) : ["None."]),
    "",
    "## FYI",
    "",
    info.length ? `${info.length} info finding(s). Full structured text is in the JSON companion.` : "None.",
    "",
    "## What to do next",
    "",
    promotable ? "Promote now, or address advisory warnings first." : blockers.length ? "Fix the blocker(s) in the contract, then run a bounded contract fix pass or verify again." : "Run a full verify before promotion.",
    "",
  ];
  return lines.join("\n");
}

function jiraKeyFrom(frontmatter = {}, source = "", explicit = "") {
  return explicit || frontmatter.jira?.issue || frontmatter.jira?.epic || extractJiraIssueKey(source) || null;
}

function contractDescription(summary, contractUrl, readyCheckCode) {
  const ac = summary.acceptanceCriteria.map((item) => `- [ ] ${item.id}: ${item.text}`).join("\n") || "- [ ] Acceptance criteria not yet authored";
  return [
    `## Goal / contract`,
    `${summary.title} (${summary.id})`,
    "",
    `Platforms: ${summary.platforms.join(", ") || "not specified"}`,
    `Complexity: ${summary.complexity || "not sized"}`,
    readyCheckCode ? `Ready-Check: ${readyCheckCode}` : null,
    contractUrl ? `Contract: ${contractUrl}` : null,
    "",
    "## Acceptance criteria",
    ac,
  ].filter((line) => line !== null).join("\n");
}

function jiraDueDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/);
  if (isoDate) return isoDate[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function lifecycleDedupeKey(issueKey, event, eventData = {}) {
  const payload = Object.entries(eventData || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, value]);
  return `${issueKey}:${event}:${JSON.stringify(payload)}`;
}

const JIRA_EVENTS = {
  implement_started: { status: "In Progress", comment: ({ contractId, branch }) => `Implementation started · contract ${contractId}${branch ? ` · branch ${branch}` : ""}.` },
  milestone_done: { comment: ({ acId, done, total }) => `${acId ? `${acId} done` : "Milestone done"}${done != null && total != null ? ` · ${done}/${total} acceptance criteria passing` : ""}.` },
  blocked: { status: "Blocked", label: "blocked", comment: ({ reason }) => `Blocked: ${reason || "reason not supplied"}.` },
  pr_opened: { status: "In Review", comment: ({ prUrl }) => `PR opened${prUrl ? `: ${prUrl}` : "."}` },
  verify_pr: { comment: ({ verdict, reviewUrl }) => `verify-pr: ${verdict || "completed"}${reviewUrl ? ` · ${reviewUrl}` : ""}.` },
  code_review: { comment: ({ verdict, reviewUrl }) => `code-review: ${verdict || "completed"}${reviewUrl ? ` · ${reviewUrl}` : ""}.` },
  done: { status: "Done", comment: ({ summary }) => summary || "Manifest delivery completed." },
  status: { readOnly: true },
};

export function planJiraSync({
  action = "read",
  source = "",
  issueKey = "",
  frontmatter = {},
  summary = null,
  confirmed = false,
  projectKey = "",
  issueType = "Story",
  contractUrl = "",
  readyCheckCode = "",
  event = "",
  eventData = {},
  appliedDedupeKeys = [],
  cloudId = "",
} = {}) {
  const key = jiraKeyFrom(frontmatter, source, issueKey);
  const base = { action, issueKey: key, cloudId: cloudId || null, confirmed, connector: "Atlassian", calls: [], frontmatterPatch: {} };
  const cloudResolution = {
    ...base,
    status: "needs_cloud_id",
    reason: "Resolve the user's Jira cloud ID, then call this operation again with cloudId.",
    calls: [{ tool: "getAccessibleAtlassianResources", arguments: {} }],
  };

  if (action === "read") {
    if (!key) return { ...base, status: "needs_issue_key", reason: "Provide a Jira issue URL or raw issue key." };
    if (!cloudId) return cloudResolution;
    return { ...base, status: "ready", calls: [{ tool: "getJiraIssue", arguments: { cloudId, issueIdOrKey: key } }] };
  }

  if (action === "upsert") {
    if (!summary?.id || !summary?.title) return { ...base, status: "invalid", reason: "A parsed contract summary is required." };
    const description = contractDescription(summary, contractUrl, readyCheckCode);
    const dueDate = frontmatter.slaDeadline ? jiraDueDate(frontmatter.slaDeadline) : null;
    if (frontmatter.slaDeadline && !dueDate) {
      return { ...base, status: "invalid", reason: "slaDeadline must be a valid date; Jira due dates require YYYY-MM-DD.", preview: { existingIssue: key, projectKey: projectKey || frontmatter.jira?.project || null, issueType } };
    }
    const fields = {
      summary: summary.title,
      description,
      labels: ["manifest", String(summary.complexity || "unsized").toLowerCase()],
      ...(dueDate ? { duedate: dueDate } : {}),
    };
    const preview = { existingIssue: key, projectKey: projectKey || frontmatter.jira?.project || null, issueType, fields };
    if (!confirmed) return { ...base, status: "awaiting_confirmation", requiresConfirmation: true, preview };
    if (!cloudId) return { ...cloudResolution, preview };
    if (key) {
      const fieldsWithoutLabels = { ...fields };
      delete fieldsWithoutLabels.labels;
      return {
        ...base,
        status: "ready",
        preview,
        calls: [
          { id: "read-current-labels", tool: "getJiraIssue", arguments: { cloudId, issueIdOrKey: key, fields: ["labels"] }, purpose: "Read current labels before merging Manifest labels." },
          {
            tool: "editJiraIssue",
            arguments: { cloudId, issueIdOrKey: key, fields: { ...fieldsWithoutLabels, labels: "<existing labels plus manifest and complexity>" } },
            dependsOn: "read-current-labels",
            resolution: { preserveExistingLabels: true, addLabels: fields.labels, rule: "Materialize the merged label array from the preceding getJiraIssue result before executing this edit." },
          },
        ],
        frontmatterPatch: { jira: { ...(frontmatter.jira || {}), issue: key } },
      };
    }
    const project = projectKey || frontmatter.jira?.project;
    if (!project) return { ...base, status: "needs_project", reason: "Confirm the Jira project key before creating a ticket.", preview };
    return {
      ...base,
      status: "ready",
      preview,
      calls: [
        { id: "resolve-issue-type", tool: "getJiraProjectIssueTypesMetadata", arguments: { cloudId, projectIdOrKey: project }, purpose: "Resolve the real issue type metadata before create." },
        {
          tool: "createJiraIssue",
          arguments: {
            cloudId,
            projectKey: project,
            issueTypeName: issueType,
            summary: fields.summary,
            description: fields.description,
            additional_fields: Object.fromEntries(Object.entries(fields).filter(([name]) => !["summary", "description"].includes(name))),
          },
          dependsOn: "resolve-issue-type",
        },
      ],
      frontmatterPatch: { jira: { ...(frontmatter.jira || {}), project, issue: "<created issue key>" } },
    };
  }

  if (action === "event") {
    if (!key) return { ...base, status: "skipped", reason: "No Jira key is recorded; delivery continues without Jira." };
    const mapping = JIRA_EVENTS[event];
    if (!mapping) return { ...base, status: "invalid", reason: `Unknown lifecycle event: ${event}` };
    if (mapping.readOnly) {
      if (!cloudId) return cloudResolution;
      return { ...base, status: "ready", calls: [{ tool: "getJiraIssue", arguments: { cloudId, issueIdOrKey: key } }] };
    }
    const dedupeKey = lifecycleDedupeKey(key, event, eventData);
    if (appliedDedupeKeys.includes(dedupeKey)) {
      return { ...base, status: "already_applied", calls: [], dedupeKey };
    }
    if (!confirmed) {
      return { ...base, status: "awaiting_confirmation", requiresConfirmation: true, dedupeKey, preview: { event, desiredStatus: mapping.status || null, comment: mapping.comment?.(eventData) || null } };
    }
    if (!cloudId) return { ...cloudResolution, dedupeKey };
    const calls = [];
    if (mapping.status) {
      calls.push({ id: "resolve-transition", tool: "getTransitionsForJiraIssue", arguments: { cloudId, issueIdOrKey: key } });
      calls.push({
        tool: "transitionJiraIssue",
        arguments: { cloudId, issueIdOrKey: key, transition: { id: "<resolved transition id>" } },
        dependsOn: "resolve-transition",
        resolution: { desiredStatus: mapping.status, rule: "Choose the nearest available transition by name; never hard-code a transition ID." },
      });
    }
    if (mapping.comment) calls.push({ tool: "addCommentToJiraIssue", arguments: { cloudId, issueIdOrKey: key, commentBody: mapping.comment(eventData) } });
    if (mapping.label) {
      calls.push({ id: "read-current-labels", tool: "getJiraIssue", arguments: { cloudId, issueIdOrKey: key, fields: ["labels"] } });
      calls.push({
        tool: "editJiraIssue",
        arguments: { cloudId, issueIdOrKey: key, fields: { labels: `<existing labels plus ${mapping.label}>` } },
        dependsOn: "read-current-labels",
        resolution: "Preserve existing labels and append the lifecycle label only when absent.",
      });
    }
    return { ...base, status: "ready", calls, dedupeKey };
  }

  return { ...base, status: "invalid", reason: `Unknown Jira sync action: ${action}` };
}

export function initializeImplementState(parsed, currentState = null) {
  const summary = contractSummary(parsed);
  if (currentState) return structuredClone(currentState);
  return {
    contractId: summary.id,
    revision: summary.revision,
    iteration: 0,
    planPath: `.manifest/contracts/${summary.id}.implementation-plan.md`,
    acStatus: Object.fromEntries(summary.acceptanceCriteria.map((ac) => [ac.id, { status: "pending", test: null }])),
    filesTouched: [],
    decisions: [],
  };
}

function nextPendingAc(state) {
  return Object.entries(state.acStatus || {}).find(([, value]) => value.status !== "done")?.[0] || null;
}

export function planImplementation({ parsed, state, stateStatus, stateErrors = [], repo = {}, mode = "build", prNumber = null }) {
  const summary = contractSummary(parsed);
  const fm = parsed.frontmatter || {};
  const expectedAcIds = summary.acceptanceCriteria.map((ac) => ac.id).sort();
  const stateAcIds = Object.keys(state.acStatus || {}).sort();
  const compatibilityErrors = [
    ...(state.contractId !== summary.id ? [`implement-state contractId ${state.contractId || "<missing>"} does not match ${summary.id}`] : []),
    ...(Number(state.revision) !== Number(summary.revision) ? [`implement-state revision ${state.revision ?? "<missing>"} does not match ${summary.revision}`] : []),
    ...(JSON.stringify(stateAcIds) !== JSON.stringify(expectedAcIds) ? ["implement-state acceptance-criterion IDs do not match the promoted contract revision"] : []),
  ];
  if (stateErrors.length || compatibilityErrors.length) return { status: "invalid_state", errors: [...stateErrors, ...compatibilityErrors] };
  if (fm.implementation === "human-led") {
    return { status: "human_handoff", reason: "Contract is marked human-led; Manifest should verify, not write the implementation." };
  }
  if (mode === "build" && fm.status !== "promoted") {
    return { status: "not_promoted", reason: `Contract status is ${fm.status || "draft"}; promote it before implementation.` };
  }
  if (!repo.framework && !(repo.languages || []).length && !repo.toolchain) {
    return { status: "needs_toolchain", reason: "Resolve the target repository framework/languages/toolchain before implementation." };
  }
  const nextAc = nextPendingAc(state);
  const requiredChecks = ["test", "integration/e2e", "lint", "typecheck", "build"].map((kind) => {
    const configured = repo.toolchain?.[kind];
    const explicitlySkipped = configured === false;
    const command = typeof configured === "string" && configured.trim() ? configured : null;
    return { kind, command, required: !explicitlySkipped, resolved: explicitlySkipped || Boolean(command) };
  });
  const unresolvedChecks = requiredChecks.filter((check) => check.required && !check.resolved).map((check) => check.kind);
  return {
    status: stateStatus.complete ? "implementation_complete" : "ready",
    mode,
    contract: summary,
    repository: repo,
    prNumber,
    state,
    progress: stateStatus,
    nextAction: nextAc ? { type: "implement_ac", acId: nextAc, acceptanceCriterion: summary.acceptanceCriteria.find((ac) => ac.id === nextAc) } : { type: "self_review" },
    requiredChecks,
    unresolvedChecks,
    localGate: unresolvedChecks.length ? "needs_check_resolution" : "resolved",
    invariants: [
      "Read the promoted revision snapshot, not an editable live draft.",
      "Write feature code and tests only to the target branch; keep Manifest artifacts in the contracts location.",
      "Update implement-state after each acceptance criterion passes.",
      "Do not open or update the PR until resolved local checks are green.",
      "Run the full code-review catalog before the first push and on every fix iteration.",
    ],
  };
}

function addedPatchText(pr = {}) {
  return (pr.changedFiles || []).map((file) => {
    if (!file.patch) return `${file.path || ""}\n${file.content || ""}`;
    const additions = String(file.patch)
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
    return `${file.path || ""}\n${additions}`;
  }).join("\n");
}

function testEvidenceFor(acId, tests = []) {
  const escapedId = String(acId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tests.filter((test) =>
    (test.acIds || []).includes(acId) || new RegExp(`\\b${escapedId}\\b`, "i").test(`${test.name || ""} ${test.path || ""}`)
  );
}

export function verifyPullRequest({ parsed, pr = {}, requiredFeatureFlag = "" }) {
  const summary = contractSummary(parsed);
  const diff = addedPatchText(pr);
  const acCoverage = summary.acceptanceCriteria.map((ac) => {
    const evidence = testEvidenceFor(ac.id, pr.tests || []);
    const passed = evidence.some((test) => ["passed", "pass", "success"].includes(String(test.status).toLowerCase()));
    return { acId: ac.id, text: ac.text, covered: evidence.length > 0, passed, evidence };
  });
  const missingAcs = acCoverage.filter((entry) => !entry.passed);

  const requiredEvents = [...new Set((parsed.behaviors || []).map((behavior) => behavior.instrumentation?.eventName).filter(Boolean))];
  const suppliedEvents = new Set(pr.instrumentationEvents || []);
  const missingInstrumentation = requiredEvents.filter((eventName) => !suppliedEvents.has(eventName) && !diff.includes(eventName));

  const flag = requiredFeatureFlag || parsed.frontmatter?.featureFlag || "";
  const flagPresent = !flag || (pr.featureFlags || []).includes(flag) || diff.includes(flag);
  const inferredNits = [];
  for (const file of pr.changedFiles || []) {
    const text = file.patch
      ? String(file.patch).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n")
      : file.content || "";
    if (/\bTODO\b/.test(text)) inferredNits.push({ type: "todo", file: file.path, message: "TODO left in changed code" });
    if (/\bconsole\.log\s*\(/.test(text)) inferredNits.push({ type: "debug-log", file: file.path, message: "console.log left in changed code" });
  }
  const hardcodedStrings = pr.hardcodedStrings || [];
  const blockers = [
    ...missingAcs.map((entry) => ({ id: `VP-${entry.acId}`, type: "acceptance-criterion", message: `${entry.acId} has no passing test evidence.` })),
    ...missingInstrumentation.map((eventName) => ({ id: `VP-EVENT-${eventName}`, type: "instrumentation", message: `Required event ${eventName} is not present in the supplied evidence or diff.` })),
    ...(!flagPresent ? [{ id: "VP-FLAG", type: "feature-flag", message: `Required feature flag ${flag} is not present.` }] : []),
  ];
  const warnings = [
    ...hardcodedStrings.map((item, index) => ({ id: `VP-I18N-${index + 1}`, type: "i18n", message: item.message || `Hardcoded user-facing string in ${item.file || "changed code"}.`, ...item })),
    ...inferredNits.map((item, index) => ({ id: `VP-NIT-${index + 1}`, ...item })),
    ...(pr.qualityIssues || []),
  ];
  return {
    contract: summary,
    pr: { number: pr.number || null, url: pr.url || null, branch: pr.branch || null, merged: Boolean(pr.merged) },
    verdict: blockers.length ? "fail" : "pass",
    mergeGate: blockers.length === 0,
    acCoverage,
    requiredEvents,
    missingInstrumentation,
    featureFlag: flag ? { required: flag, present: flagPresent } : { required: null, present: null },
    blockers,
    warnings,
    frontmatterPatch: pr.merged && pr.mergedAt ? { prMergedAt: pr.mergedAt } : {},
  };
}

function reviewCounts(findings) {
  const open = (findings || []).filter((finding) => finding.status === OPEN);
  return {
    blockers: open.filter((finding) => finding.severity === "blocker").length,
    warnings: open.filter((finding) => finding.severity === "warning").length,
    info: open.filter((finding) => finding.severity === "info").length,
  };
}

export function finalizeCodeReview({ findings = [], schemaErrors = [], contractId = null, pr = {}, autoFixWarnings = false }) {
  const errors = [...schemaErrors];
  if (findings.length > 15) errors.push(`review has ${findings.length} findings; cap is 15`);
  const ids = new Set();
  for (const finding of findings) {
    if (ids.has(finding.id)) errors.push(`duplicate review finding id ${finding.id}`);
    ids.add(finding.id);
    if (["blocker", "warning"].includes(finding.severity)) {
      for (const field of ["plainTitle", "whatHappens", "whyItMatters", "theFix", "codeSnippet"]) {
        if (typeof finding[field] !== "string" || !finding[field].trim()) errors.push(`${finding.id || "finding"} missing plain-English review field ${field}`);
      }
    }
  }
  const counts = reviewCounts(findings);
  const valid = errors.length === 0;
  const gate = valid && counts.blockers === 0;
  return {
    valid,
    schemaErrors: errors,
    verdict: !valid ? "invalid" : gate ? "pass" : "fail",
    mergeGate: gate,
    counts,
    fixEligible: valid && (counts.blockers > 0 || (autoFixWarnings && counts.warnings > 0)),
    reviewJson: { contractId, pr: { number: pr.number || null, url: pr.url || null }, reviewedAt: pr.reviewedAt || null, findings },
    markdown: renderCodeReview({ findings, counts, valid, errors, pr }),
  };
}

export function renderCodeReview({ findings, counts, valid, errors, pr = {} }) {
  const lines = [
    `## Code review${pr.number ? ` - PR #${pr.number}` : ""}`,
    "",
  ];
  if (!valid) {
    lines.push("**Invalid review output. Nothing should be posted or used as a merge gate.**", "", ...errors.map((error) => `- ${error}`));
    return lines.join("\n");
  }
  lines.push(`**${counts.blockers ? "Fail" : "Pass"}: ${counts.blockers} blocker(s), ${counts.warnings} warning(s), ${counts.info} info.**`, "");
  if (!findings.length) {
    lines.push("No grounded findings.");
    return lines.join("\n");
  }
  for (const finding of findings) {
    const icon = finding.severity === "blocker" ? "🔴" : finding.severity === "warning" ? "🟡" : "🔵";
    lines.push(
      `### ${icon} ${finding.plainTitle || finding.message} (${finding.id})`,
      "",
      finding.whatHappens || finding.message,
      "",
      finding.whyItMatters ? `**Why it matters.** ${finding.whyItMatters}` : "",
      `**The fix.** ${finding.theFix || finding.suggestion}`,
      finding.codeSnippet ? `\n\`\`\`\n${finding.codeSnippet}\n\`\`\`` : "",
      `_${finding.file}${finding.line != null ? `:${finding.line}` : ""}_`,
      "",
    );
  }
  return lines.filter((line) => line !== "").join("\n\n");
}

function verifyPrTargets(result = {}) {
  return [...(result.blockers || [])].map((finding) => ({ ...finding, source: "verify-pr", severity: "blocker" }));
}

export function planFixLoop({
  kind = "pr-review",
  frontmatter = {},
  state = {},
  reviewFindings = [],
  verifyPr = {},
  conventions = {},
  advisorConsulted = false,
} = {}) {
  const rawConfig = {
    "pr-review": { counter: "fixIterations", current: frontmatter.fixIterations ?? 0, cap: frontmatter.maxFixIterations ?? conventions.maxFixIterations ?? 3 },
    "contract-verify": { counter: "verifyFixIterations", current: frontmatter.verifyFixIterations ?? 0, cap: frontmatter.maxFixIterations ?? conventions.maxFixIterations ?? 3 },
    "self-review": { counter: "selfReviewIterations", current: state.selfReviewIterations ?? 0, cap: frontmatter.selfReviewMaxIterations ?? conventions.selfReviewMaxIterations ?? 2 },
  }[kind];
  if (!rawConfig) return { status: "invalid", reason: `Unknown fix-loop kind: ${kind}` };
  const current = Number(rawConfig.current);
  const cap = Number(rawConfig.cap);
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(cap) || cap < 0) {
    return { status: "invalid_configuration", reason: "Fix-loop counters and caps must be non-negative integers." };
  }
  const config = { ...rawConfig, current, cap };
  const autoFixWarnings = Boolean(conventions.autoFixWarnings);
  const loopLabel = kind === "contract-verify" ? "contract" : kind === "self-review" ? "self-review" : "PR-review";
  const reviewTargets = (reviewFindings || [])
    .filter((finding) => finding.status === OPEN && (finding.severity === "blocker" || (kind !== "contract-verify" && autoFixWarnings && finding.severity === "warning")))
    .map((finding) => ({ ...finding, source: kind === "contract-verify" ? "contract-verify" : "code-review" }));
  const targets = kind === "contract-verify" ? reviewTargets : [...reviewTargets, ...verifyPrTargets(verifyPr)];
  if (!targets.length) {
    return { status: "green", kind, iteration: config.current, maxIterations: config.cap, targets: [], nextAction: `No open ${loopLabel} targets; stop this loop.` };
  }
  if (config.current >= config.cap) {
    return {
      status: "escalate",
      kind,
      iteration: config.current,
      maxIterations: config.cap,
      targets,
      advisorRequiredBeforeHandoff: !advisorConsulted,
      nextAction: kind === "contract-verify"
        ? "Do not edit code. Record the unresolved contract blockers and send a top-level human handoff alert to the contract owner."
        : kind === "self-review"
          ? "Do not make another automatic code pass. Send the unresolved self-review targets to a human before pushing."
          : "Do not modify code. Post the unresolved PR-review targets to the PR and send a top-level human handoff alert.",
      frontmatterPatch: {},
      statePatch: {},
    };
  }
  const nextIteration = config.current + 1;
  return {
    status: "fix",
    kind,
    iteration: nextIteration,
    maxIterations: config.cap,
    remainingAfterThisPass: config.cap - nextIteration,
    targets,
    nextAction: kind === "contract-verify"
      ? "Apply the smallest contract-only fixes, rerun manifest_contract_verify, and stop when the contract is promotable."
      : kind === "self-review"
        ? "Apply the smallest code fixes, rerun resolved local checks, then rerun the full code-review catalog before pushing."
        : "Apply the smallest in-scope code fixes, rerun resolved local checks, then rerun verify-pr and the full code-review catalog.",
    frontmatterPatch: kind === "self-review" ? {} : { [config.counter]: nextIteration },
    statePatch: kind === "self-review" ? { [config.counter]: nextIteration } : {},
  };
}
