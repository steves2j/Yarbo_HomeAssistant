class YarboOverviewCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._entries = [];
    this._error = "";
    this._loading = true;
    this._initialized = false;
    this._refreshHandle = null;
    this._reloadHandle = null;
    this._mapCards = new Map();
    this._mapCardConfigs = new Map();
    this._mapTrackerIds = new Map();
    this._siteMapLayers = new Map();
    this._directionalMarkers = new Map();
    this._nativeMarkerSuppressors = new Map();
    this._siteLeafletMaps = new Map();
    this._helpersPromise = null;
    this._entryElements = new Map();
    this._sitePlanViews = new Map();
    this._activeSitePlanDrag = null;
    this._structureReady = false;
    this._loadingDashboard = false;
    this._reloadAfterLoad = false;
    this._lastEntitySignature = "";
    this._rechargingEntries = new Set();
    this._startingEntries = new Set();
    this._pausingEntries = new Set();
    this._resumingEntries = new Set();
    this._stoppingEntries = new Set();
    this._shuttingDownEntries = new Set();
    this._restartingEntries = new Set();
    this._updatingVolumeEntries = new Set();
    this._refreshingEntries = new Set();
    this._enabledPowerEntries = new Set();
    this._powerEnableTimers = new Map();
    this._pendingMapRequests = new Set();
    this._mapRequestTimestamps = new Map();
    this._refreshRequestTimestamps = new Map();
    this._actionStatus = new Map();
    this._actionStatusTimers = new Map();
    this._selectedPlans = new Map();
    this._planStartPercents = new Map();
    this._lastPlanActionStates = new Map();
    this._volumeDrafts = new Map();
    this._hiddenBreadcrumbEntries = new Set();
    this._trailPreferenceInitialized = new Set();
    this._notificationToastKeys = new Map();
    this._notificationToastTimers = new Map();
    this._handleSitePlanPointerMove = this._handleSitePlanPointerMove.bind(this);
    this._handleSitePlanPointerUp = this._handleSitePlanPointerUp.bind(this);
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;

    for (const mapCard of this._mapCards.values()) {
      mapCard.hass = hass;
    }
    this._refreshDirectionalMarkers();

    if (!this._initialized) {
      this._initialized = true;
      this._startRefreshing();
      return;
    }

    this._refreshLiveSitePlans();
    this._handleHassUpdate();
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    if (this._refreshHandle) {
      clearInterval(this._refreshHandle);
      this._refreshHandle = null;
    }
    if (this._reloadHandle) {
      clearTimeout(this._reloadHandle);
      this._reloadHandle = null;
    }
    for (const timer of this._actionStatusTimers.values()) {
      clearTimeout(timer);
    }
    this._actionStatusTimers.clear();
    for (const timer of this._powerEnableTimers.values()) {
      clearTimeout(timer);
    }
    this._powerEnableTimers.clear();
    for (const timer of this._notificationToastTimers.values()) {
      clearTimeout(timer);
    }
    this._notificationToastTimers.clear();
    this._clearActiveSitePlanDrag();
    for (const state of this._siteLeafletMaps.values()) {
      state.map.remove();
    }
    this._siteLeafletMaps.clear();
    this._siteMapLayers.clear();
    for (const state of this._directionalMarkers.values()) {
      state.marker.remove();
    }
    this._directionalMarkers.clear();
    for (const state of this._nativeMarkerSuppressors.values()) {
      for (const observer of state.observers) {
        observer.disconnect();
      }
    }
    this._nativeMarkerSuppressors.clear();
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return {
      columns: "full",
      min_columns: 12,
      max_columns: 12,
      min_rows: 6,
    };
  }

  static getStubConfig(...args) {
    for (const arg of args) {
      const selector = YarboOverviewCard._extractStubConfigFromArg(arg);
      if (selector) {
        return {
          ...selector,
          layout_options: {
            grid_columns: "full",
          },
        };
      }
    }

    return {
      layout_options: {
        grid_columns: "full",
      },
    };
  }

  async _startRefreshing() {
    await this._loadDashboard();
    this._refreshHandle = window.setInterval(() => {
      this._loadDashboard();
    }, 60000);
  }

  async _loadDashboard() {
    if (!this._hass) {
      return;
    }

    if (this._loadingDashboard) {
      this._reloadAfterLoad = true;
      return;
    }

    this._loadingDashboard = true;

    try {
      const entries = await this._hass.callApi("GET", this._dashboardApiPath());
      const hasSelector =
        Boolean(this._config?.entry_id) ||
        Boolean(this._config?.entity_id) ||
        Boolean(this._config?.device_id);
      if (!hasSelector && entries.length > 1) {
        this._entries = [];
        this._error =
          "This card now shows one device per card. Add it from the device page or configure entry_id, entity_id, or device_id.";
        return;
      }

      if (hasSelector && entries.length === 0) {
        this._entries = [];
        this._error =
          "No S2JYarbo device matched this card configuration. Re-add the card from the device page or update its selector.";
        return;
      }

      this._entries = entries;
      for (const entry of this._entries) {
        if (!this._trailPreferenceInitialized.has(entry.entry_id)) {
          this._hiddenBreadcrumbEntries.add(entry.entry_id);
          this._trailPreferenceInitialized.add(entry.entry_id);
        }
        if (entry.site_map) {
          this._pendingMapRequests?.delete(entry.entry_id);
        }
      }
      this._error = "";
      this._lastEntitySignature = this._buildEntitySignature();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loadingDashboard = false;
      this._loading = false;
      this._render();
      this._attachMaps();
      if (this._reloadAfterLoad) {
        this._reloadAfterLoad = false;
        this._scheduleDashboardReload(250);
      }
    }
  }

  _dashboardApiPath() {
    const params = new URLSearchParams();

    if (this._config?.entry_id) {
      params.set("entry_id", this._config.entry_id);
    } else if (this._config?.entity_id) {
      params.set("entity_id", this._config.entity_id);
    } else if (this._config?.device_id) {
      params.set("device_id", this._config.device_id);
    }

    const query = params.toString();
    return query ? `s2jyarbo/dashboard?${query}` : "s2jyarbo/dashboard";
  }

  static _extractStubConfigFromArg(arg) {
    if (!arg) {
      return null;
    }

    if (Array.isArray(arg)) {
      for (const item of arg) {
        const config = YarboOverviewCard._extractStubConfigFromArg(item);
        if (config) {
          return config;
        }
      }
      return null;
    }

    if (typeof arg === "string") {
      if (arg.includes(".")) {
        return { entity_id: arg };
      }
      return { device_id: arg };
    }

    if (typeof arg !== "object") {
      return null;
    }

    if (typeof arg.entity_id === "string" && arg.entity_id) {
      return { entity_id: arg.entity_id };
    }

    if (typeof arg.device_id === "string" && arg.device_id) {
      return { device_id: arg.device_id };
    }

    if (typeof arg.entry_id === "string" && arg.entry_id) {
      return { entry_id: arg.entry_id };
    }

    return null;
  }

  _handleHassUpdate() {
    if (!this._entries.length || !this._hass) {
      return;
    }

    const entitySignature = this._buildEntitySignature();
    if (!entitySignature || entitySignature === this._lastEntitySignature) {
      return;
    }

    this._lastEntitySignature = entitySignature;
    this._refreshLiveSitePlans();
    this._scheduleDashboardReload();
  }

  _scheduleDashboardReload(delay = 400) {
    if (this._reloadHandle) {
      return;
    }

    this._reloadHandle = window.setTimeout(() => {
      this._reloadHandle = null;
      this._loadDashboard();
    }, delay);
  }

  _maybeRequestMapData(entry) {
    if (
      !this._hass ||
      entry.site_map ||
      entry.connection_state !== "connected" ||
      this._pendingMapRequests.has(entry.entry_id) ||
      this._refreshingEntries.has(entry.entry_id) ||
      this._isLastUpdatedStale(entry.summary)
    ) {
      return;
    }

    const lastAttempt = this._mapRequestTimestamps.get(entry.entry_id) || 0;
    if (Date.now() - lastAttempt < 30000) {
      return;
    }

    this._pendingMapRequests.add(entry.entry_id);
    this._mapRequestTimestamps.set(entry.entry_id, Date.now());
    void this._requestMapData(entry.entry_id);
  }

  _maybeRefreshStaleData(entry) {
    if (
      !this._hass ||
      entry.connection_state !== "connected" ||
      this._refreshingEntries.has(entry.entry_id) ||
      !this._isLastUpdatedStale(entry.summary)
    ) {
      return;
    }

    const lastAttempt = this._refreshRequestTimestamps.get(entry.entry_id) || 0;
    if (Date.now() - lastAttempt < 300000) {
      return;
    }

    void this._refreshDeviceData(entry.entry_id, { automatic: true });
  }

  async _requestMapData(entryId) {
    if (!this._hass) {
      return;
    }

    try {
      await this._hass.callApi("POST", "s2jyarbo/request_map", {
        entry_id: entryId,
      });
    } catch (_err) {
      this._pendingMapRequests.delete(entryId);
      return;
    }

    window.setTimeout(() => {
      this._pendingMapRequests.delete(entryId);
      this._scheduleDashboardReload(200);
    }, 2500);
  }

  _isLastUpdatedStale(summary) {
    const updatedAt = summary?.updated_at;
    if (!updatedAt || typeof updatedAt !== "string") {
      return true;
    }

    const updatedMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedMs)) {
      return true;
    }

    return Date.now() - updatedMs > 3600000;
  }

  async _refreshDeviceData(entryId, options = {}) {
    if (!this._hass || this._refreshingEntries.has(entryId)) {
      return;
    }

    const { automatic = false } = options;
    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      if (!automatic) {
        this._setActionStatus(entryId, "Device is not connected.", "error");
        this._render();
      }
      return;
    }

    this._refreshingEntries.add(entryId);
    this._refreshRequestTimestamps.set(entryId, Date.now());
    if (!automatic) {
      this._actionStatus.delete(entryId);
    }
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/refresh_device_data", {
        entry_id: entryId,
      });
      const topicCount = Array.isArray(response?.topics) ? response.topics.length : 0;
      if (!automatic) {
        this._setActionStatus(entryId, `Refresh sent ${topicCount || 0} commands.`, "info");
      }
    } catch (err) {
      if (!automatic) {
        this._setActionStatus(
          entryId,
          `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    } finally {
      window.setTimeout(() => {
        this._refreshingEntries.delete(entryId);
        this._render();
        this._scheduleDashboardReload(250);
      }, 3000);
    }
  }

  _buildEntitySignature() {
    return this._entries
      .map((entry) => this._entrySignature(entry))
      .filter((signature) => signature)
      .join("|");
  }

  _entrySignature(entry) {
    if (!this._hass) {
      return "";
    }

    const parts = [entry.entry_id];
    const statusState = entry.status_entity_id
      ? this._hass.states[entry.status_entity_id]
      : null;
    if (statusState) {
      parts.push(
        statusState.state,
        statusState.attributes.updated_at || "",
        statusState.attributes.last_received || "",
        statusState.attributes.latitude ?? "",
        statusState.attributes.longitude ?? "",
        statusState.attributes.heading ?? "",
        statusState.attributes.battery_level ?? "",
        statusState.attributes.error_code ?? "",
        statusState.attributes.notification_count ?? "",
        statusState.attributes.last_notification_at ?? "",
        statusState.attributes.last_notification_title ?? "",
        statusState.attributes.last_notification_message ?? "",
      );
    }

    const trackerState = entry.tracker_entity_id
      ? this._hass.states[entry.tracker_entity_id]
      : null;
    if (trackerState) {
      parts.push(
        trackerState.state,
        trackerState.attributes.updated_at || "",
        trackerState.attributes.latitude ?? "",
        trackerState.attributes.longitude ?? "",
        trackerState.attributes.fix_quality ?? "",
        trackerState.attributes.satellites ?? "",
      );
    }

    return parts.join("~");
  }

  async _ensureHelpers() {
    if (!this._helpersPromise) {
      if (typeof window.loadCardHelpers !== "function") {
        throw new Error("Home Assistant card helpers are not available yet.");
      }

      this._helpersPromise = window.loadCardHelpers();
    }

    return this._helpersPromise;
  }

  async _attachMaps() {
    return;
  }

  _render() {
    this._ensureStructure();

    if (!this._structureReady) {
      return;
    }

    const status = this.shadowRoot.querySelector(".status");
    if (status) {
      status.textContent = this._loading ? "Loading..." : "Live updates with 60s safety refresh";
    }

    const error = this.shadowRoot.querySelector(".error");
    if (error) {
      error.hidden = !this._error;
      error.textContent = this._error || "";
    }

    const stack = this.shadowRoot.querySelector(".stack");
    if (!stack) {
      return;
    }
    stack.classList.toggle("single-device", this._entries.length === 1);

    const seenEntries = new Set();

    if (!this._entries.length) {
      for (const [entryId, section] of this._entryElements.entries()) {
        const mapCard = this._mapCards.get(entryId);
        if (mapCard?.parentElement) {
          mapCard.parentElement.removeChild(mapCard);
        }
        const siteLeaflet = this._siteLeafletMaps.get(entryId);
        if (siteLeaflet) {
          siteLeaflet.map.remove();
          this._siteLeafletMaps.delete(entryId);
        }
        this._clearSiteMapOverlay(entryId);
        this._clearDirectionalMarker(entryId);
        this._clearNativeMarkerSuppression(entryId);
        section.remove();
      }
      this._entryElements.clear();
      this._mapCards.clear();
      this._mapCardConfigs.clear();
      this._mapTrackerIds.clear();
      this._siteMapLayers.clear();
      this._hiddenBreadcrumbEntries.clear();
      this._trailPreferenceInitialized.clear();
      this._notificationToastKeys.clear();
      for (const timer of this._notificationToastTimers.values()) {
        clearTimeout(timer);
      }
      this._notificationToastTimers.clear();
      stack.innerHTML =
        '<div class="empty">No S2JYarbo devices have published a usable DeviceMSG yet.</div>';
      return;
    }

    const emptyState = stack.querySelector(".empty");
    if (emptyState) {
      emptyState.remove();
    }

    for (const entry of this._entries) {
      seenEntries.add(entry.entry_id);

      let section = this._entryElements.get(entry.entry_id);
      if (!section) {
        section = this._createEntryElement(entry.entry_id);
        this._entryElements.set(entry.entry_id, section);
        stack.appendChild(section);
      }

      this._updateEntryElement(section, entry);
    }

    for (const [entryId, section] of Array.from(this._entryElements.entries())) {
      if (seenEntries.has(entryId)) {
        continue;
      }

      const mapCard = this._mapCards.get(entryId);
      if (mapCard?.parentElement) {
        mapCard.parentElement.removeChild(mapCard);
      }
      this._mapCards.delete(entryId);
      this._mapCardConfigs.delete(entryId);
      this._mapTrackerIds.delete(entryId);
      this._clearSiteMapOverlay(entryId);
      const siteLeaflet = this._siteLeafletMaps.get(entryId);
      if (siteLeaflet) {
        siteLeaflet.map.remove();
        this._siteLeafletMaps.delete(entryId);
      }
      this._clearDirectionalMarker(entryId);
      this._clearNativeMarkerSuppression(entryId);
      section.remove();
      this._entryElements.delete(entryId);
      this._sitePlanViews.delete(entryId);
      this._hiddenBreadcrumbEntries.delete(entryId);
      this._trailPreferenceInitialized.delete(entryId);
      this._notificationToastKeys.delete(entryId);
      const notificationTimer = this._notificationToastTimers.get(entryId);
      if (notificationTimer) {
        clearTimeout(notificationTimer);
        this._notificationToastTimers.delete(entryId);
      }
    }
  }

  _ensureStructure() {
    if (this._structureReady) {
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--primary-color) 16%, transparent), transparent 42%),
            linear-gradient(180deg, color-mix(in srgb, var(--card-background-color) 94%, var(--primary-background-color)), var(--card-background-color));
          border-radius: 22px;
          overflow: hidden;
        }
        .shell {
          padding: 22px;
        }
        .header {
          align-items: end;
          display: flex;
          gap: 16px;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .title {
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.05;
          margin: 0 0 6px;
        }
        .subtitle {
          color: var(--secondary-text-color);
          margin: 0;
        }
        .status {
          color: var(--secondary-text-color);
          font-size: 13px;
          white-space: nowrap;
        }
        .error {
          background: color-mix(in srgb, var(--error-color) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color) 35%, transparent);
          border-radius: 14px;
          color: var(--error-color);
          margin-bottom: 16px;
          padding: 12px 14px;
        }
        .error[hidden] {
          display: none;
        }
        .stack {
          display: grid;
          gap: 18px;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .stack.single-device > .device {
          grid-column: 1 / -1;
        }
        .device {
          background: color-mix(in srgb, var(--primary-background-color) 88%, var(--card-background-color));
          border: 1px solid color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 20px;
          display: grid;
          gap: 16px;
          padding: 18px;
          position: relative;
        }
        .device-header {
          align-items: start;
          display: flex;
          gap: 14px;
          justify-content: space-between;
        }
        .device-header-main {
          min-width: 0;
        }
        .device-header-indicators {
          align-items: center;
          display: flex;
          flex: 0 0 auto;
          gap: 12px;
          justify-self: end;
        }
        .device-title {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.03em;
          margin: 0 0 6px;
        }
        .device-meta {
          color: var(--secondary-text-color);
          display: flex;
          flex-wrap: wrap;
          font-size: 13px;
          gap: 10px 14px;
        }
        .device-satellites {
          align-items: center;
          background: color-mix(in srgb, var(--card-background-color) 74%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 999px;
          color: var(--secondary-text-color);
          display: inline-flex;
          gap: 6px;
          padding: 5px 8px;
        }
        .device-satellites.has-fix {
          color: #2f9e44;
        }
        .device-satellites.no-fix {
          color: #f08c00;
        }
        .device-satellites.unknown {
          color: var(--secondary-text-color);
        }
        .device-refresh {
          align-items: center;
          appearance: none;
          background: none;
          border: none;
          color: var(--secondary-text-color);
          cursor: pointer;
          display: inline-flex;
          height: 24px;
          justify-content: center;
          padding: 0;
          transition:
            color 120ms ease,
            opacity 120ms ease,
            transform 120ms ease;
          width: 24px;
        }
        .device-refresh .button-icon {
          --mdc-icon-size: 20px;
        }
        .device-refresh:hover:not(:disabled) {
          color: var(--primary-color);
          transform: rotate(-12deg);
        }
        .device-refresh:disabled {
          cursor: default;
          opacity: 0.52;
          transform: none;
        }
        .device-refresh.is-refreshing .button-icon {
          animation: yarbo-refresh-spin 900ms linear infinite;
        }
        .device-satellite-icon {
          display: block;
          height: 15px;
          width: 15px;
        }
        .device-satellite-count {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1;
          min-width: 2ch;
          text-align: right;
        }
        .device-battery {
          appearance: none;
          background: none;
          border: none;
          cursor: pointer;
          display: block;
          flex: 0 0 auto;
          padding: 0;
          transition:
            opacity 120ms ease,
            transform 120ms ease;
        }
        .device-battery:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .device-battery:disabled {
          cursor: default;
          transform: none;
        }
        .battery-icon {
          flex: 0 0 auto;
          height: 20px;
          position: relative;
          width: 50px;
        }
        .battery-shell {
          align-items: stretch;
          background: color-mix(in srgb, var(--card-background-color) 75%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 3px;
          display: grid;
          grid-template-columns: repeat(10, minmax(0, 1fr));
          inset: 0 8px 0 0;
          padding: 3px;
          position: absolute;
        }
        .battery-tip {
          background: color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 0 3px 3px 0;
          height: 7px;
          position: absolute;
          right: 3;
          top: 6px;
          width: 5px;
        }
        .battery-cell {
          background: color-mix(in srgb, var(--divider-color) 85%, transparent);
          border-radius: 1px;
          opacity: 0.24;
          transition:
            background 140ms ease,
            opacity 140ms ease;
        }
        .battery-cell.is-active {
          opacity: 1;
        }
        .battery-bolt {
          align-items: center;
          color: rgba(255, 255, 255, 0.94);
          display: flex;
          font-size: 11px;
          inset: 0 0px 0 0;
          justify-content: center;
          pointer-events: none;
          position: absolute;
          text-shadow: 0 1px 1px rgba(0, 0, 0, 0.32);
        }
        .battery-bolt[hidden] {
          display: none;
        }
        .notification-toast {
          align-items: start;
          background: color-mix(in srgb, var(--card-background-color) 96%, var(--primary-background-color));
          border: 1px solid color-mix(in srgb, var(--divider-color) 76%, transparent);
          border-left: 4px solid var(--primary-color);
          border-radius: 14px;
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.24);
          display: grid;
          gap: 10px;
          grid-template-columns: auto minmax(0, 1fr) auto;
          max-width: min(420px, calc(100% - 32px));
          padding: 12px 12px 12px 14px;
          position: absolute;
          right: 16px;
          top: 16px;
          z-index: 4;
        }
        .notification-toast[hidden] {
          display: none;
        }
        .notification-toast.warning {
          border-left-color: var(--warning-color, #f59e0b);
        }
        .notification-toast.error {
          border-left-color: var(--error-color);
        }
        .notification-toast.info,
        .notification-toast.success {
          border-left-color: var(--primary-color);
        }
        .notification-toast-icon {
          --mdc-icon-size: 20px;
          color: var(--secondary-text-color);
          margin-top: 1px;
        }
        .notification-toast.warning .notification-toast-icon {
          color: var(--warning-color, #f59e0b);
        }
        .notification-toast.error .notification-toast-icon {
          color: var(--error-color);
        }
        .notification-toast-title {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          margin-bottom: 3px;
        }
        .notification-toast-message {
          color: var(--secondary-text-color);
          font-size: 12px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .notification-toast-close {
          align-items: center;
          appearance: none;
          background: none;
          border: none;
          border-radius: 999px;
          color: var(--secondary-text-color);
          cursor: pointer;
          display: inline-flex;
          height: 24px;
          justify-content: center;
          padding: 0;
          width: 24px;
        }
        .notification-toast-close:hover {
          background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
          color: var(--primary-text-color);
        }
        .device-battery.battery-green .battery-shell {
          border-color: color-mix(in srgb, #2f9e44 42%, var(--divider-color));
        }
        .device-battery.battery-green .battery-cell.is-active {
          background: #2f9e44;
        }
        .device-battery.battery-yellow .battery-shell {
          border-color: color-mix(in srgb, #f0b429 46%, var(--divider-color));
        }
        .device-battery.battery-yellow .battery-cell.is-active {
          background: #f0b429;
        }
        .device-battery.battery-orange .battery-shell {
          border-color: color-mix(in srgb, #f76707 46%, var(--divider-color));
        }
        .device-battery.battery-orange .battery-cell.is-active {
          background: #f76707;
        }
        .device-battery.battery-red .battery-shell {
          border-color: color-mix(in srgb, #e03131 46%, var(--divider-color));
        }
        .device-battery.battery-red .battery-cell.is-active {
          background: #e03131;
        }
        .device-battery.battery-unknown .battery-shell {
          border-color: color-mix(in srgb, var(--divider-color) 80%, transparent);
        }
        .device-battery.battery-unknown .battery-cell.is-active {
          background: color-mix(in srgb, var(--secondary-text-color) 60%, transparent);
        }
        .advanced-panel {
          background: color-mix(in srgb, var(--card-background-color) 62%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 18px;
          overflow: hidden;
        }
        .advanced-summary {
          align-items: center;
          cursor: pointer;
          display: flex;
          gap: 14px;
          justify-content: space-between;
          list-style: none;
          padding: 14px 16px;
        }
        .advanced-summary::-webkit-details-marker {
          display: none;
        }
        .advanced-summary-label {
          display: grid;
          gap: 4px;
        }
        .advanced-summary-title {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .advanced-summary-copy {
          color: var(--secondary-text-color);
          font-size: 12px;
        }
        .advanced-summary-toggle {
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .advanced-panel[open] .advanced-summary-toggle::after {
          content: "Hide";
        }
        .advanced-panel:not([open]) .advanced-summary-toggle::after {
          content: "Show";
        }
        .advanced-card {
          border-top: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
          display: grid;
          gap: 14px;
          padding: 0 16px 16px;
        }
        .chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-start;
        }
        .chip {
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 7px 10px;
          text-transform: uppercase;
        }
        .chip.connection.connected {
          background: color-mix(in srgb, #2f9e44 18%, transparent);
          color: #2f9e44;
        }
        .chip.connection.connecting {
          background: color-mix(in srgb, #f08c00 18%, transparent);
          color: #f08c00;
        }
        .chip.connection.disconnected,
        .chip.connection.connection_failed,
        .chip.connection.not_loaded {
          background: color-mix(in srgb, var(--error-color) 14%, transparent);
          color: var(--error-color);
        }
        .chip.fix {
          background: color-mix(in srgb, var(--primary-color) 14%, transparent);
          color: var(--primary-color);
        }
        .chip.error {
          background: color-mix(in srgb, var(--error-color) 12%, transparent);
          color: var(--error-color);
        }
        .metrics {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
        .metric {
          background: color-mix(in srgb, var(--card-background-color) 70%, transparent);
          border-radius: 16px;
          padding: 12px 14px;
        }
        .metric-label {
          color: var(--secondary-text-color);
          display: block;
          font-size: 11px;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .metric-value {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.02em;
          overflow-wrap: anywhere;
        }
        .advanced-controls {
          display: grid;
          gap: 14px;
        }
        .advanced-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .advanced-command-button {
          appearance: none;
          align-items: center;
          border-radius: 999px;
          color: var(--primary-text-color);
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          gap: 8px;
          justify-content: center;
          letter-spacing: 0.01em;
          padding: 10px 14px;
          transition:
            background 120ms ease,
            border-color 120ms ease,
            opacity 120ms ease,
            transform 120ms ease;
        }
        .advanced-command-button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .advanced-command-button:disabled {
          cursor: default;
          opacity: 0.55;
          transform: none;
        }
        .button-icon {
          --mdc-icon-size: 18px;
          color: currentColor;
          display: inline-flex;
          flex: 0 0 auto;
        }
        .button-label {
          min-width: 0;
        }
        .icon-only .button-icon {
          --mdc-icon-size: 24px;
        }
        .icon-only .button-label {
          display: none;
        }
        .enable-button {
          background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        }
        .enable-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary-text-color) 16%, transparent);
          border-color: color-mix(in srgb, var(--primary-text-color) 24%, transparent);
        }
        .enable-button.is-armed {
          background: color-mix(in srgb, var(--warning-color, #f59e0b) 18%, transparent);
          border-color: color-mix(in srgb, var(--warning-color, #f59e0b) 30%, transparent);
        }
        .shutdown-button {
          background: color-mix(in srgb, var(--error-color) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color) 28%, transparent);
        }
        .shutdown-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--error-color) 18%, transparent);
          border-color: color-mix(in srgb, var(--error-color) 34%, transparent);
        }
        .restart-button {
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary-color) 28%, transparent);
        }
        .restart-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary-color) 18%, transparent);
          border-color: color-mix(in srgb, var(--primary-color) 34%, transparent);
        }
        .volume-control {
          display: grid;
          gap: 8px;
        }
        .volume-header {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }
        .volume-label {
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .volume-value {
          font-size: 13px;
          font-weight: 600;
        }
        .volume-slider {
          accent-color: var(--primary-color);
          width: 100%;
        }
        .volume-slider:disabled {
          opacity: 0.55;
        }
        .wifi-details {
          background: color-mix(in srgb, var(--card-background-color) 70%, transparent);
          border-radius: 16px;
          display: grid;
          gap: 10px;
          padding: 12px 14px;
        }
        .wifi-title {
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .wifi-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        }
        .wifi-item {
          display: grid;
          gap: 4px;
        }
        .wifi-key {
          color: var(--secondary-text-color);
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .wifi-value {
          font-size: 13px;
          font-weight: 600;
          overflow-wrap: anywhere;
        }
        .device-actions {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 10px 12px;
        }
        .plan-picker {
          display: grid;
          flex: 1 1 240px;
          gap: 8px;
          min-width: 220px;
        }
        .plan-picker-row {
          align-items: center;
          display: flex;
          gap: 10px;
        }
        .plan-picker-label {
          color: var(--secondary-text-color);
          flex: 0 0 auto;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .plan-picker select {
          appearance: none;
          background:
            linear-gradient(45deg, transparent 50%, var(--secondary-text-color) 50%),
            linear-gradient(135deg, var(--secondary-text-color) 50%, transparent 50%),
            color-mix(in srgb, var(--card-background-color) 78%, transparent);
          background-position:
            calc(100% - 18px) calc(50% - 3px),
            calc(100% - 12px) calc(50% - 3px),
            0 0;
          background-repeat: no-repeat;
          background-size:
            6px 6px,
            6px 6px,
            100% 100%;
          border: 1px solid color-mix(in srgb, var(--divider-color) 78%, transparent);
          border-radius: 12px;
          color: var(--primary-text-color);
          flex: 1 1 auto;
          font: inherit;
          min-width: 0;
          padding: 10px 38px 10px 12px;
        }
        .plan-picker select:disabled {
          cursor: default;
          opacity: 0.68;
        }
        .plan-start-control {
          display: grid;
          gap: 6px;
          padding-left: 56px;
        }
        .plan-start-header {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }
        .plan-start-label {
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .plan-start-value {
          font-size: 12px;
          font-weight: 700;
        }
        .plan-start-slider {
          accent-color: var(--primary-color);
          width: 100%;
        }
        .plan-start-slider:disabled {
          cursor: default;
          opacity: 0.55;
        }
        .action-button,
        .stop-button {
          appearance: none;
          align-items: center;
          border-radius: 999px;
          color: var(--primary-text-color);
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          gap: 8px;
          justify-content: center;
          letter-spacing: 0.01em;
          padding: 10px 14px;
          transition:
            background 120ms ease,
            border-color 120ms ease,
            opacity 120ms ease,
            transform 120ms ease;
        }
        .icon-only {
          gap: 0;
          height: 32px;
          min-width: 32px;
          padding: 2px;
          width: 32px;
        }
        .action-button {
          background: color-mix(in srgb, var(--primary-color) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--primary-color) 28%, transparent);
        }
        .stop-button {
          background: color-mix(in srgb, var(--error-color) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color) 28%, transparent);
        }
        .action-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary-color) 22%, transparent);
          border-color: color-mix(in srgb, var(--primary-color) 38%, transparent);
          transform: translateY(-1px);
        }
        .stop-button:hover:not(:disabled) {
          background: color-mix(in srgb, var(--error-color) 18%, transparent);
          border-color: color-mix(in srgb, var(--error-color) 34%, transparent);
          transform: translateY(-1px);
        }
        .action-button:disabled,
        .stop-button:disabled {
          cursor: default;
          opacity: 0.55;
          transform: none;
        }
        .action-status {
          color: var(--secondary-text-color);
          font-size: 12px;
        }
        .action-status.error {
          color: var(--error-color);
        }
        .map-section {
          display: grid;
          gap: 10px;
        }
        .map-header {
          align-items: center;
          display: flex;
          gap: 10px;
          justify-content: space-between;
        }
        .map-label {
          color: var(--secondary-text-color);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .map-trail-toggle {
          appearance: none;
          background: color-mix(in srgb, var(--card-background-color) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 78%, transparent);
          border-radius: 999px;
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 6px 10px;
          transition:
            background 120ms ease,
            border-color 120ms ease,
            color 120ms ease,
            transform 120ms ease;
        }
        .map-trail-toggle:hover {
          background: color-mix(in srgb, var(--primary-color) 16%, var(--card-background-color));
          border-color: color-mix(in srgb, var(--primary-color) 28%, transparent);
          transform: translateY(-1px);
        }
        .map-trail-toggle.is-hidden {
          background: color-mix(in srgb, var(--primary-color) 13%, transparent);
          border-color: color-mix(in srgb, var(--primary-color) 30%, transparent);
          color: var(--primary-color);
        }
        .site-plan {
          background:
            radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--primary-color) 10%, transparent), transparent 45%),
            color-mix(in srgb, var(--card-background-color) 72%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 18px;
          display: grid;
          gap: 10px;
          min-height: 240px;
          overflow: hidden;
          padding: 12px;
        }
        .site-plan-surface {
          border-radius: 14px;
          overflow: hidden;
          position: relative;
        }
        .site-plan-canvas {
          cursor: grab;
          min-height: 200px;
          touch-action: none;
          user-select: none;
        }
        .site-plan-canvas.is-dragging {
          cursor: grabbing;
        }
        .site-plan-controls {
          display: flex;
          gap: 8px;
          pointer-events: none;
          position: absolute;
          right: 10px;
          top: 10px;
          z-index: 1;
        }
        .site-plan-button {
          align-items: center;
          appearance: none;
          background: color-mix(in srgb, var(--card-background-color) 86%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 80%, transparent);
          border-radius: 999px;
          color: var(--primary-text-color);
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          height: 32px;
          justify-content: center;
          min-width: 32px;
          padding: 0 10px;
          pointer-events: auto;
          transition:
            background 120ms ease,
            border-color 120ms ease,
            transform 120ms ease;
        }
        .site-plan-button:hover {
          background: color-mix(in srgb, var(--primary-color) 16%, var(--card-background-color));
          border-color: color-mix(in srgb, var(--primary-color) 28%, transparent);
          transform: translateY(-1px);
        }
        .site-plan-empty {
          align-items: center;
          color: var(--secondary-text-color);
          display: flex;
          justify-content: center;
          min-height: 160px;
          text-align: center;
        }
        .site-plan-svg {
          display: block;
          height: 100%;
          min-height: 200px;
          width: 100%;
        }
        .site-plan-legend {
          color: var(--secondary-text-color);
          display: flex;
          flex-wrap: wrap;
          font-size: 12px;
          gap: 8px 12px;
          justify-content: space-between;
        }
        .site-plan-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 12px;
        }
        .site-plan-link {
          color: var(--primary-color);
          text-decoration: none;
        }
        .site-leaflet-host {
          height: 100%;
          min-height: 240px;
          width: 100%;
        }
        .map-shell > ha-map {
          display: block;
          height: 100%;
          min-height: 240px;
        }
        .map-shell {
          border-radius: 18px;
          min-height: 240px;
          overflow: hidden;
        }
        .map-empty {
          align-items: center;
          background: color-mix(in srgb, var(--card-background-color) 72%, transparent);
          border: 1px dashed color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 18px;
          color: var(--secondary-text-color);
          display: flex;
          justify-content: center;
          min-height: 120px;
          padding: 18px;
          text-align: center;
        }
        .map-fallback {
          align-items: center;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--primary-color) 12%, transparent), transparent 60%),
            color-mix(in srgb, var(--card-background-color) 72%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 18px;
          display: grid;
          gap: 10px;
          justify-items: center;
          min-height: 120px;
          padding: 20px;
          text-align: center;
        }
        .map-fallback strong {
          font-size: 18px;
          letter-spacing: -0.02em;
        }
        .map-fallback a {
          color: var(--primary-color);
          font-size: 13px;
          text-decoration: none;
        }
        .empty {
          background: color-mix(in srgb, var(--card-background-color) 80%, transparent);
          border: 1px dashed color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 18px;
          color: var(--secondary-text-color);
          padding: 28px;
          text-align: center;
        }
        @media (max-width: 900px) {
          .stack {
            grid-template-columns: 1fr;
          }
        }
        @keyframes yarbo-refresh-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @media (max-width: 560px) {
          .device-header {
            align-items: stretch;
            flex-direction: column;
          }
          .device-header-indicators {
            justify-self: start;
          }
        }
      </style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div>
              <h1 class="title">S2JYarbo Overview</h1>
              <p class="subtitle">Live device health, RTK status, and current map position.</p>
            </div>
            <div class="status"></div>
          </div>
          <div class="error" hidden></div>
          <div class="stack"></div>
        </div>
      </ha-card>
    `;
    this._structureReady = true;
  }

  _createEntryElement(entryId) {
    const section = document.createElement("section");
    section.className = "device";
    section.dataset.entryId = entryId;
    section.innerHTML = `
      <div class="notification-toast" hidden role="status" aria-live="polite">
        <ha-icon class="notification-toast-icon" icon="mdi:bell-outline" aria-hidden="true"></ha-icon>
        <div class="notification-toast-copy">
          <div class="notification-toast-title"></div>
          <div class="notification-toast-message"></div>
        </div>
        <button class="notification-toast-close" type="button" aria-label="Dismiss notification" title="Dismiss notification">
          <ha-icon class="button-icon" icon="mdi:close" aria-hidden="true"></ha-icon>
        </button>
      </div>
      <div class="device-header">
        <div class="device-header-main">
          <h2 class="device-title"></h2>
          <div class="device-meta"></div>
        </div>
        <div class="device-header-indicators">
          <button class="device-refresh" type="button" aria-label="Refresh device data" title="Refresh device data">
            <ha-icon class="button-icon" icon="mdi:cached" aria-hidden="true"></ha-icon>
          </button>
          <div class="device-satellites unknown" role="img">
            <svg class="device-satellite-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.5 17.5 4 20m14-14 2.5-2.5M8 8l8 8m-9.5 1.5 3-3m8-8 3-3M9 3l12 12-6 2-8-8 2-6Z"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.7"
              />
            </svg>
            <span class="device-satellite-count">--</span>
          </div>
          <button class="device-battery battery-unknown" type="button">
            <div class="battery-icon" aria-hidden="true">
              <div class="battery-shell">
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-cell"></span>
                <span class="battery-bolt" hidden>&#9889;</span>
              </div>
              <span class="battery-tip"></span>
            </div>
          </button>
        </div>
      </div>
      <div class="device-actions">
        <label class="plan-picker">
          <div class="plan-picker-row">
            <span class="plan-picker-label">Plan</span>
            <select class="plan-select">
              <option value="">No plans loaded</option>
            </select>
          </div>
          <div class="plan-start-control">
            <span class="plan-start-header">
              <span class="plan-start-label">Start At</span>
              <span class="plan-start-value">0%</span>
            </span>
            <input class="plan-start-slider" type="range" min="0" max="100" step="1" value="0" />
          </div>
        </label>
        <button class="action-button icon-only" type="button" aria-label="Start Plan" title="Start Plan">
          <ha-icon class="button-icon" icon="mdi:play" aria-hidden="true"></ha-icon>
          <span class="button-label">Start Plan</span>
        </button>
        <button class="stop-button icon-only" type="button" aria-label="Stop" title="Stop">
          <ha-icon class="button-icon" icon="mdi:stop-circle" aria-hidden="true"></ha-icon>
          <span class="button-label">Stop</span>
        </button>
        <span class="action-status" hidden></span>
      </div>
      <div class="map-section">
        <div class="map-header">
          <div class="map-label">Map View</div>
          <button class="map-trail-toggle" type="button">Hide Trail</button>
        </div>
        <div class="map-container"></div>
      </div>
      <details class="advanced-panel">
        <summary class="advanced-summary">
          <span class="advanced-summary-label">
            <span class="advanced-summary-title">Advanced details</span>
            <span class="advanced-summary-copy">Status, battery, firmware, and diagnostics.</span>
          </span>
          <span class="advanced-summary-toggle" aria-hidden="true"></span>
        </summary>
        <div class="advanced-card">
          <div class="chip-row"></div>
          <div class="metrics"></div>
          <div class="advanced-controls">
            <div class="advanced-actions">
              <button class="advanced-command-button enable-button" type="button">Enable</button>
              <button class="advanced-command-button shutdown-button icon-only" type="button" aria-label="Shutdown" title="Shutdown">
                <ha-icon class="button-icon" icon="mdi:power-settings" aria-hidden="true"></ha-icon>
                <span class="button-label">Shutdown</span>
              </button>
              <button class="advanced-command-button restart-button icon-only" type="button" aria-label="Restart" title="Restart">
                <ha-icon class="button-icon" icon="mdi:restart" aria-hidden="true"></ha-icon>
                <span class="button-label">Restart</span>
              </button>
            </div>
            <label class="volume-control">
              <span class="volume-header">
                <span class="volume-label">Volume</span>
                <span class="volume-value">0%</span>
              </span>
              <input class="volume-slider" type="range" min="0" max="100" step="1" value="0" />
            </label>
            <div class="wifi-details"></div>
          </div>
        </div>
      </details>
    `;
    const actionButton = section.querySelector(".action-button");
    actionButton?.addEventListener("click", () => {
      void this._handlePrimaryPlanAction(entryId);
    });
    const stopButton = section.querySelector(".stop-button");
    stopButton?.addEventListener("click", () => {
      this._stop(entryId);
    });
    const enableButton = section.querySelector(".enable-button");
    enableButton?.addEventListener("click", () => {
      this._togglePowerActions(entryId);
    });
    const shutdownButton = section.querySelector(".shutdown-button");
    shutdownButton?.addEventListener("click", () => {
      this._shutdown(entryId);
    });
    const restartButton = section.querySelector(".restart-button");
    restartButton?.addEventListener("click", () => {
      this._restart(entryId);
    });
    const batteryButton = section.querySelector(".device-battery");
    batteryButton?.addEventListener("click", () => {
      this._recharge(entryId);
    });
    const refreshButton = section.querySelector(".device-refresh");
    refreshButton?.addEventListener("click", () => {
      void this._refreshDeviceData(entryId);
    });
    const toastClose = section.querySelector(".notification-toast-close");
    toastClose?.addEventListener("click", () => {
      this._hideNotificationToast(entryId, section);
    });
    const planSelect = section.querySelector(".plan-select");
    planSelect?.addEventListener("change", (event) => {
      const nextValue = event.target instanceof HTMLSelectElement ? event.target.value : "";
      if (nextValue) {
        this._selectedPlans.set(entryId, nextValue);
      } else {
        this._selectedPlans.delete(entryId);
      }
    });
    const planStartSlider = section.querySelector(".plan-start-slider");
    planStartSlider?.addEventListener("input", (event) => {
      const nextValue = event.target instanceof HTMLInputElement
        ? Number(event.target.value)
        : 0;
      this._planStartPercents.set(entryId, nextValue);
      this._updatePlanStartPercentDisplay(section, nextValue);
    });
    const trailToggle = section.querySelector(".map-trail-toggle");
    trailToggle?.addEventListener("click", () => {
      this._toggleBreadcrumbs(entryId);
    });
    const volumeSlider = section.querySelector(".volume-slider");
    volumeSlider?.addEventListener("input", (event) => {
      const nextValue = event.target instanceof HTMLInputElement
        ? Number(event.target.value)
        : 0;
      this._volumeDrafts.set(entryId, nextValue);
      this._updateVolumeDisplay(section, nextValue);
    });
    volumeSlider?.addEventListener("change", (event) => {
      const nextValue = event.target instanceof HTMLInputElement
        ? Number(event.target.value)
        : 0;
      this._volumeDrafts.set(entryId, nextValue);
      void this._setVolume(entryId, nextValue);
    });
    return section;
  }

  _updateEntryElement(section, entry) {
    const summary = entry.summary || {};
    const location = this._entryLocation(entry);
    const plans = Array.isArray(entry.plans) ? entry.plans : [];
    const wifi = entry.wifi || null;
    const lastNotification = entry.last_notification || null;
    const connectionState = entry.connection_state || "unknown";
    const errorCode = summary.error_code;
    const trackerEntityId = entry.tracker_entity_id;
    const hasFix =
      location.latitude !== null &&
      location.latitude !== undefined &&
      location.longitude !== null &&
      location.longitude !== undefined &&
      (location.fix_quality === null ||
        location.fix_quality === undefined ||
        Number(location.fix_quality) > 0);

    const chips = [
      `<span class="chip connection ${this._escape(connectionState)}">${this._escape(this._titleCase(connectionState.replaceAll("_", " ")))}</span>`,
    ];

    if (summary.rtk_fix_label) {
      chips.push(`<span class="chip fix">${this._escape(summary.rtk_fix_label)}</span>`);
    }

    if (summary.summary_source === "data_feedback") {
      chips.push(`<span class="chip fix">Requested Snapshot</span>`);
    }

    if (errorCode) {
      chips.push(`<span class="chip error">Error ${this._escape(errorCode)}</span>`);
    }

    const metrics = [
      ["Battery", this._percent(summary.battery_level)],
      ["Battery V / I", this._batteryElectrical(summary.battery_voltage, summary.battery_current)],
      ["Battery Health", this._percent(summary.battery_health)],
      ["Working", this._valueOrDash(summary.working_state_label || summary.working_state)],
      ["Charging", this._flag(summary.charging_status)],
      ["Heading", this._degrees(summary.heading)],
      ["Pitch / Roll", this._pitchRoll(summary.pitch, summary.roll)],
      ["Ambient Temp", this._temperature(summary.ambient_temperature)],
      ["Rain Sensor", this._valueOrDash(summary.rain_sensor)],
      ["Stop Button", this._pressedState(summary.stop_button_state)],
      ["Network", this._network(summary.mqtt_server_status, summary.ntrip_service_status, summary.dns_status)],
      ["Firmware", this._firmware(summary.body_firmware_version, summary.head_firmware_version)],
      ["Position", this._position(summary.combined_odom_x, summary.combined_odom_y)],
      ["Coords", this._coords(location.latitude, location.longitude)],
      ["GPS", this._gpsQuality(location)],
      ["Notifications", this._valueOrDash(entry.notification_count ?? 0)],
      ["Last Notice", this._notificationSummary(lastNotification)],
      ["Head", this._valueOrDash(summary.head_serial)],
      ["Updated", this._dateTime(summary.updated_at)],
    ]
      .filter(([, value]) => value !== null)
      .map(
        ([label, value]) => `
          <div class="metric">
            <span class="metric-label">${this._escape(label)}</span>
            <div class="metric-value">${this._escape(value)}</div>
          </div>
        `,
      )
      .join("");

    const title = section.querySelector(".device-title");
    if (title) {
      title.textContent = entry.title || "Yarbo";
    }

    const meta = section.querySelector(".device-meta");
    if (meta) {
      meta.innerHTML = `
        <span>Serial ${this._escape(entry.serial_number || "Unknown")}</span>
      `;
    }

    this._maybeShowNotificationToast(section, entry, lastNotification);

    const satelliteBadge = section.querySelector(".device-satellites");
    const satelliteCount = section.querySelector(".device-satellite-count");
    const satellites = this._satelliteCount(location.satellites);
    if (satelliteCount) {
      satelliteCount.textContent = satellites === null ? "--" : String(satellites);
    }
    if (satelliteBadge) {
      satelliteBadge.classList.remove("has-fix", "no-fix", "unknown");
      satelliteBadge.classList.add(
        satellites === null ? "unknown" : hasFix ? "has-fix" : "no-fix",
      );
      const satelliteLabel =
        satellites === null
          ? "Locked satellite count unavailable"
          : `${satellites} locked satellites${hasFix ? " with GPS fix" : ""}`;
      satelliteBadge.setAttribute("aria-label", satelliteLabel);
      satelliteBadge.title = satelliteLabel;
    }

    const refreshButton = section.querySelector(".device-refresh");
    if (refreshButton) {
      const refreshText = this._refreshingEntries.has(entry.entry_id)
        ? "Refreshing device data..."
        : "Refresh device data";
      refreshButton.disabled =
        this._refreshingEntries.has(entry.entry_id) ||
        connectionState !== "connected";
      refreshButton.classList.toggle(
        "is-refreshing",
        this._refreshingEntries.has(entry.entry_id),
      );
      refreshButton.title = refreshText;
      refreshButton.setAttribute("aria-label", refreshText);
    }

    const batteryBadge = section.querySelector(".device-battery");
    const batteryBolt = section.querySelector(".battery-bolt");
    const batteryCells = Array.from(section.querySelectorAll(".battery-cell"));
    const batterySoc = this._normalizedBatteryLevel(summary.battery_level);
    const batteryBars = this._batteryBars(batterySoc);
    const batteryTone = this._batteryTone(batterySoc);
    const charging = this._isCharging(summary.charging_status);
    if (batteryBolt) {
      batteryBolt.hidden = !charging;
    }
    if (batteryBadge) {
      batteryBadge.classList.remove(
        "battery-green",
        "battery-yellow",
        "battery-orange",
        "battery-red",
        "battery-unknown",
      );
      batteryBadge.classList.add(`battery-${batteryTone}`);
      const batteryLabelText = this._batteryAriaLabel(batterySoc, charging);
      batteryBadge.disabled =
        this._rechargingEntries.has(entry.entry_id) ||
        connectionState !== "connected" ||
        charging;
      batteryBadge.setAttribute(
        "aria-label",
        charging ? batteryLabelText : `${batteryLabelText}. Click to Recharge.`,
      );
      batteryBadge.title = charging ? "" : "Click to Recharge";
    }
    batteryCells.forEach((cell, index) => {
      cell.classList.toggle("is-active", index < batteryBars);
    });

    const chipRow = section.querySelector(".chip-row");
    if (chipRow) {
      chipRow.innerHTML = chips.join("");
    }

    const planActionState = this._planActionState(entry);
    const previousPlanActionState = this._lastPlanActionStates.get(entry.entry_id);
    if (
      previousPlanActionState &&
      previousPlanActionState !== "stopped" &&
      planActionState === "stopped"
    ) {
      this._resetPlanStartPercent(entry.entry_id);
    }
    this._lastPlanActionStates.set(entry.entry_id, planActionState);

    const planSelect = section.querySelector(".plan-select");
    if (planSelect) {
      const selectedPlan = this._selectedPlans.get(entry.entry_id);
      const resolvedValue = plans.some((plan) => plan.id === selectedPlan)
        ? selectedPlan
        : plans[0]?.id || "";
      if (resolvedValue) {
        this._selectedPlans.set(entry.entry_id, resolvedValue);
      } else {
        this._selectedPlans.delete(entry.entry_id);
      }

      planSelect.innerHTML = plans.length
        ? plans
            .map(
              (plan) => `
                <option value="${this._escape(plan.id)}" ${plan.id === resolvedValue ? "selected" : ""}>
                  ${this._escape(plan.name)}
                </option>
              `,
            )
            .join("")
        : `<option value="">No plans loaded</option>`;
      planSelect.disabled = plans.length === 0;
      const planTitle = plans.length
        ? `Selected plan id ${resolvedValue}`
        : "No cached plans available from read_all_plan";
      planSelect.title = planTitle;
      planSelect.setAttribute("aria-label", planTitle);
    }

    const currentStartPercent = this._resolvedPlanStartPercent(entry.entry_id);
    const planStartSlider = section.querySelector(".plan-start-slider");
    if (planStartSlider) {
      planStartSlider.value = String(currentStartPercent);
      planStartSlider.disabled = connectionState !== "connected";
    }
    this._updatePlanStartPercentDisplay(section, currentStartPercent);

    const metricsContainer = section.querySelector(".metrics");
    if (metricsContainer) {
      metricsContainer.innerHTML = metrics;
    }

    const actionButton = section.querySelector(".action-button");
    if (actionButton) {
      const hasSelectedPlan = plans.length > 0 && this._selectedPlans.has(entry.entry_id);
      const actionBusy =
        this._startingEntries.has(entry.entry_id) ||
        this._pausingEntries.has(entry.entry_id) ||
        this._resumingEntries.has(entry.entry_id) ||
        this._stoppingEntries.has(entry.entry_id) ||
        this._shuttingDownEntries.has(entry.entry_id) ||
        this._restartingEntries.has(entry.entry_id);
      actionButton.disabled =
        actionBusy ||
        connectionState !== "connected" ||
        (planActionState === "stopped" && !hasSelectedPlan);
      const actionButtonLabel = actionButton.querySelector(".button-label");
      const actionButtonIcon = actionButton.querySelector(".button-icon");
      let actionButtonText = "Start Plan";
      let actionButtonIconName = "mdi:play";
      if (this._startingEntries.has(entry.entry_id)) {
        actionButtonText = "Starting...";
      } else if (this._pausingEntries.has(entry.entry_id)) {
        actionButtonText = "Pausing...";
        actionButtonIconName = "mdi:pause";
      } else if (this._resumingEntries.has(entry.entry_id)) {
        actionButtonText = "Resuming...";
      } else if (planActionState === "running") {
        actionButtonText = "Pause Plan";
        actionButtonIconName = "mdi:pause";
      } else if (planActionState === "paused") {
        actionButtonText = "Resume Plan";
      }
      if (actionButtonLabel) {
        actionButtonLabel.textContent = actionButtonText;
      }
      if (actionButtonIcon) {
        actionButtonIcon.setAttribute("icon", actionButtonIconName);
      }
      actionButton.title = actionButtonText;
      actionButton.setAttribute("aria-label", actionButtonText);
    }

    const stopButton = section.querySelector(".stop-button");
    if (stopButton) {
      stopButton.disabled =
        this._stoppingEntries.has(entry.entry_id) ||
        this._startingEntries.has(entry.entry_id) ||
        this._pausingEntries.has(entry.entry_id) ||
        this._resumingEntries.has(entry.entry_id) ||
        this._shuttingDownEntries.has(entry.entry_id) ||
        this._restartingEntries.has(entry.entry_id) ||
        connectionState !== "connected";
      const stopButtonLabel = stopButton.querySelector(".button-label");
      const stopButtonText = this._stoppingEntries.has(entry.entry_id)
        ? "Stopping..."
        : "Stop";
      if (stopButtonLabel) {
        stopButtonLabel.textContent = stopButtonText;
      }
      stopButton.title = stopButtonText;
      stopButton.setAttribute("aria-label", stopButtonText);
    }

    const enableButton = section.querySelector(".enable-button");
    const shutdownButton = section.querySelector(".shutdown-button");
    const powerActionsEnabled = this._enabledPowerEntries.has(entry.entry_id);
    const powerActionsBusy =
      this._shuttingDownEntries.has(entry.entry_id) ||
      this._restartingEntries.has(entry.entry_id) ||
      this._startingEntries.has(entry.entry_id) ||
      this._pausingEntries.has(entry.entry_id) ||
      this._resumingEntries.has(entry.entry_id) ||
      this._stoppingEntries.has(entry.entry_id);
    if (enableButton) {
      enableButton.disabled = powerActionsBusy || connectionState !== "connected";
      enableButton.textContent = powerActionsEnabled ? "Enabled" : "Enable";
      enableButton.classList.toggle("is-armed", powerActionsEnabled);
      enableButton.title = powerActionsEnabled
        ? "Shutdown and restart are enabled for 10 seconds."
        : "Enable shutdown and restart controls.";
      enableButton.setAttribute("aria-label", enableButton.title);
    }
    if (shutdownButton) {
      shutdownButton.disabled =
        !powerActionsEnabled ||
        powerActionsBusy ||
        connectionState !== "connected";
      const shutdownButtonLabel = shutdownButton.querySelector(".button-label");
      const shutdownButtonText = this._shuttingDownEntries.has(entry.entry_id)
        ? "Shutting down..."
        : "Shutdown";
      if (shutdownButtonLabel) {
        shutdownButtonLabel.textContent = shutdownButtonText;
      }
      shutdownButton.title = shutdownButtonText;
      shutdownButton.setAttribute("aria-label", shutdownButtonText);
    }

    const restartButton = section.querySelector(".restart-button");
    if (restartButton) {
      restartButton.disabled =
        !powerActionsEnabled ||
        powerActionsBusy ||
        connectionState !== "connected";
      const restartButtonLabel = restartButton.querySelector(".button-label");
      const restartButtonText = this._restartingEntries.has(entry.entry_id)
        ? "Restarting..."
        : "Restart";
      if (restartButtonLabel) {
        restartButtonLabel.textContent = restartButtonText;
      }
      restartButton.title = restartButtonText;
      restartButton.setAttribute("aria-label", restartButtonText);
    }

    const summaryVolume = this._volumePercent(summary.volume);
    const draftVolume = this._volumeDrafts.get(entry.entry_id);
    if (
      draftVolume !== undefined &&
      summaryVolume !== null &&
      Math.abs(draftVolume - summaryVolume) < 1
    ) {
      this._volumeDrafts.delete(entry.entry_id);
    }
    const resolvedVolume = this._volumeDrafts.get(entry.entry_id) ?? summaryVolume ?? 0;
    const volumeSlider = section.querySelector(".volume-slider");
    if (volumeSlider instanceof HTMLInputElement) {
      volumeSlider.value = String(resolvedVolume);
      volumeSlider.disabled =
        this._updatingVolumeEntries.has(entry.entry_id) ||
        this._shuttingDownEntries.has(entry.entry_id) ||
        this._restartingEntries.has(entry.entry_id) ||
        connectionState !== "connected";
      volumeSlider.setAttribute("aria-label", `Volume ${resolvedVolume}%`);
      volumeSlider.title = `Volume ${resolvedVolume}%`;
    }
    this._updateVolumeDisplay(section, resolvedVolume);

    const wifiDetails = section.querySelector(".wifi-details");
    if (wifiDetails) {
      wifiDetails.innerHTML = this._renderWifiDetails(wifi);
    }

    const actionStatus = section.querySelector(".action-status");
    const actionState = this._actionStatus.get(entry.entry_id);
    if (actionStatus) {
      actionStatus.hidden = !actionState?.message;
      actionStatus.textContent = actionState?.message || "";
      actionStatus.classList.toggle("error", actionState?.level === "error");
    }

    this._updateEntryMap(section, entry, location, trackerEntityId, hasFix);
    this._updateTrailToggle(section, entry);
    this._maybeRequestMapData(entry);
    this._maybeRefreshStaleData(entry);
  }

  async _handlePrimaryPlanAction(entryId) {
    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry) {
      return;
    }

    const actionState = this._planActionState(entry);
    if (actionState === "running") {
      await this._pausePlan(entryId);
      return;
    }
    if (actionState === "paused") {
      await this._resumePlan(entryId);
      return;
    }
    await this._startPlan(entryId);
  }

  async _startPlan(entryId) {
    if (
      !this._hass ||
      this._startingEntries.has(entryId) ||
      this._pausingEntries.has(entryId) ||
      this._resumingEntries.has(entryId)
    ) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    const selectedPlanId = this._selectedPlans.get(entryId);
    const selectedPlan = Array.isArray(entry.plans)
      ? entry.plans.find((plan) => plan.id === selectedPlanId)
      : null;
    if (!selectedPlanId || !selectedPlan) {
      this._setActionStatus(entryId, "Select a plan first.", "error");
      this._render();
      return;
    }

    this._startingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const startPercent = this._resolvedPlanStartPercent(entryId);
      const response = await this._hass.callApi("POST", "s2jyarbo/start_plan", {
        entry_id: entryId,
        plan_id: selectedPlanId,
        percent: startPercent,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(
        entryId,
        `Started ${selectedPlan.name} at ${Math.round(startPercent)}% via ${topic}`,
        "info",
      );
      this._scheduleDashboardReload(200);
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Start failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._startingEntries.delete(entryId);
      this._render();
    }
  }

  async _pausePlan(entryId) {
    if (
      !this._hass ||
      this._pausingEntries.has(entryId) ||
      this._startingEntries.has(entryId) ||
      this._resumingEntries.has(entryId)
    ) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    this._pausingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/pause", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(entryId, `Pause command sent via ${topic}`, "info");
      this._scheduleDashboardReload(200);
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Pause failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._pausingEntries.delete(entryId);
      this._render();
    }
  }

  async _resumePlan(entryId) {
    if (
      !this._hass ||
      this._resumingEntries.has(entryId) ||
      this._startingEntries.has(entryId) ||
      this._pausingEntries.has(entryId)
    ) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    this._resumingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/resume", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(entryId, `Resume command sent via ${topic}`, "info");
      this._scheduleDashboardReload(200);
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Resume failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._resumingEntries.delete(entryId);
      this._render();
    }
  }

  async _recharge(entryId) {
    if (!this._hass || this._rechargingEntries.has(entryId)) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    this._rechargingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/recharge", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(entryId, `Recharge command sent via ${topic}`, "info");
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Recharge failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._rechargingEntries.delete(entryId);
      this._render();
    }
  }

  async _stop(entryId) {
    if (!this._hass || this._stoppingEntries.has(entryId)) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    this._stoppingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/stop", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._resetPlanStartPercent(entryId);
      this._setActionStatus(entryId, `Stop command sent via ${topic}`, "info");
      this._scheduleDashboardReload(200);
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._stoppingEntries.delete(entryId);
      this._render();
    }
  }

  async _shutdown(entryId) {
    if (!this._hass || this._shuttingDownEntries.has(entryId)) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }
    if (!this._enabledPowerEntries.has(entryId)) {
      this._setActionStatus(entryId, "Press Enable before shutdown.", "error");
      this._render();
      return;
    }

    this._setPowerActionsEnabled(entryId, false);
    this._shuttingDownEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/shutdown", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(entryId, `Shutdown command sent via ${topic}`, "info");
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._shuttingDownEntries.delete(entryId);
      this._render();
    }
  }

  async _restart(entryId) {
    if (!this._hass || this._restartingEntries.has(entryId)) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }
    if (!this._enabledPowerEntries.has(entryId)) {
      this._setActionStatus(entryId, "Press Enable before restart.", "error");
      this._render();
      return;
    }

    this._setPowerActionsEnabled(entryId, false);
    this._restartingEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/restart", {
        entry_id: entryId,
      });
      const topic = response?.topic || "command topic";
      this._setActionStatus(entryId, `Restart command sent via ${topic}`, "info");
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Restart failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._restartingEntries.delete(entryId);
      this._render();
    }
  }

  async _setVolume(entryId, percent) {
    if (!this._hass || this._updatingVolumeEntries.has(entryId)) {
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry || entry.connection_state !== "connected") {
      this._setActionStatus(entryId, "Device is not connected.", "error");
      this._render();
      return;
    }

    this._updatingVolumeEntries.add(entryId);
    this._actionStatus.delete(entryId);
    this._render();

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/set_volume", {
        entry_id: entryId,
        percent,
      });
      const appliedVolume = response?.volume;
      if (typeof appliedVolume === "number" && Number.isFinite(appliedVolume)) {
        this._volumeDrafts.set(entryId, Math.round(appliedVolume * 100));
      }
      this._setActionStatus(entryId, `Volume set to ${Math.round(percent)}%`, "info");
      this._scheduleDashboardReload(200);
    } catch (err) {
      this._setActionStatus(
        entryId,
        `Volume update failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      this._updatingVolumeEntries.delete(entryId);
      this._render();
    }
  }

  _togglePowerActions(entryId) {
    const nextEnabled = !this._enabledPowerEntries.has(entryId);
    this._setPowerActionsEnabled(entryId, nextEnabled);
    this._setActionStatus(
      entryId,
      nextEnabled
        ? "Shutdown and restart enabled for 10 seconds."
        : "Shutdown and restart disabled.",
      "info",
    );
    this._render();
  }

  _setPowerActionsEnabled(entryId, enabled) {
    const existingTimer = this._powerEnableTimers.get(entryId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this._powerEnableTimers.delete(entryId);
    }

    if (!enabled) {
      this._enabledPowerEntries.delete(entryId);
      return;
    }

    this._enabledPowerEntries.add(entryId);
    const timer = window.setTimeout(() => {
      this._enabledPowerEntries.delete(entryId);
      this._powerEnableTimers.delete(entryId);
      this._render();
    }, 10000);
    this._powerEnableTimers.set(entryId, timer);
  }

  _setActionStatus(entryId, message, level) {
    this._actionStatus.set(entryId, { message, level });

    const existingTimer = this._actionStatusTimers.get(entryId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this._actionStatus.delete(entryId);
      this._actionStatusTimers.delete(entryId);
      this._render();
    }, level === "error" ? 8000 : 5000);
    this._actionStatusTimers.set(entryId, timer);
  }

  _planActionState(entry) {
    const summary = entry?.summary || {};
    const hasPlanningFlags =
      summary.planning_paused !== null &&
        summary.planning_paused !== undefined
      || summary.on_going_planning !== null &&
        summary.on_going_planning !== undefined;

    if (summary.planning_paused === true) {
      return "paused";
    }

    if (summary.on_going_planning === true) {
      return "running";
    }

    if (hasPlanningFlags) {
      return "stopped";
    }

    if (entry?.plan_feedback?.plan_running) {
      return "running";
    }

    return "stopped";
  }

  _updateVolumeDisplay(section, percent) {
    const volumeValue = section.querySelector(".volume-value");
    if (volumeValue) {
      volumeValue.textContent = `${Math.round(percent)}%`;
    }
  }

  _resolvedPlanStartPercent(entryId) {
    const storedPercent = Number(this._planStartPercents.get(entryId));
    if (!Number.isFinite(storedPercent)) {
      this._planStartPercents.set(entryId, 0);
      return 0;
    }

    const resolvedPercent = Math.min(100, Math.max(0, Math.round(storedPercent)));
    this._planStartPercents.set(entryId, resolvedPercent);
    return resolvedPercent;
  }

  _resetPlanStartPercent(entryId) {
    this._planStartPercents.set(entryId, 0);
  }

  _updatePlanStartPercentDisplay(section, percent) {
    const resolvedPercent = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const percentValue = section.querySelector(".plan-start-value");
    if (percentValue) {
      percentValue.textContent = `${resolvedPercent}%`;
    }
  }

  _renderWifiDetails(wifi) {
    const wifiItems = wifi
      ? [
          ["Name", wifi.name || "Unknown"],
          ["Security", wifi.security || "Unknown"],
          ["Signal", wifi.signal !== null && wifi.signal !== undefined ? `${wifi.signal}%` : "Unknown"],
          ["IP", wifi.ip || "Unknown"],
          ["Saved", wifi.saved === null || wifi.saved === undefined ? "Unknown" : wifi.saved ? "Yes" : "No"],
        ]
      : [];

    if (!wifiItems.length) {
      return `
        <div class="wifi-title">Wi-Fi</div>
        <div class="sample-empty">No cached get_connect_wifi_name response yet.</div>
      `;
    }

    return `
      <div class="wifi-title">Wi-Fi</div>
      <div class="wifi-grid">
        ${wifiItems
          .map(
            ([label, value]) => `
              <div class="wifi-item">
                <span class="wifi-key">${this._escape(label)}</span>
                <span class="wifi-value">${this._escape(value)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  _volumePercent(volume) {
    const numeric = Number(volume);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  }

  _updateEntryMap(section, entry, location, trackerEntityId, hasFix) {
    const mapContainer = section.querySelector(".map-container");
    if (!mapContainer) {
      return;
    }

    let widget = mapContainer.querySelector("s2jyarbo-map-widget");
    if (!widget) {
      widget = document.createElement("s2jyarbo-map-widget");
      widget.embedded = true;
      mapContainer.replaceChildren(widget);
    }

    widget.embedded = true;
    widget.entryData = entry;
    widget.hass = this._hass;
  }

  _updateTrailToggle(section, entry) {
    const button = section.querySelector(".map-trail-toggle");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.hidden = true;
  }

  _toggleBreadcrumbs(entryId) {
    if (this._hiddenBreadcrumbEntries.has(entryId)) {
      this._hiddenBreadcrumbEntries.delete(entryId);
    } else {
      this._hiddenBreadcrumbEntries.add(entryId);
    }

    const section = this._entryElements.get(entryId);
    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    if (section && entry) {
      this._updateTrailToggle(section, entry);
    }

    void this._attachMaps();
  }

  _ensureNativeMapShell(mapContainer, entry, location) {
    const existingShell = mapContainer.querySelector(".map-shell");
    const existingLegend = mapContainer.querySelector(".site-plan-legend");
    const wantsLegend = Boolean(entry.site_map);
    const legendLink = wantsLegend
      ? this._renderSitePlanLink(location, entry.site_map.reference)
      : "";
    const legendStats = wantsLegend
      ? this._renderSiteMapStats(entry.site_map)
      : "";

    if (
      !(existingShell instanceof HTMLElement) ||
      existingShell.dataset.mapHost !== entry.entry_id ||
      Boolean(existingLegend) !== wantsLegend
    ) {
      mapContainer.innerHTML = `
        <div class="map-shell" data-map-host="${this._escape(entry.entry_id)}"></div>
        ${wantsLegend ? `
          <div class="site-plan-legend" data-site-map-entry="${this._escape(entry.entry_id)}">
            <div class="site-plan-stats">${legendStats}</div>
            <span class="site-plan-live-link">${legendLink}</span>
          </div>
        ` : ""}
      `;
      return;
    }

    if (existingLegend instanceof HTMLElement && wantsLegend) {
      const stats = existingLegend.querySelector(".site-plan-stats");
      if (stats instanceof HTMLElement) {
        stats.innerHTML = legendStats;
      }
      const liveLink = existingLegend.querySelector(".site-plan-live-link");
      if (liveLink instanceof HTMLElement) {
        liveLink.innerHTML = legendLink;
      }
    }
  }

  _refreshLiveSitePlans() {
    for (const entry of this._entries) {
      if (!entry.site_map) {
        continue;
      }

      const location = this._entryLocation(entry);
      const sitePlan = this.shadowRoot?.querySelector(
        `[data-site-map-entry="${entry.entry_id}"]`,
      );
      const liveLink = sitePlan?.querySelector(".site-plan-live-link");
      if (liveLink instanceof HTMLElement) {
        liveLink.innerHTML = this._renderSitePlanLink(location, entry.site_map.reference);
      }
    }
  }

  _refreshDirectionalMarkers() {
    for (const entry of this._entries) {
      const state = this._directionalMarkers.get(entry.entry_id);
      if (!state) {
        continue;
      }

      const location = this._entryLocation(entry);
      const heading = this._entryHeading(entry);
      this._ensureNativeMarkerSuppression(entry.entry_id, state.mapElement);
      this._hideNativeMapMarkers(entry.entry_id, state.mapElement);
      this._syncDirectionalMarker(entry.entry_id, state.mapElement, location, heading);
    }
  }

  async _ensureDirectionalMarker(entry, mapCard) {
    const mapElement = await this._waitForMapCardMap(mapCard);
    if (!mapElement) {
      return;
    }

    const location = this._entryLocation(entry);
    const heading = this._entryHeading(entry);
    this._ensureNativeMarkerSuppression(entry.entry_id, mapElement);
    this._hideNativeMapMarkers(entry.entry_id, mapElement);
    this._syncDirectionalMarker(entry.entry_id, mapElement, location, heading);
  }

  _syncDirectionalMarker(entryId, mapElement, location, heading) {
    const latLng = this._latLngFromLocation(location);
    const existingState = this._directionalMarkers.get(entryId);
    if (!latLng) {
      this._clearDirectionalMarker(entryId);
      return;
    }

    const normalizedHeading = Number.isFinite(Number(heading))
      ? ((Number(heading) % 360) + 360) % 360
      : 0;

    if (!existingState || existingState.mapElement !== mapElement) {
      existingState?.marker.remove();
      const marker = mapElement.Leaflet.marker(latLng, {
        icon: this._directionalMarkerIcon(mapElement.Leaflet, normalizedHeading),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000,
      });
      marker.addTo(mapElement.leafletMap);
      this._directionalMarkers.set(entryId, {
        mapElement,
        marker,
        heading: normalizedHeading,
      });
      return;
    }

    existingState.marker.setLatLng(latLng);
    if (Math.abs(existingState.heading - normalizedHeading) > 0.1) {
      existingState.marker.setIcon(
        this._directionalMarkerIcon(mapElement.Leaflet, normalizedHeading),
      );
      existingState.heading = normalizedHeading;
    }
  }

  _clearDirectionalMarker(entryId) {
    const existingState = this._directionalMarkers.get(entryId);
    if (!existingState) {
      return;
    }

    existingState.marker.remove();
    this._directionalMarkers.delete(entryId);
  }

  _ensureNativeMarkerSuppression(entryId, mapElement) {
    const existingState = this._nativeMarkerSuppressors.get(entryId);
    if (existingState?.mapElement === mapElement) {
      return;
    }

    if (existingState) {
      for (const observer of existingState.observers) {
        observer.disconnect();
      }
      this._nativeMarkerSuppressors.delete(entryId);
    }

    const panes = mapElement?.leafletMap?.getPanes?.();
    const targets = [panes?.markerPane, panes?.shadowPane, panes?.overlayPane].filter(
      (pane) => pane instanceof HTMLElement || pane instanceof SVGElement,
    );
    const observers = [];

    for (const target of targets) {
      const observer = new MutationObserver(() => {
        this._hideNativeMapMarkers(entryId, mapElement);
      });
      observer.observe(target, {
        childList: true,
        subtree: true,
      });
      observers.push(observer);
    }

    this._nativeMarkerSuppressors.set(entryId, {
      mapElement,
      observers,
    });
  }

  _clearNativeMarkerSuppression(entryId) {
    const existingState = this._nativeMarkerSuppressors.get(entryId);
    if (!existingState) {
      return;
    }

    for (const observer of existingState.observers) {
      observer.disconnect();
    }
    this._nativeMarkerSuppressors.delete(entryId);
  }

  _hideNativeMapMarkers(entryId, mapElement) {
    const hideTrail = this._hiddenBreadcrumbEntries.has(entryId);

    for (const layer of Array.isArray(mapElement?._mapItems) ? mapElement._mapItems : []) {
      const element = layer?.getElement?.();
      if (element instanceof HTMLElement) {
        element.style.display = "none";
      }

      const path = layer?._path;
      if (path instanceof SVGElement) {
        const isCircleLike =
          Number.isFinite(Number(layer?.options?.radius)) ||
          Number.isFinite(Number(layer?._radius));
        path.style.display = hideTrail || isCircleLike ? "none" : "";
      }
    }

    const panes = mapElement?.leafletMap?.getPanes?.();
    const markerPane = panes?.markerPane;
    if (markerPane instanceof HTMLElement) {
      for (const child of Array.from(markerPane.children)) {
        if (!(child instanceof HTMLElement)) {
          continue;
        }
        if (!child.classList.contains("yarbo-directional-marker")) {
          child.style.display = "none";
        }
      }
    }

    const shadowPane = panes?.shadowPane;
    if (shadowPane instanceof HTMLElement) {
      for (const child of Array.from(shadowPane.children)) {
        if (child instanceof HTMLElement) {
          child.style.display = "none";
        }
      }
    }
  }

  _directionalMarkerIcon(leaflet, heading) {
    const rotation = (Number.isFinite(heading) ? heading : 0) - 90;
    const html = `
      <div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;transform:rotate(${this._number(rotation)}deg);transform-origin:center center;filter:drop-shadow(0 1px 3px rgba(15,23,42,0.45));">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 1.5 L16.4 18 L10 14.4 L3.6 18 Z" fill="#0a84ff" stroke="#ffffff" stroke-width="1.35" stroke-linejoin="round"></path>
        </svg>
      </div>
    `;

    return leaflet.divIcon({
      className: "yarbo-directional-marker",
      html,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  async _applySiteMapOverlay(entry, mapCard) {
    const mapElement = await this._waitForMapCardMap(mapCard);
    if (!mapElement) {
      return;
    }

    const layersSignature = this._siteMapSignature(entry.site_map);
    const existingState = this._siteMapLayers.get(entry.entry_id);
    if (
      existingState &&
      existingState.mapElement === mapElement &&
      existingState.layersSignature === layersSignature
    ) {
      return;
    }

    mapElement.layers = this._buildSiteMapLayers(mapElement, entry.site_map);
    this._siteMapLayers.set(entry.entry_id, {
      mapElement,
      layersSignature,
    });
    mapElement.fitMap?.({ unpause_autofit: true, zoom: 24, pad: 0.12 });
  }

  _clearSiteMapOverlay(entryId) {
    const existingState = this._siteMapLayers.get(entryId);
    if (!existingState) {
      return;
    }

    existingState.mapElement.layers = [];
    this._siteMapLayers.delete(entryId);
  }

  async _waitForMapCardMap(mapCard, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mapElement = mapCard.shadowRoot?.querySelector("ha-map");
      if (mapElement?.leafletMap && mapElement?.Leaflet) {
        return mapElement;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  }

  _buildSiteMapLayers(element, siteMap) {
    const leaflet = element.Leaflet;
    const reference = siteMap?.reference;
    if (!leaflet || !reference) {
      return [];
    }

    const layers = [];

    for (const area of Array.isArray(siteMap.areas) ? siteMap.areas : []) {
      const latLngs = this._latLngsFromLocalPoints(area.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      layers.push(
        leaflet.polygon(latLngs, {
          color: "#2da699",
          fillColor: "#2da699",
          fillOpacity: 0.18,
          opacity: 0.72,
          weight: 2,
        }),
      );
    }

    for (const fence of Array.isArray(siteMap.electric_fence) ? siteMap.electric_fence : []) {
      const latLngs = this._latLngsFromLocalPoints(fence.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      layers.push(
        leaflet.polygon(latLngs, {
          color: "#495057",
          fillColor: "#495057",
          fillOpacity: 0.06,
          opacity: 0.72,
          weight: 2,
        }),
      );
    }

    for (const noGo of Array.isArray(siteMap.nogozones) ? siteMap.nogozones : []) {
      const latLngs = this._latLngsFromLocalPoints(noGo.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      layers.push(
        leaflet.polygon(latLngs, {
          color: "#e03131",
          dashArray: "6 4",
          fillColor: "#e03131",
          fillOpacity: 0.16,
          opacity: 0.78,
          weight: 2,
        }),
      );
    }

    for (const pathway of Array.isArray(siteMap.pathways) ? siteMap.pathways : []) {
      const latLngs = this._latLngsFromLocalPoints(pathway.points, reference);
      if (latLngs.length < 2) {
        continue;
      }
      layers.push(
        leaflet.polyline(latLngs, {
          color: "#f0b429",
          dashArray: "7 5",
          lineCap: "round",
          lineJoin: "round",
          opacity: 0.92,
          weight: 3,
        }),
      );
    }

    for (const chargingPoint of Array.isArray(siteMap.charging_points) ? siteMap.charging_points : []) {
      const latLng = this._latLngFromLocal(chargingPoint.point, reference);
      if (latLng) {
        const label = chargingPoint.name
          ? `Charging point ${chargingPoint.name}`
          : chargingPoint.id !== null && chargingPoint.id !== undefined
            ? `Charging point ${chargingPoint.id}`
            : "Charging point";
        layers.push(
          leaflet.circleMarker(latLng, {
            color: "#ffffff",
            fillColor: "#2da699",
            fillOpacity: 0.95,
            opacity: 0.88,
            radius: 6,
            weight: 2,
          }),
        );

        const startLatLng = this._latLngFromLocal(chargingPoint.start_point, reference);
        if (startLatLng) {
          layers.push(
            leaflet.circleMarker(startLatLng, {
              color: "#2da699",
              fillColor: "#ffffff",
              fillOpacity: 0.22,
              opacity: 0.72,
              radius: 4,
              weight: 2,
            }),
          );
        }
      }
    }

    return layers;
  }

  _ensureSiteMapShell(mapContainer, entry, location) {
    const selector = `[data-site-plan-entry="${entry.entry_id}"]`;
    let sitePlan = mapContainer.querySelector(selector);
    if (!(sitePlan instanceof HTMLElement)) {
      mapContainer.innerHTML = this._renderSiteMapShell(
        entry.entry_id,
        entry.site_map,
        location,
      );
      sitePlan = mapContainer.querySelector(selector);
      this._bindSiteLeafletControls(mapContainer, entry.entry_id);
      return;
    }

    const stats = sitePlan.querySelector(".site-plan-stats");
    if (stats instanceof HTMLElement) {
      stats.innerHTML = this._renderSiteMapStats(entry.site_map);
    }

    const liveLink = sitePlan.querySelector(".site-plan-live-link");
    if (liveLink instanceof HTMLElement) {
      liveLink.innerHTML = this._renderSitePlanLink(location, entry.site_map.reference);
    }
  }

  _renderSiteMapShell(entryId, siteMap, location) {
    return `
      <div class="site-plan" data-site-plan-entry="${this._escape(entryId)}">
        <div class="site-plan-surface">
          <div class="site-plan-controls">
            <button class="site-plan-button" type="button" data-site-plan-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="site-plan-button" type="button" data-site-plan-action="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
            <button class="site-plan-button" type="button" data-site-plan-action="reset" title="Reset view" aria-label="Reset view">Reset</button>
          </div>
          <div class="site-leaflet-host" data-site-map-host="${this._escape(entryId)}"></div>
        </div>
        <div class="site-plan-legend">
          <div class="site-plan-stats">${this._renderSiteMapStats(siteMap)}</div>
          <span class="site-plan-live-link">${this._renderSitePlanLink(location, siteMap.reference)}</span>
        </div>
      </div>
    `;
  }

  _renderSiteMapStats(siteMap) {
    const stats = [
      `${siteMap.areas?.length || 0} areas`,
      `${siteMap.nogozones?.length || 0} no-go zones`,
      `${siteMap.pathways?.length || 0} pathways`,
      `${siteMap.charging_points?.length || 0} charging points`,
    ];

    return `
      <span>${this._escape(stats.join(" · "))}</span>
    `;
  }

  _bindSiteLeafletControls(mapContainer, entryId) {
    const sitePlan = mapContainer.querySelector(`[data-site-plan-entry="${entryId}"]`);
    if (!sitePlan || sitePlan.dataset.bound === "1") {
      return;
    }

    sitePlan.dataset.bound = "1";

    sitePlan
      .querySelector('[data-site-plan-action="zoom-in"]')
      ?.addEventListener("click", () => this._zoomSiteLeaflet(entryId, 1));
    sitePlan
      .querySelector('[data-site-plan-action="zoom-out"]')
      ?.addEventListener("click", () => this._zoomSiteLeaflet(entryId, -1));
    sitePlan
      .querySelector('[data-site-plan-action="reset"]')
      ?.addEventListener("click", () => this._resetSiteLeaflet(entryId));
  }

  _attachSiteLeafletMap(entry, location) {
    const host = this.shadowRoot?.querySelector(
      `[data-site-map-host="${entry.entry_id}"]`,
    );
    if (!(host instanceof HTMLElement)) {
      return;
    }

    const leaflet = window.L;
    if (!leaflet?.map) {
      host.innerHTML = this._renderMapFallback(location);
      return;
    }

    let state = this._siteLeafletMaps.get(entry.entry_id);
    if (!state || state.host !== host) {
      state?.map.remove();
      host.replaceChildren();
      const map = leaflet.map(host, {
        attributionControl: true,
        zoomControl: false,
      });
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 22,
        })
        .addTo(map);

      state = {
        host,
        map,
        overlayLayer: leaflet.featureGroup().addTo(map),
        liveMarker: leaflet.circleMarker([0, 0], {
          color: "#0a84ff",
          fillColor: "#ffffff",
          fillOpacity: 0.96,
          opacity: 0.96,
          radius: 7,
          weight: 3,
        }),
        siteSignature: "",
        baseBounds: null,
      };
      this._siteLeafletMaps.set(entry.entry_id, state);
    }

    const siteSignature = this._siteMapSignature(entry.site_map);
    if (siteSignature !== state.siteSignature) {
      state.overlayLayer.clearLayers();
      this._populateSiteLeafletOverlays(leaflet, state.overlayLayer, entry.site_map);
      state.siteSignature = siteSignature;
      state.baseBounds = state.overlayLayer.getBounds();

      if (state.baseBounds?.isValid?.()) {
        state.map.fitBounds(state.baseBounds.pad(0.12), {
          animate: false,
          padding: [18, 18],
        });
      } else {
        const liveLatLng = this._latLngFromLocation(location);
        if (liveLatLng) {
          state.map.setView(liveLatLng, 20, { animate: false });
        }
      }
    }

    this._updateSiteLeafletMarker(entry.entry_id, location);
    window.requestAnimationFrame(() => {
      state.map.invalidateSize(false);
    });
  }

  _populateSiteLeafletOverlays(leaflet, overlayLayer, siteMap) {
    const reference = siteMap?.reference;
    if (!reference) {
      return;
    }

    for (const area of Array.isArray(siteMap.areas) ? siteMap.areas : []) {
      const latLngs = this._latLngsFromLocalPoints(area.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      leaflet
        .polygon(latLngs, {
          color: "#2da699",
          fillColor: "#2da699",
          fillOpacity: 0.18,
          opacity: 0.72,
          weight: 2,
        })
        .addTo(overlayLayer);
    }

    for (const fence of Array.isArray(siteMap.electric_fence) ? siteMap.electric_fence : []) {
      const latLngs = this._latLngsFromLocalPoints(fence.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      leaflet
        .polygon(latLngs, {
          color: "#495057",
          fillColor: "#495057",
          fillOpacity: 0.06,
          opacity: 0.72,
          weight: 2,
        })
        .addTo(overlayLayer);
    }

    for (const noGo of Array.isArray(siteMap.nogozones) ? siteMap.nogozones : []) {
      const latLngs = this._latLngsFromLocalPoints(noGo.points, reference);
      if (latLngs.length < 3) {
        continue;
      }
      leaflet
        .polygon(latLngs, {
          color: "#e03131",
          dashArray: "6 4",
          fillColor: "#e03131",
          fillOpacity: 0.16,
          opacity: 0.78,
          weight: 2,
        })
        .addTo(overlayLayer);
    }

    for (const pathway of Array.isArray(siteMap.pathways) ? siteMap.pathways : []) {
      const latLngs = this._latLngsFromLocalPoints(pathway.points, reference);
      if (latLngs.length < 2) {
        continue;
      }
      leaflet
        .polyline(latLngs, {
          color: "#f0b429",
          dashArray: "7 5",
          lineCap: "round",
          lineJoin: "round",
          opacity: 0.92,
          weight: 3,
        })
        .addTo(overlayLayer);
    }

    for (const chargingPoint of Array.isArray(siteMap.charging_points) ? siteMap.charging_points : []) {
      const latLng = this._latLngFromLocal(chargingPoint.point, reference);
      if (!latLng) {
        continue;
      }
      const label = chargingPoint.name
        ? `Charging point ${chargingPoint.name}`
        : chargingPoint.id !== null && chargingPoint.id !== undefined
          ? `Charging point ${chargingPoint.id}`
          : "Charging point";
      leaflet
        .circleMarker(latLng, {
          color: "#ffffff",
          fillColor: "#2da699",
          fillOpacity: 0.95,
          opacity: 0.88,
          radius: 6,
          weight: 2,
        })
        .addTo(overlayLayer);

      const startLatLng = this._latLngFromLocal(chargingPoint.start_point, reference);
      if (startLatLng) {
        leaflet
          .circleMarker(startLatLng, {
            color: "#2da699",
            fillColor: "#ffffff",
            fillOpacity: 0.22,
            opacity: 0.72,
            radius: 4,
            weight: 2,
          })
          .addTo(overlayLayer);
      }
    }
  }

  _updateSiteLeafletMarker(entryId, location) {
    const state = this._siteLeafletMaps.get(entryId);
    if (!state) {
      return;
    }

    const liveLatLng = this._latLngFromLocation(location);
    if (!liveLatLng) {
      state.liveMarker.remove();
      return;
    }

    state.liveMarker.setLatLng(liveLatLng);
    if (!state.map.hasLayer(state.liveMarker)) {
      state.liveMarker.addTo(state.map);
    }
  }

  _zoomSiteLeaflet(entryId, delta) {
    const state = this._siteLeafletMaps.get(entryId);
    if (!state) {
      return;
    }

    if (delta > 0) {
      state.map.zoomIn(delta);
      return;
    }

    state.map.zoomOut(Math.abs(delta));
  }

  _resetSiteLeaflet(entryId) {
    const state = this._siteLeafletMaps.get(entryId);
    if (!state) {
      return;
    }

    if (state.baseBounds?.isValid?.()) {
      state.map.fitBounds(state.baseBounds.pad(0.12), {
        animate: false,
        padding: [18, 18],
      });
      return;
    }

    const entry = this._entries.find((candidate) => candidate.entry_id === entryId);
    const liveLatLng = this._latLngFromLocation(entry ? this._entryLocation(entry) : null);
    if (liveLatLng) {
      state.map.setView(liveLatLng, 20, { animate: false });
    }
  }

  _siteMapSignature(siteMap) {
    try {
      return JSON.stringify(siteMap || {});
    } catch (_err) {
      return `${siteMap?.captured_at || ""}:${siteMap?.areas?.length || 0}:${siteMap?.nogozones?.length || 0}:${siteMap?.pathways?.length || 0}:${siteMap?.charging_points?.length || 0}`;
    }
  }

  _latLngsFromLocalPoints(points, reference) {
    if (!Array.isArray(points)) {
      return [];
    }

    return points
      .map((point) => this._latLngFromLocal(point, reference))
      .filter((point) => Boolean(point));
  }

  _latLngFromLocal(point, reference) {
    if (!point || !reference) {
      return null;
    }

    const localX = Number(point.x);
    const localY = Number(point.y);
    const referenceLatitude = Number(reference.latitude);
    const referenceLongitude = Number(reference.longitude);
    if (
      !Number.isFinite(localX) ||
      !Number.isFinite(localY) ||
      !Number.isFinite(referenceLatitude) ||
      !Number.isFinite(referenceLongitude)
    ) {
      return null;
    }

    const metersPerDegreeLatitude = 111320;
    const metersPerDegreeLongitude =
      Math.cos((referenceLatitude * Math.PI) / 180) * 111320;
    if (!Number.isFinite(metersPerDegreeLongitude) || metersPerDegreeLongitude === 0) {
      return null;
    }

    return [
      referenceLatitude + localY / metersPerDegreeLatitude,
      referenceLongitude + (-localX) / metersPerDegreeLongitude,
    ];
  }

  _latLngFromLocation(location) {
    if (
      !location ||
      location.latitude === null ||
      location.latitude === undefined ||
      location.longitude === null ||
      location.longitude === undefined
    ) {
      return null;
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const fixQuality = location.fix_quality;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    if (fixQuality !== null && fixQuality !== undefined && Number(fixQuality) <= 0) {
      return null;
    }

    return [latitude, longitude];
  }

  _renderSitePlan(entryId, siteMap, location) {
    const drawing = this._buildSitePlanDrawing(siteMap, location);
    if (!drawing) {
      return `<div class="site-plan"><div class="site-plan-empty">The latest get_map response did not contain usable geometry.</div></div>`;
    }

    const viewState = this._getSitePlanView(entryId);
    const stats = [
      `${siteMap.areas?.length || 0} areas`,
      `${siteMap.nogozones?.length || 0} no-go zones`,
      `${siteMap.pathways?.length || 0} pathways`,
      `${siteMap.charging_points?.length || 0} charging points`,
    ].join(" · ");

    const locationLink = this._renderSitePlanLink(location, siteMap.reference);

    return `
      <div class="site-plan" data-site-plan-entry="${this._escape(entryId)}">
        <div class="site-plan-surface">
          <div class="site-plan-controls">
            <button class="site-plan-button" type="button" data-site-plan-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="site-plan-button" type="button" data-site-plan-action="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
            <button class="site-plan-button" type="button" data-site-plan-action="reset" title="Reset view" aria-label="Reset view">Reset</button>
          </div>
          <div class="site-plan-canvas">
            <svg
              class="site-plan-svg"
              viewBox="${this._escape(drawing.viewBox)}"
              role="img"
              aria-label="Decoded Yarbo site map"
              preserveAspectRatio="xMidYMid meet"
            >
              <g class="site-plan-viewport" transform="${this._escape(this._sitePlanTransform(viewState))}">
                <rect
                  x="${this._number(drawing.minX - drawing.padding)}"
                  y="${this._number(-(drawing.maxY + drawing.padding))}"
                  width="${this._number(drawing.width + drawing.padding * 2)}"
                  height="${this._number(drawing.height + drawing.padding * 2)}"
                  fill="rgba(15, 23, 42, 0.08)"
                  rx="${this._number(Math.max(drawing.width, drawing.height) * 0.03)}"
                  ry="${this._number(Math.max(drawing.width, drawing.height) * 0.03)}"
                />
                <g transform="scale(1,-1)">
                  ${drawing.areaShapes}
                  ${drawing.fenceShapes}
                  ${drawing.noGoShapes}
                  ${drawing.pathwayShapes}
                  ${drawing.chargingShapes}
                  <g class="site-plan-live-layer">${drawing.deviceMarker}</g>
                </g>
              </g>
            </svg>
          </div>
        </div>
        <div class="site-plan-legend">
          <div class="site-plan-stats">
            <span>${this._escape(stats)}</span>
            <span>Decoded from get_map</span>
          </div>
          <span class="site-plan-live-link">${locationLink}</span>
        </div>
      </div>
    `;
  }

  _buildSitePlanDrawing(siteMap, location) {
    const areaShapes = Array.isArray(siteMap.areas) ? siteMap.areas : [];
    const noGoShapes = Array.isArray(siteMap.nogozones) ? siteMap.nogozones : [];
    const pathwayShapes = Array.isArray(siteMap.pathways) ? siteMap.pathways : [];
    const fenceShapes = Array.isArray(siteMap.electric_fence) ? siteMap.electric_fence : [];
    const chargingPoints = Array.isArray(siteMap.charging_points) ? siteMap.charging_points : [];
    const allPoints = [
      ...areaShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...noGoShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...pathwayShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...fenceShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...chargingPoints.flatMap((item) => {
        const points = [];
        if (item.point) {
          points.push(this._displayPoint(item.point));
        }
        if (item.start_point) {
          points.push(this._displayPoint(item.start_point));
        }
        return points;
      }),
    ];

    const devicePoint = this._localPointFromLocation(location, siteMap.reference);
    if (devicePoint) {
      allPoints.push(this._displayPoint(devicePoint));
    }

    if (!allPoints.length) {
      return null;
    }

    const xValues = allPoints.map((point) => Number(point.x));
    const yValues = allPoints.map((point) => Number(point.y));
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const width = Math.max(12, maxX - minX);
    const height = Math.max(12, maxY - minY);
    const padding = Math.max(3, Math.max(width, height) * 0.08);
    const viewBox = `${this._number(minX - padding)} ${this._number(-(maxY + padding))} ${this._number(width + padding * 2)} ${this._number(height + padding * 2)}`;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      padding,
      viewBox,
      areaShapes: areaShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(45, 166, 153, 0.18)",
          stroke: "rgba(45, 166, 153, 0.72)",
          strokeWidth: 0.35,
        }))
        .join(""),
      noGoShapes: noGoShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(224, 49, 49, 0.16)",
          stroke: "rgba(224, 49, 49, 0.72)",
          strokeWidth: 0.32,
          dashArray: "0.8 0.8",
        }))
        .join(""),
      fenceShapes: fenceShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(73, 80, 87, 0.06)",
          stroke: "rgba(73, 80, 87, 0.72)",
          strokeWidth: 0.28,
        }))
        .join(""),
      pathwayShapes: pathwayShapes
        .map((shape) => this._renderPolylineShape(shape, {
          stroke: "rgba(240, 180, 41, 0.92)",
          strokeWidth: 0.42,
          dashArray: "0.9 0.7",
        }))
        .join(""),
      chargingShapes: chargingPoints
        .map((item) => this._renderChargingShape(item))
        .join(""),
      deviceMarker: devicePoint ? this._renderDeviceMarker(devicePoint, location) : "",
    };
  }

  _renderPolygonShape(shape, style) {
    const title = this._shapeTitle(shape);
    return `
      <polygon
        points="${this._escape(this._svgPoints(shape.points))}"
        fill="${this._escape(style.fill)}"
        stroke="${this._escape(style.stroke)}"
        stroke-width="${this._number(style.strokeWidth)}"
        ${style.dashArray ? `stroke-dasharray="${this._escape(style.dashArray)}"` : ""}
        vector-effect="non-scaling-stroke"
      >
        <title>${this._escape(title)}</title>
      </polygon>
    `;
  }

  _renderPolylineShape(shape, style) {
    const title = this._shapeTitle(shape);
    return `
      <polyline
        points="${this._escape(this._svgPoints(shape.points))}"
        fill="none"
        stroke="${this._escape(style.stroke)}"
        stroke-width="${this._number(style.strokeWidth)}"
        ${style.dashArray ? `stroke-dasharray="${this._escape(style.dashArray)}"` : ""}
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      >
        <title>${this._escape(title)}</title>
      </polyline>
    `;
  }

  _renderChargingShape(item) {
    const point = this._displayPoint(item.point);
    const startPoint = item.start_point ? this._displayPoint(item.start_point) : null;
    const label = item.name
      ? `Charging point ${item.name}`
      : item.id !== null && item.id !== undefined
        ? `Charging point ${item.id}`
        : "Charging point";

    return `
      ${startPoint ? `
        <circle
          cx="${this._number(startPoint.x)}"
          cy="${this._number(startPoint.y)}"
          r="0.65"
          fill="rgba(255,255,255,0.22)"
          stroke="rgba(45, 166, 153, 0.72)"
          stroke-width="0.22"
          vector-effect="non-scaling-stroke"
        >
          <title>${this._escape(`${label} start`)}</title>
        </circle>
      ` : ""}
      <circle
        cx="${this._number(point.x)}"
        cy="${this._number(point.y)}"
        r="0.95"
        fill="rgba(45, 166, 153, 0.95)"
        stroke="rgba(255,255,255,0.88)"
        stroke-width="0.28"
        vector-effect="non-scaling-stroke"
      >
        <title>${this._escape(label)}</title>
      </circle>
    `;
  }

  _renderDeviceMarker(point, location) {
    const displayPoint = this._displayPoint(point);
    const title = location?.fix_label
      ? `Live position: ${location.fix_label}`
      : "Live device position";

    return `
      <circle
        cx="${this._number(displayPoint.x)}"
        cy="${this._number(displayPoint.y)}"
        r="1.15"
        fill="rgba(255,255,255,0.96)"
        stroke="rgba(10, 132, 255, 0.96)"
        stroke-width="0.34"
        vector-effect="non-scaling-stroke"
      >
        <title>${this._escape(title)}</title>
      </circle>
      <circle
        cx="${this._number(displayPoint.x)}"
        cy="${this._number(displayPoint.y)}"
        r="2.1"
        fill="rgba(10, 132, 255, 0.12)"
        stroke="rgba(10, 132, 255, 0.38)"
        stroke-width="0.2"
        vector-effect="non-scaling-stroke"
      ></circle>
    `;
  }

  _renderSitePlanLink(location, reference) {
    const linkTarget = this._mapLinkTarget(location, reference);
    if (!linkTarget) {
      return "";
    }

    return `<a class="site-plan-link" href="${this._escape(linkTarget.url)}" target="_blank" rel="noreferrer">${this._escape(linkTarget.label)}</a>`;
  }

  _bindSitePlanInteractions(mapContainer, entryId) {
    const sitePlan = mapContainer.querySelector(`[data-site-plan-entry="${entryId}"]`);
    if (!sitePlan || sitePlan.dataset.bound === "1") {
      return;
    }

    sitePlan.dataset.bound = "1";

    sitePlan
      .querySelector('[data-site-plan-action="zoom-in"]')
      ?.addEventListener("click", () => this._zoomSitePlan(entryId, 1.25));
    sitePlan
      .querySelector('[data-site-plan-action="zoom-out"]')
      ?.addEventListener("click", () => this._zoomSitePlan(entryId, 0.8));
    sitePlan
      .querySelector('[data-site-plan-action="reset"]')
      ?.addEventListener("click", () => this._resetSitePlan(entryId));

    sitePlan
      .querySelector(".site-plan-svg")
      ?.addEventListener("pointerdown", (event) => this._startSitePlanDrag(event, entryId));
  }

  _zoomSitePlan(entryId, factor) {
    const svg = this.shadowRoot?.querySelector(
      `[data-site-plan-entry="${entryId}"] .site-plan-svg`,
    );
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const state = this._getSitePlanView(entryId);
    const oldScale = state.scale;
    const nextScale = Math.min(8, Math.max(0.7, oldScale * factor));
    if (Math.abs(nextScale - oldScale) < 0.001) {
      return;
    }

    const viewBox = svg.viewBox.baseVal;
    const viewCenterX = viewBox.x + viewBox.width / 2;
    const viewCenterY = viewBox.y + viewBox.height / 2;
    const contentCenterX = (viewCenterX - state.panX) / oldScale;
    const contentCenterY = (viewCenterY - state.panY) / oldScale;

    state.scale = nextScale;
    state.panX = viewCenterX - contentCenterX * nextScale;
    state.panY = viewCenterY - contentCenterY * nextScale;
    this._applySitePlanTransform(entryId);
  }

  _resetSitePlan(entryId) {
    this._sitePlanViews.set(entryId, {
      scale: 1,
      panX: 0,
      panY: 0,
    });
    this._applySitePlanTransform(entryId);
  }

  _startSitePlanDrag(event, entryId) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return;
    }

    event.preventDefault();
    this._clearActiveSitePlanDrag();

    const viewState = this._getSitePlanView(entryId);
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBox = event.currentTarget.viewBox.baseVal;
    const canvas = event.currentTarget.closest(".site-plan-canvas");

    this._activeSitePlanDrag = {
      entryId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: viewState.panX,
      startPanY: viewState.panY,
      unitsPerPixelX: viewBox.width / Math.max(rect.width, 1),
      unitsPerPixelY: viewBox.height / Math.max(rect.height, 1),
      svg: event.currentTarget,
      canvas,
    };

    canvas?.classList.add("is-dragging");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handleSitePlanPointerMove);
    window.addEventListener("pointerup", this._handleSitePlanPointerUp);
    window.addEventListener("pointercancel", this._handleSitePlanPointerUp);
  }

  _handleSitePlanPointerMove(event) {
    const drag = this._activeSitePlanDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const viewState = this._getSitePlanView(drag.entryId);
    viewState.panX =
      drag.startPanX + (event.clientX - drag.startClientX) * drag.unitsPerPixelX;
    viewState.panY =
      drag.startPanY + (event.clientY - drag.startClientY) * drag.unitsPerPixelY;
    this._applySitePlanTransform(drag.entryId);
  }

  _handleSitePlanPointerUp(event) {
    const drag = this._activeSitePlanDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    this._clearActiveSitePlanDrag();
  }

  _clearActiveSitePlanDrag() {
    if (this._activeSitePlanDrag?.canvas) {
      this._activeSitePlanDrag.canvas.classList.remove("is-dragging");
    }
    if (this._activeSitePlanDrag?.svg) {
      this._activeSitePlanDrag.svg.releasePointerCapture?.(this._activeSitePlanDrag.pointerId);
    }
    this._activeSitePlanDrag = null;
    window.removeEventListener("pointermove", this._handleSitePlanPointerMove);
    window.removeEventListener("pointerup", this._handleSitePlanPointerUp);
    window.removeEventListener("pointercancel", this._handleSitePlanPointerUp);
  }

  _applySitePlanTransform(entryId) {
    const viewport = this.shadowRoot?.querySelector(
      `[data-site-plan-entry="${entryId}"] .site-plan-viewport`,
    );
    if (!(viewport instanceof SVGGElement)) {
      return;
    }

    viewport.setAttribute("transform", this._sitePlanTransform(this._getSitePlanView(entryId)));
  }

  _getSitePlanView(entryId) {
    const existing = this._sitePlanViews.get(entryId);
    if (existing) {
      return existing;
    }

    const initialState = {
      scale: 1,
      panX: 0,
      panY: 0,
    };
    this._sitePlanViews.set(entryId, initialState);
    return initialState;
  }

  _sitePlanTransform(viewState) {
    return `matrix(${this._number(viewState.scale)} 0 0 ${this._number(viewState.scale)} ${this._number(viewState.panX)} ${this._number(viewState.panY)})`;
  }

  _renderMapFallback(location) {
    if (
      location.latitude === null ||
      location.latitude === undefined ||
      location.longitude === null ||
      location.longitude === undefined
    ) {
      return `<div class="map-empty">No usable GPS fix is available for this device yet.</div>`;
    }

    const latitude = Number(location.latitude).toFixed(6);
    const longitude = Number(location.longitude).toFixed(6);
    const mapUrl = this._buildMapUrl(latitude, longitude);

    return `
      <div class="map-fallback">
        <strong>${this._escape(`${latitude}, ${longitude}`)}</strong>
        <div>${this._escape(location.fix_label || "GPS fix available")}</div>
        <a href="${mapUrl}" target="_blank" rel="noreferrer">Open in map</a>
      </div>
    `;
  }

  _mapLinkTarget(location, reference) {
    if (
      location &&
      location.latitude !== null &&
      location.latitude !== undefined &&
      location.longitude !== null &&
      location.longitude !== undefined
    ) {
      const latitude = Number(location.latitude).toFixed(6);
      const longitude = Number(location.longitude).toFixed(6);
      return {
        label: "Open live location in map",
        url: this._buildMapUrl(latitude, longitude),
      };
    }

    if (
      reference &&
      reference.latitude !== null &&
      reference.latitude !== undefined &&
      reference.longitude !== null &&
      reference.longitude !== undefined
    ) {
      const latitude = Number(reference.latitude).toFixed(6);
      const longitude = Number(reference.longitude).toFixed(6);
      return {
        label: "Open map reference in map",
        url: this._buildMapUrl(latitude, longitude),
      };
    }

    return null;
  }

  _entryLocation(entry) {
    const summary = entry.summary || {};
    const baseLocation = {
      ...(summary.location || {}),
      ...(entry.location || {}),
    };

    const trackerState = entry.tracker_entity_id
      ? this._hass?.states?.[entry.tracker_entity_id]
      : null;
    if (trackerState) {
      const trackerAttrs = trackerState.attributes || {};
      if (trackerAttrs.latitude !== undefined) {
        baseLocation.latitude = trackerAttrs.latitude;
      }
      if (trackerAttrs.longitude !== undefined) {
        baseLocation.longitude = trackerAttrs.longitude;
      }
      if (trackerAttrs.fix_quality !== undefined) {
        baseLocation.fix_quality = trackerAttrs.fix_quality;
      }
      if (trackerAttrs.fix_label !== undefined) {
        baseLocation.fix_label = trackerAttrs.fix_label;
      }
      if (trackerAttrs.satellites !== undefined) {
        baseLocation.satellites = trackerAttrs.satellites;
      }
      if (trackerAttrs.hdop !== undefined) {
        baseLocation.hdop = trackerAttrs.hdop;
      }
      if (trackerAttrs.altitude !== undefined) {
        baseLocation.altitude = trackerAttrs.altitude;
      }
    }

    const statusState = entry.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    if (statusState) {
      const statusAttrs = statusState.attributes || {};
      if (statusAttrs.latitude !== undefined) {
        baseLocation.latitude = statusAttrs.latitude;
      }
      if (statusAttrs.longitude !== undefined) {
        baseLocation.longitude = statusAttrs.longitude;
      }
    }

    return baseLocation;
  }

  _entryHeading(entry) {
    if (entry.summary?.heading !== null && entry.summary?.heading !== undefined) {
      return entry.summary.heading;
    }

    const statusState = entry.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    if (statusState?.attributes?.heading !== undefined) {
      return statusState.attributes.heading;
    }

    const trackerState = entry.tracker_entity_id
      ? this._hass?.states?.[entry.tracker_entity_id]
      : null;
    if (trackerState?.attributes?.heading !== undefined) {
      return trackerState.attributes.heading;
    }

    return null;
  }

  _buildMapUrl(latitude, longitude) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=19/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
  }

  _localPointFromLocation(location, reference) {
    if (
      !reference ||
      location?.latitude === null ||
      location?.latitude === undefined ||
      location?.longitude === null ||
      location?.longitude === undefined
    ) {
      return null;
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const referenceLatitude = Number(reference.latitude);
    const referenceLongitude = Number(reference.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(referenceLatitude) ||
      !Number.isFinite(referenceLongitude)
    ) {
      return null;
    }

    const metersPerDegreeLatitude = 111320;
    const metersPerDegreeLongitude =
      Math.cos((referenceLatitude * Math.PI) / 180) * 111320;

    return {
      x: (longitude - referenceLongitude) * metersPerDegreeLongitude,
      y: (latitude - referenceLatitude) * metersPerDegreeLatitude,
    };
  }

  _displayPoints(points) {
    return Array.isArray(points) ? points.map((point) => this._displayPoint(point)) : [];
  }

  _displayPoint(point) {
    if (!point) {
      return { x: 0, y: 0 };
    }

    return {
      x: -Number(point.x),
      y: Number(point.y),
    };
  }

  _svgPoints(points) {
    return this._displayPoints(points)
      .map((point) => `${this._number(point.x)},${this._number(point.y)}`)
      .join(" ");
  }

  _shapeTitle(shape) {
    if (shape.name) {
      return shape.id !== null && shape.id !== undefined
        ? `${shape.name} (${shape.id})`
        : shape.name;
    }

    return shape.id !== null && shape.id !== undefined
      ? `Shape ${shape.id}`
      : "Map shape";
  }

  _number(value) {
    return Number(value).toFixed(3);
  }

  _valueOrDash(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }

    return String(value);
  }

  _batteryElectrical(voltageMilli, currentMilli) {
    if (
      (voltageMilli === null || voltageMilli === undefined) &&
      (currentMilli === null || currentMilli === undefined)
    ) {
      return "—";
    }

    const parts = [];
    if (voltageMilli !== null && voltageMilli !== undefined) {
      parts.push(`${(Number(voltageMilli) / 1000).toFixed(1)} V`);
    }
    if (currentMilli !== null && currentMilli !== undefined) {
      parts.push(`${(Number(currentMilli) / 1000).toFixed(1)} A`);
    }
    return parts.join(" / ");
  }

  _percent(value) {
    return value === null || value === undefined ? "—" : `${value}%`;
  }

  _degrees(value) {
    return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}°`;
  }

  _flag(value) {
    if (value === null || value === undefined) {
      return "—";
    }

    return Number(value) === 0 ? "No" : "Yes";
  }

  _pitchRoll(pitch, roll) {
    if (pitch === null || pitch === undefined || roll === null || roll === undefined) {
      return "—";
    }

    return `${Number(pitch).toFixed(1)}° / ${Number(roll).toFixed(1)}°`;
  }

  _temperature(value) {
    return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}°C`;
  }

  _pressedState(value) {
    if (value === null || value === undefined) {
      return "—";
    }

    return Number(value) === 0 ? "Released" : "Pressed";
  }

  _network(mqttStatus, ntripStatus, dnsStatus) {
    if (
      mqttStatus === null || mqttStatus === undefined ||
      ntripStatus === null || ntripStatus === undefined ||
      dnsStatus === null || dnsStatus === undefined
    ) {
      return "—";
    }

    return [
      `MQTT ${this._onOffLabel(mqttStatus)}`,
      `NTRIP ${this._onOffLabel(ntripStatus)}`,
      `DNS ${this._onOffLabel(dnsStatus)}`,
    ].join(" · ");
  }

  _firmware(bodyVersion, headVersion) {
    if (
      (bodyVersion === null || bodyVersion === undefined || bodyVersion === "") &&
      (headVersion === null || headVersion === undefined || headVersion === "")
    ) {
      return "—";
    }

    const parts = [];
    if (bodyVersion) {
      parts.push(`Body ${bodyVersion}`);
    }
    if (headVersion) {
      parts.push(`Head ${headVersion}`);
    }
    return parts.join(" · ");
  }

  _onOffLabel(value) {
    return Number(value) === 0 ? "Off" : "On";
  }

  _normalizedBatteryLevel(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.min(100, Math.max(0, parsed));
  }

  _batteryBars(level) {
    if (level === null) {
      return 0;
    }

    if (level <= 0) {
      return 0;
    }

    return Math.min(10, Math.max(1, Math.ceil(level / 10)));
  }

  _batteryTone(level) {
    if (level === null || level <= 0) {
      return "unknown";
    }
    if (level > 70) {
      return "green";
    }
    if (level > 40) {
      return "yellow";
    }
    if (level > 30) {
      return "orange";
    }
    return "red";
  }

  _isCharging(value) {
    if (value === null || value === undefined) {
      return false;
    }

    return Number(value) !== 0;
  }

  _batteryAriaLabel(level, charging) {
    if (level === null) {
      return charging ? "Battery level unavailable, charging" : "Battery level unavailable";
    }

    const rounded = Math.round(level);
    if (charging) {
      return `Battery ${rounded} percent, charging`;
    }

    return `Battery ${rounded} percent`;
  }

  _satelliteCount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.max(0, Math.round(parsed));
  }

  _position(x, y) {
    if (x === null || x === undefined || y === null || y === undefined) {
      return "—";
    }

    return `${Number(x).toFixed(1)}, ${Number(y).toFixed(1)}`;
  }

  _coords(latitude, longitude) {
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return "No fix";
    }

    return `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
  }

  _gpsQuality(location) {
    const parts = [];

    if (location.fix_label) {
      parts.push(String(location.fix_label));
    }
    if (location.satellites !== null && location.satellites !== undefined) {
      parts.push(`${location.satellites} sats`);
    }
    if (location.hdop !== null && location.hdop !== undefined) {
      parts.push(`HDOP ${Number(location.hdop).toFixed(1)}`);
    }

    return parts.length ? parts.join(" · ") : "—";
  }

  _maybeShowNotificationToast(section, entry, notification) {
    const entryId = entry.entry_id;
    const key = this._notificationToastKey(entry, notification);
    if (!entryId) {
      return;
    }
    if (!key) {
      if (!this._notificationToastKeys.has(entryId)) {
        this._notificationToastKeys.set(entryId, "__none__");
      }
      return;
    }

    const previousKey = this._notificationToastKeys.get(entryId);
    this._notificationToastKeys.set(entryId, key);
    if (!previousKey || previousKey === key) {
      return;
    }

    const toast = section.querySelector(".notification-toast");
    const titleElement = section.querySelector(".notification-toast-title");
    const messageElement = section.querySelector(".notification-toast-message");
    const iconElement = section.querySelector(".notification-toast-icon");
    if (!toast || !titleElement || !messageElement) {
      return;
    }

    const title = typeof notification?.title === "string" && notification.title.trim()
      ? notification.title.trim()
      : "Yarbo notification";
    const message = typeof notification?.message === "string" && notification.message.trim()
      ? notification.message.trim()
      : "Yarbo reported a new notification.";
    const level = typeof notification?.level === "string" && notification.level
      ? notification.level
      : "info";

    titleElement.textContent = title;
    messageElement.textContent = message;
    toast.classList.remove("info", "success", "warning", "error");
    toast.classList.add(["success", "warning", "error"].includes(level) ? level : "info");
    toast.hidden = false;

    if (iconElement) {
      iconElement.setAttribute("icon", this._notificationToastIcon(level));
    }

    const existingTimer = this._notificationToastTimers.get(entryId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this._notificationToastTimers.set(
      entryId,
      window.setTimeout(() => {
        this._hideNotificationToast(entryId, section);
      }, 8000),
    );
  }

  _notificationToastKey(entry, notification) {
    if (!notification || typeof notification !== "object") {
      return null;
    }

    const count = entry.notification_count ?? "";
    const id = typeof notification.id === "string" ? notification.id : "";
    const receivedAt =
      typeof notification.received_at === "string" ? notification.received_at : "";
    const title = typeof notification.title === "string" ? notification.title : "";
    const message = typeof notification.message === "string" ? notification.message : "";
    return [count, id, receivedAt, title, message].join("|");
  }

  _notificationToastIcon(level) {
    if (level === "error") {
      return "mdi:alert-circle-outline";
    }
    if (level === "warning") {
      return "mdi:alert-outline";
    }
    if (level === "success") {
      return "mdi:check-circle-outline";
    }
    return "mdi:bell-outline";
  }

  _hideNotificationToast(entryId, section) {
    const timer = this._notificationToastTimers.get(entryId);
    if (timer) {
      clearTimeout(timer);
      this._notificationToastTimers.delete(entryId);
    }

    const toast = section.querySelector(".notification-toast");
    if (toast) {
      toast.hidden = true;
    }
  }

  _notificationSummary(notification) {
    if (!notification || typeof notification !== "object") {
      return null;
    }

    const title = typeof notification.title === "string" ? notification.title.trim() : "";
    const message = typeof notification.message === "string" ? notification.message.trim() : "";
    const combined = [title, message].filter(Boolean).join(": ");
    if (!combined) {
      return null;
    }

    return combined.length > 120 ? `${combined.slice(0, 117)}...` : combined;
  }

  _dateTime(value) {
    if (!value) {
      return "—";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleString();
  }

  _titleCase(value) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
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

if (!customElements.get("s2jyarbo-overview-card")) {
  customElements.define("s2jyarbo-overview-card", YarboOverviewCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "s2jyarbo-overview-card")) {
  window.customCards.push({
    type: "s2jyarbo-overview-card",
    name: "S2JYarbo Overview",
    description: "Overview widget for one configured S2JYarbo device, including live map position.",
    preview: false,
  });
}
