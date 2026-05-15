import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";

interface OpenCodeLinksGraphSettings {
  linkPattern: string;
  refreshDelayMs: number;
  showNotices: boolean;
  debugLogging: boolean;
}

const DEFAULT_SETTINGS: OpenCodeLinksGraphSettings = {
  linkPattern: "@.opencode/[^\\s`)]+?\\.md",
  refreshDelayMs: 400,
  showNotices: false,
  debugLogging: false,
};

type ResolvedLinks = Record<string, Record<string, number>>;

interface SyntheticLinkState {
  baselineCount: number;
  syntheticCount: number;
}

interface MetadataCacheWithLinks {
  resolvedLinks: ResolvedLinks;
  unresolvedLinks: ResolvedLinks;
  trigger?: (name: string, ...data: unknown[]) => void;
}

export default class OpenCodeLinksGraphPlugin extends Plugin {
  settings: OpenCodeLinksGraphSettings;
  private syntheticLinks = new Map<string, Map<string, SyntheticLinkState>>();
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new OpenCodeLinksGraphSettingTab(this.app, this));
    this.addCommand({
      id: "refresh-links",
      name: "Refresh OpenCode graph links",
      callback: () => this.refreshNow(true),
    });

    this.registerEvent(this.app.vault.on("modify", (file) => this.onFileChanged(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onFileChanged(file)));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));

    this.scheduleRefresh();
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.removeSyntheticLinks();
    this.triggerMetadataRefresh();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<OpenCodeLinksGraphSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.scheduleRefresh();
  }

  private onFileChanged(file: unknown): void {
    if (file instanceof TFile && file.extension === "md") {
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshNow(false);
    }, this.settings.refreshDelayMs);
  }

  async refreshNow(manual: boolean): Promise<void> {
    const started = Date.now();
    const regex = this.compilePattern();
    if (!regex) {
      if (manual || this.settings.showNotices) {
        new Notice("OpenCode Links Graph: invalid regex pattern");
      }
      return;
    }

    this.removeSyntheticLinks();
    const files = this.app.vault.getMarkdownFiles();
    let edgeCount = 0;

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const targets = this.extractTargets(content, regex);
      for (const target of targets) {
        const targetFile = this.resolveTarget(target);
        if (!targetFile || targetFile.path === file.path) {
          continue;
        }
        this.addSyntheticLink(file.path, targetFile.path);
        edgeCount += 1;
      }
    }

    this.triggerMetadataRefresh();
    this.debug(`indexed ${edgeCount} OpenCode graph edge(s) in ${Date.now() - started}ms`);
    if (manual || this.settings.showNotices) {
      new Notice(`OpenCode Links Graph: indexed ${edgeCount} edge(s)`);
    }
  }

  private compilePattern(): RegExp | null {
    try {
      return new RegExp(this.settings.linkPattern, "g");
    } catch (error) {
      this.debug("invalid regex", error);
      return null;
    }
  }

  private extractTargets(content: string, regex: RegExp): Set<string> {
    const targets = new Set<string>();
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const raw = match[0];
      const path = raw.startsWith("@") ? raw.slice(1) : raw;
      targets.add(normalizePath(path));

      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
    return targets;
  }

  private resolveTarget(path: string): TFile | null {
    const exact = this.app.vault.getAbstractFileByPath(path);
    if (exact instanceof TFile) {
      return exact;
    }

    const withoutDot = path.startsWith("./") ? path.slice(2) : path;
    const fallback = this.app.vault.getAbstractFileByPath(withoutDot);
    return fallback instanceof TFile ? fallback : null;
  }

  private addSyntheticLink(sourcePath: string, targetPath: string): void {
    const cache = this.metadataCacheWithLinks();
    cache.resolvedLinks[sourcePath] ??= {};

    let targets = this.syntheticLinks.get(sourcePath);
    if (!targets) {
      targets = new Map<string, SyntheticLinkState>();
      this.syntheticLinks.set(sourcePath, targets);
    }

    let state = targets.get(targetPath);
    if (!state) {
      state = {
        baselineCount: cache.resolvedLinks[sourcePath][targetPath] ?? 0,
        syntheticCount: 0,
      };
      targets.set(targetPath, state);
    }
    state.syntheticCount += 1;
    cache.resolvedLinks[sourcePath][targetPath] = state.baselineCount + state.syntheticCount;
  }

  private removeSyntheticLinks(): void {
    const cache = this.metadataCacheWithLinks();
    for (const [sourcePath, targets] of this.syntheticLinks) {
      const outgoing = cache.resolvedLinks[sourcePath];
      if (!outgoing) {
        continue;
      }
      for (const [targetPath, state] of targets) {
        if (state.baselineCount > 0) {
          outgoing[targetPath] = state.baselineCount;
        } else if (outgoing[targetPath] !== undefined) {
          delete outgoing[targetPath];
        }
      }
      if (Object.keys(outgoing).length === 0) {
        delete cache.resolvedLinks[sourcePath];
      }
    }
    this.syntheticLinks.clear();
  }

  private metadataCacheWithLinks(): MetadataCacheWithLinks {
    return this.app.metadataCache as unknown as MetadataCacheWithLinks;
  }

  private triggerMetadataRefresh(): void {
    const cache = this.metadataCacheWithLinks();
    cache.trigger?.("resolved");
  }

  private debug(message: string, data?: unknown): void {
    if (!this.settings.debugLogging) {
      return;
    }
    if (data === undefined) {
      console.log(`[OpenCode Links Graph] ${message}`);
    } else {
      console.log(`[OpenCode Links Graph] ${message}`, data);
    }
  }
}

class OpenCodeLinksGraphSettingTab extends PluginSettingTab {
  plugin: OpenCodeLinksGraphPlugin;

  constructor(app: App, plugin: OpenCodeLinksGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("OpenCode link regex")
      .setDesc("Regex used to find OpenCode links. The default matches @.opencode/...md.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.linkPattern)
          .setValue(this.plugin.settings.linkPattern)
          .onChange(async (value) => {
            this.plugin.settings.linkPattern = value.trim() || DEFAULT_SETTINGS.linkPattern;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Refresh delay")
      .setDesc("Debounce delay in milliseconds after vault or metadata changes.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.refreshDelayMs))
          .setValue(String(this.plugin.settings.refreshDelayMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.refreshDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SETTINGS.refreshDelayMs;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show notices")
      .setDesc("Show a notice after automatic refreshes.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showNotices).onChange(async (value) => {
          this.plugin.settings.showNotices = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Write refresh details to the developer console.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
          this.plugin.settings.debugLogging = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Refresh now")
      .setDesc("Rebuild synthetic graph edges immediately.")
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(() => {
          void this.plugin.refreshNow(true);
        }),
      );
  }
}
