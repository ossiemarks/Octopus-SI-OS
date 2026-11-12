const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");

const STATUS_TIMEOUT_MS = 20_000;
const MAX_STATUS_BYTES = 64 * 1024;

function requireClaudeCliProvider(descriptor) {
  const opencodex = descriptor.interface_driver_config?.private_config?.opencodex;
  if (descriptor.interface_driver_ref !== "codex_app_server" || opencodex?.adapter !== "claude-cli"
    || descriptor.interface_driver_config?.residual_ambient?.private_auth_store != null) {
    throw new Error(`Provider '${descriptor.id}' does not use the Claude Code CLI account.`);
  }
}

function findClaudeBinary() {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, "claude");
    if (existsSync(candidate)) return candidate;
  }
  const native = path.join(homedir(), ".local", "bin", "claude");
  return existsSync(native) ? native : null;
}

function readAuthStatus() {
  const binary = findClaudeBinary();
  if (!binary) {
    return Promise.reject(new Error("Claude Code is not installed on this Mac. Install it, sign in with `claude auth login`, then try again."));
  }
  return new Promise((resolve, reject) => {
    execFile(binary, ["auth", "status"], { timeout: STATUS_TIMEOUT_MS, maxBuffer: MAX_STATUS_BYTES, encoding: "utf8" }, (error, stdout) => {
      let status;
      try {
        status = JSON.parse(stdout);
      } catch {
        reject(new Error(error
          ? `Claude Code sign-in status could not be read: ${error.message}`
          : "Claude Code returned an unreadable sign-in status."));
        return;
      }
      if (!status || typeof status !== "object" || typeof status.loggedIn !== "boolean") {
        reject(new Error("Claude Code returned an unreadable sign-in status."));
        return;
      }
      resolve(status);
    });
  });
}

function declaredModelCatalog(descriptor) {
  const config = descriptor.interface_driver_config?.private_config;
  if (!Array.isArray(config?.model_catalog)) {
    throw new Error(`Provider '${descriptor.id}' has no declared model catalogue.`);
  }
  return config.model_catalog.map((entry) => ({
    model: entry?.model,
    displayName: entry?.display_name,
    description: entry?.description ?? "",
    defaultReasoningEffort: entry?.default_reasoning_effort ?? "",
    supportedReasoningEfforts: Array.isArray(entry?.supported_reasoning_efforts)
      ? entry.supported_reasoning_efforts.map((effort) => (typeof effort === "string" ? effort : effort?.effort))
      : undefined,
    showInPicker: entry?.show_in_picker,
    isDefault: entry?.model === config.model,
    serviceTiers: entry?.service_tiers,
    defaultServiceTier: entry?.default_service_tier ?? null,
  }));
}

module.exports = {
  schemaVersion: 1,
  async modelCatalog({ descriptor }) {
    requireClaudeCliProvider(descriptor);
    return declaredModelCatalog(descriptor);
  },
  async probeAccount({ descriptor, reference }) {
    requireClaudeCliProvider(descriptor);
    const status = await readAuthStatus();
    return status.loggedIn ? [reference("provider_observation", descriptor.id, {
      source: "claude.auth/status", signed_in: true,
    })] : null;
  },
  async signIn({ descriptor }) {
    requireClaudeCliProvider(descriptor);
    if ((await readAuthStatus()).loggedIn) return;
    throw new Error("Claude Code is not signed in on this Mac. Run `claude auth login` in Terminal, then choose Sign in again.");
  },
};
