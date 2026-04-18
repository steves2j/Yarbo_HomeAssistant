class YarboTopicsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._entries = [];
    this._busyTopics = new Set();
    this._clearingAll = false;
    this._expandedTopics = new Set();
    this._error = "";
    this._loading = true;
    this._refreshHandle = null;
    this._initialized = false;
  }

  static get POLL_INTERVAL_MS() {
    return 1000;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._startRefreshing();
    }
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    if (this._refreshHandle) {
      clearInterval(this._refreshHandle);
      this._refreshHandle = null;
    }
  }

  async _startRefreshing() {
    await this._loadTopics();
    this._refreshHandle = window.setInterval(() => {
      this._loadTopics();
    }, YarboTopicsPanel.POLL_INTERVAL_MS);
  }

  async _loadTopics() {
    if (!this._hass) {
      return;
    }

    try {
      this._entries = await this._hass.callApi("GET", "s2jyarbo/topics");
      this._error = "";
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _render() {
    this._syncExpandedTopicsFromDom();

    const content = this._entries.length
      ? this._entries.map((entry) => this._renderEntry(entry)).join("")
      : `<div class="empty">No S2JYarbo topics discovered yet.</div>`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          color: var(--primary-text-color);
          display: block;
          padding: 24px;
        }
        .page {
          margin: 0 auto;
          max-width: 1080px;
        }
        .header {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .title-wrap h1 {
          font-size: 28px;
          line-height: 1.2;
          margin: 0 0 6px;
        }
        .title-wrap p {
          color: var(--secondary-text-color);
          margin: 0;
        }
        .toolbar {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        button {
          background: var(--primary-color);
          border: 0;
          border-radius: 999px;
          color: var(--text-primary-color, #fff);
          cursor: pointer;
          font: inherit;
          padding: 10px 16px;
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .status {
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        .error {
          background: color-mix(in srgb, var(--error-color) 15%, transparent);
          border: 1px solid var(--error-color);
          border-radius: 12px;
          color: var(--error-color);
          margin-bottom: 16px;
          padding: 12px 14px;
        }
        .cards {
          display: grid;
          gap: 16px;
        }
        .card {
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 16px;
          box-shadow: var(--ha-card-box-shadow, none);
          overflow: hidden;
        }
        .card-header {
          align-items: flex-start;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px 12px;
        }
        .card-header h2 {
          font-size: 20px;
          margin: 0 0 6px;
        }
        .meta {
          color: var(--secondary-text-color);
          font-size: 14px;
        }
        .pill {
          background: color-mix(in srgb, var(--primary-color) 14%, transparent);
          border-radius: 999px;
          color: var(--primary-color);
          font-size: 13px;
          padding: 6px 10px;
          white-space: nowrap;
        }
        .stats {
          border-top: 1px solid var(--divider-color);
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          padding: 12px 20px 18px;
        }
        .stat-label {
          color: var(--secondary-text-color);
          display: block;
          font-size: 12px;
          margin-bottom: 4px;
          text-transform: uppercase;
        }
        .stat-value {
          font-size: 14px;
          overflow-wrap: anywhere;
        }
        .topics {
          border-top: 1px solid var(--divider-color);
          padding: 18px 20px 20px;
        }
        .topics h3 {
          font-size: 15px;
          margin: 0 0 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        ul {
          display: grid;
          gap: 10px;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        li {
          background: color-mix(in srgb, var(--primary-background-color) 85%, var(--card-background-color));
          border-radius: 12px;
          overflow: hidden;
        }
        details {
          width: 100%;
        }
        summary {
          align-items: center;
          cursor: pointer;
          display: flex;
          gap: 12px;
          list-style: none;
          padding: 12px 14px;
        }
        summary::-webkit-details-marker {
          display: none;
        }
        summary::before {
          color: var(--secondary-text-color);
          content: "+";
          flex: 0 0 auto;
          font-size: 22px;
          line-height: 1;
        }
        details[open] summary::before {
          content: "−";
        }
        .topic-name {
          flex: 1 1 auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 14px;
          word-break: break-all;
        }
        .topic-badge {
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
          border-radius: 999px;
          color: var(--primary-color);
          flex: 0 0 auto;
          font-size: 12px;
          padding: 4px 8px;
          text-transform: uppercase;
        }
        .topic-sample {
          border-top: 1px solid var(--divider-color);
          display: grid;
          gap: 12px;
          padding: 12px 14px 14px;
        }
        .topic-sample-meta {
          color: var(--secondary-text-color);
          display: flex;
          flex-wrap: wrap;
          font-size: 12px;
          gap: 12px;
        }
        .topic-packet-metadata {
          display: grid;
          gap: 10px;
        }
        .topic-packet-metadata h4 {
          color: var(--secondary-text-color);
          font-size: 12px;
          letter-spacing: 0.04em;
          margin: 0;
          text-transform: uppercase;
        }
        .packet-metadata-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
        .packet-metadata-item {
          background: color-mix(in srgb, var(--card-background-color) 72%, transparent);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .packet-metadata-key {
          color: var(--secondary-text-color);
          display: block;
          font-size: 11px;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .packet-metadata-value {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }
        .topic-sample-actions {
          display: flex;
          justify-content: flex-end;
        }
        .paired-response {
          border-top: 1px solid var(--divider-color);
          display: grid;
          gap: 10px;
          padding-top: 12px;
        }
        .merged-document {
          border-top: 1px solid var(--divider-color);
          display: grid;
          gap: 10px;
          padding-top: 12px;
        }
        .paired-response h4 {
          color: var(--secondary-text-color);
          font-size: 12px;
          letter-spacing: 0.04em;
          margin: 0;
          text-transform: uppercase;
        }
        .merged-document h4 {
          color: var(--secondary-text-color);
          font-size: 12px;
          letter-spacing: 0.04em;
          margin: 0;
          text-transform: uppercase;
        }
        .paired-response-topic {
          color: var(--secondary-text-color);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .merged-document-meta {
          color: var(--secondary-text-color);
          display: flex;
          flex-wrap: wrap;
          font-size: 12px;
          gap: 12px;
        }
        .clear-button {
          background: transparent;
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          padding: 8px 12px;
        }
        .topic-sample pre {
          background: color-mix(in srgb, var(--primary-background-color) 92%, var(--card-background-color));
          border-radius: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px;
          margin: 0;
          overflow-x: auto;
          padding: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .sample-empty {
          color: var(--secondary-text-color);
          font-size: 13px;
        }
        .empty {
          background: var(--card-background-color);
          border: 1px dashed var(--divider-color);
          border-radius: 16px;
          color: var(--secondary-text-color);
          padding: 28px;
          text-align: center;
        }
      </style>
      <div class="page">
        <div class="header">
          <div class="title-wrap">
            <h1>S2JYarbo MQTT Topics</h1>
            <p>Live-discovered MQTT topics for each configured S2JYarbo entry.</p>
          </div>
          <div class="toolbar">
            <div class="status">${this._loading ? "Loading..." : "Auto-refresh every 1s"}</div>
            <button id="refresh" ${this._clearingAll ? "disabled" : ""}>Refresh</button>
            <button id="clear-all" ${this._clearingAll ? "disabled" : ""}>
              ${this._clearingAll ? "Clearing..." : "Clear All"}
            </button>
          </div>
        </div>
        ${this._error ? `<div class="error">Unable to load topics: ${this._escape(this._error)}</div>` : ""}
        <div class="cards">${content}</div>
      </div>
    `;

    const button = this.shadowRoot.querySelector("#refresh");
    if (button) {
      button.addEventListener("click", () => this._loadTopics(), { once: true });
    }

    const clearAllButton = this.shadowRoot.querySelector("#clear-all");
    if (clearAllButton) {
      clearAllButton.addEventListener("click", () => this._clearAllTopics(), { once: true });
    }

    for (const details of this.shadowRoot.querySelectorAll("details[data-topic-key]")) {
      details.addEventListener("toggle", () => {
        const { topicKey } = details.dataset;
        if (!topicKey) {
          return;
        }

        if (details.open) {
          this._expandedTopics.add(topicKey);
        } else {
          this._expandedTopics.delete(topicKey);
        }
      });
    }

    for (const button of this.shadowRoot.querySelectorAll("button[data-clear-topic]")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const { clearTopic, entryId } = button.dataset;
        if (!clearTopic || !entryId) {
          return;
        }

        await this._clearTopicSample(entryId, clearTopic);
      });
    }
  }

  _syncExpandedTopicsFromDom() {
    if (!this.shadowRoot) {
      return;
    }

    for (const details of this.shadowRoot.querySelectorAll("details[data-topic-key]")) {
      const { topicKey } = details.dataset;
      if (!topicKey) {
        continue;
      }

      if (details.open) {
        this._expandedTopics.add(topicKey);
      } else {
        this._expandedTopics.delete(topicKey);
      }
    }
  }

  _renderEntry(entry) {
    const topics = entry.topics?.length
      ? `<ul>${entry.topics
          .map((topic) => this._renderTopic(entry, topic))
          .join("")}</ul>`
      : `<div class="empty">No topics discovered for this entry yet.</div>`;

    return `
      <section class="card">
        <div class="card-header">
          <div>
            <h2>${this._escape(entry.title)}</h2>
            <div class="meta">${this._escape(entry.subscribed_topic || "No active subscription")}</div>
          </div>
          <div class="pill">${this._escape(entry.connection_state || "unknown")}</div>
        </div>
        <div class="stats">
          <div>
            <span class="stat-label">Topics found</span>
            <div class="stat-value">${entry.topic_count ?? 0}</div>
          </div>
          <div>
            <span class="stat-label">Messages seen</span>
            <div class="stat-value">${entry.message_count ?? 0}</div>
          </div>
          <div>
            <span class="stat-label">Last topic</span>
            <div class="stat-value">${this._escape(entry.last_topic || "None yet")}</div>
          </div>
          <div>
            <span class="stat-label">Last received</span>
            <div class="stat-value">${this._escape(entry.last_received || "None yet")}</div>
          </div>
        </div>
        <div class="topics">
          <h3>Discovered Topics</h3>
          ${topics}
        </div>
      </section>
    `;
  }

  _renderTopic(entry, topic) {
    const topicKey = `${entry.entry_id}:${topic.name}`;
    const sample = topic.sample;
    const isCommandTopic = this._isCommandTopic(topic.name);
    const isOpen = this._expandedTopics.has(topicKey);
    const isBusy = this._busyTopics.has(topicKey);
    const isDisabled = isBusy || this._clearingAll;
    const badge = sample ? sample.format : "pending";
    const mergedDocument = this._renderMergedDocument(topic.merged_document);
    const pairedResponse = sample?.response_sample
      ? `
          <div class="paired-response">
            <h4>Paired response</h4>
            <div class="paired-response-topic">${this._escape(sample.response_topic || "device/data_feedback")}</div>
            ${this._renderSampleDetails(sample.response_sample)}
          </div>
        `
      : topic.awaiting_response && isCommandTopic
        ? `<div class="sample-empty">Waiting for the next device/data_feedback for this command.</div>`
        : "";
    const sampleContent = sample
      ? `
          ${this._renderSampleDetails(sample)}
          <div class="topic-sample-actions">
            <button
              class="clear-button"
              data-entry-id="${this._escape(entry.entry_id)}"
              data-clear-topic="${this._escape(topic.name)}"
              ${isDisabled ? "disabled" : ""}
            >
              ${isBusy ? "Clearing..." : "Clear sample"}
            </button>
          </div>
          ${mergedDocument}
          ${pairedResponse}
        `
      : `
          <div class="sample-empty">Waiting for the first payload on this topic.</div>
          ${mergedDocument}
        `;

    return `
      <li>
        <details data-topic-key="${this._escape(topicKey)}" ${isOpen ? "open" : ""}>
          <summary>
            <span class="topic-name">${this._escape(topic.name)}</span>
            <span class="topic-badge">${this._escape(badge)}</span>
          </summary>
          <div class="topic-sample">
            ${sampleContent}
          </div>
        </details>
      </li>
    `;
  }

  _renderSampleDetails(sample) {
    const packetMetadata = this._renderPacketMetadata(sample?.metadata);

    return `
      <div class="topic-sample-meta">
        <span>${this._escape(sample.format.toUpperCase())}</span>
        ${sample.compression ? `<span>${this._escape(`compressed: ${sample.compression}`)}</span>` : ""}
        <span>${this._escape(`${sample.byte_length} bytes`)}</span>
        <span>${this._escape(sample.captured_at || "Unknown time")}</span>
        ${sample.truncated ? "<span>Truncated</span>" : ""}
      </div>
      ${packetMetadata}
      <pre>${this._escape(sample.body)}</pre>
    `;
  }

  _renderMergedDocument(mergedDocument) {
    if (!mergedDocument?.body) {
      return "";
    }

    return `
      <div class="merged-document">
        <h4>Merged DeviceMSG Document</h4>
        <div class="merged-document-meta">
          <span>${this._escape(`${mergedDocument.message_count || 0} messages merged`)}</span>
          ${mergedDocument.first_received
            ? `<span>${this._escape(`First seen ${mergedDocument.first_received}`)}</span>`
            : ""}
          ${mergedDocument.last_received
            ? `<span>${this._escape(`Last merged ${mergedDocument.last_received}`)}</span>`
            : ""}
        </div>
        <pre>${this._escape(mergedDocument.body)}</pre>
      </div>
    `;
  }

  _isCommandTopic(topicName) {
    const text = String(topicName);
    const leaf = text.split("/").pop() || "";
    return text.includes("/app/") && (leaf.startsWith("get_") || leaf.startsWith("read_"));
  }

  _renderPacketMetadata(metadata) {
    if (!metadata || Object.keys(metadata).length === 0) {
      return "";
    }

    const items = Object.entries(metadata)
      .map(
        ([key, value]) => `
          <div class="packet-metadata-item">
            <span class="packet-metadata-key">${this._escape(this._labelizeKey(key))}</span>
            <div class="packet-metadata-value">${this._escape(this._formatMetadataValue(value))}</div>
          </div>
        `,
      )
      .join("");

    return `
      <div class="topic-packet-metadata">
        <h4>Packet Metadata</h4>
        <div class="packet-metadata-grid">${items}</div>
      </div>
    `;
  }

  _formatMetadataValue(value) {
    if (value === null || value === undefined) {
      return "null";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return JSON.stringify(value, null, 2);
  }

  _labelizeKey(key) {
    return String(key)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async _clearTopicSample(entryId, topic) {
    const topicKey = `${entryId}:${topic}`;
    this._busyTopics.add(topicKey);
    this._render();

    try {
      const updatedEntry = await this._hass.callApi("POST", "s2jyarbo/topics", {
        entry_id: entryId,
        topic,
      });
      this._entries = this._entries.map((entry) =>
        entry.entry_id === entryId ? updatedEntry : entry,
      );
      this._error = "";
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._busyTopics.delete(topicKey);
      this._render();
    }
  }

  async _clearAllTopics() {
    if (this._clearingAll || !this._hass) {
      return;
    }

    this._clearingAll = true;
    this._error = "";
    this._render();

    try {
      this._entries = await this._hass.callApi("POST", "s2jyarbo/topics", {
        action: "clear_all",
      });
      this._busyTopics.clear();
      this._expandedTopics.clear();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._clearingAll = false;
      this._render();
    }
  }

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

if (!customElements.get("s2jyarbo-topics-panel")) {
  customElements.define("s2jyarbo-topics-panel", YarboTopicsPanel);
}
