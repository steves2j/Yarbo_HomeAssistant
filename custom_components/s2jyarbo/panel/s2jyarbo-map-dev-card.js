const FIXED_GPS_CALIBRATION = {
  longitudinal: 0.12733925057566753,
  lateral: 0.2076810316749709,
};

class S2JYarboMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._entry = null;
    this._embedded = false;
    this._loading = true;
    this._loadingEntry = false;
    this._reloadAfterLoad = false;
    this._error = "";
    this._initialized = false;
    this._structureReady = false;
    this._refreshHandle = null;
    this._reloadHandle = null;
    this._lastLoadTimestamp = 0;
    this._lastEntitySignature = "";
    this._mapRequestPending = false;
    this._mapRequestTimestamp = 0;
    this._followMode = true;
    this._trailVisible = true;
    this._planFeedbackVisible = true;
    this._cloudPointsVisible = true;
    this._viewState = {
      scale: 1,
      panX: 0,
      panY: 0,
    };
    this._lastDrawing = null;
    this._breadcrumbs = [];
    this._referenceSignature = "";
    this._gpsCalibration = { ...FIXED_GPS_CALIBRATION };
    this._activeDrag = null;
    this._handlePointerMove = this._handlePointerMove.bind(this);
    this._handlePointerUp = this._handlePointerUp.bind(this);
    this._handleWheel = this._handleWheel.bind(this);
  }

  setConfig(config) {
    this._config = config || {};
    this._embedded = Boolean(this._config?.embedded);
    this._structureReady = false;
    this._render();
  }

  set embedded(value) {
    const nextValue = Boolean(value);
    if (this._embedded === nextValue) {
      return;
    }

    this._embedded = nextValue;
    if (nextValue && this._refreshHandle) {
      clearInterval(this._refreshHandle);
      this._refreshHandle = null;
    }
    this._structureReady = false;
    this._render();
  }

  set entryData(entry) {
    if (!this._embedded) {
      return;
    }

    this._ingestEmbeddedEntry(entry);
  }

  set hass(hass) {
    this._hass = hass;

    if (this._embedded) {
      this._initialized = true;
      this._ingestEmbeddedEntry(this._entry);
      return;
    }

    if (!this._initialized) {
      this._initialized = true;
      void this._startRefreshing();
      return;
    }

    if (!this._liveUpdatesEnabled()) {
      return;
    }

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
    this._clearActiveDrag();
  }

  _ingestEmbeddedEntry(entry) {
    this._entry = entry || null;
    this._loading = false;
    this._error = "";

    if (!this._entry) {
      this._lastEntitySignature = "";
      this._render();
      return;
    }

    this._syncReferenceState();
    const signature = this._buildEntitySignature();
    const shouldRecordBreadcrumb = !signature || signature !== this._lastEntitySignature;

    if (shouldRecordBreadcrumb) {
      this._recordBreadcrumb();
    }
    if (signature) {
      this._lastEntitySignature = signature;
    }
    if (this._hass) {
      this._maybeRequestMapData(this._entry);
    }
    this._render();
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return {
      columns: "full",
      min_columns: 12,
      max_columns: 12,
      min_rows: 8,
    };
  }

  static getStubConfig(...args) {
    for (const arg of args) {
      const selector = S2JYarboMapCard._extractStubConfigFromArg(arg);
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

  static _extractStubConfigFromArg(arg) {
    if (!arg) {
      return null;
    }

    if (Array.isArray(arg)) {
      for (const item of arg) {
        const config = S2JYarboMapCard._extractStubConfigFromArg(item);
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

  async _startRefreshing() {
    await this._loadEntry();
    if (!this._liveUpdatesEnabled()) {
      return;
    }

    this._refreshHandle = window.setInterval(() => {
      void this._loadEntry();
    }, 60000);
  }

  async _loadEntry() {
    if (!this._hass) {
      return;
    }

    if (this._loadingEntry) {
      this._reloadAfterLoad = true;
      return;
    }

    this._loadingEntry = true;

    try {
      const entries = await this._hass.callApi("GET", this._dashboardApiPath());
      const hasSelector =
        Boolean(this._config?.entry_id) ||
        Boolean(this._config?.entity_id) ||
        Boolean(this._config?.device_id);

      if (!hasSelector && entries.length > 1) {
        this._entry = null;
        this._error =
          "This card shows one device per card. Add it from the device page or configure entry_id, entity_id, or device_id.";
        return;
      }

      if (hasSelector && entries.length === 0) {
        this._entry = null;
        this._error =
          "No S2JYarbo device matched this card configuration. Re-add the card from the device page or update its selector.";
        return;
      }

      this._entry = entries[0] || null;
      this._error = "";
      this._lastLoadTimestamp = Date.now();
      this._syncReferenceState();
      this._recordBreadcrumb();
      this._lastEntitySignature = this._buildEntitySignature();

      if (this._entry) {
        this._maybeRequestMapData(this._entry);
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loadingEntry = false;
      this._loading = false;
      this._render();
      if (this._reloadAfterLoad) {
        this._reloadAfterLoad = false;
        this._scheduleReload(250);
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

  _liveUpdatesEnabled() {
    return this._embedded || this._config?.live_updates !== false;
  }

  _handleHassUpdate() {
    if (!this._entry || !this._hass) {
      return;
    }

    const signature = this._buildEntitySignature();
    if (!signature || signature === this._lastEntitySignature) {
      return;
    }

    this._lastEntitySignature = signature;
    this._recordBreadcrumb();
    this._maybeRequestMapData(this._entry);
    if (Date.now() - this._lastLoadTimestamp >= 5000) {
      this._scheduleReload(0);
    }
    this._render();
  }

  _scheduleReload(delay = 400) {
    if (this._reloadHandle) {
      return;
    }

    this._reloadHandle = window.setTimeout(() => {
      this._reloadHandle = null;
      void this._loadEntry();
    }, delay);
  }

  _buildEntitySignature() {
    if (!this._entry || !this._hass) {
      return "";
    }

    const parts = [this._entry.entry_id];
    const statusState = this._entry.status_entity_id
      ? this._hass.states[this._entry.status_entity_id]
      : null;
    if (statusState) {
      parts.push(
        statusState.state,
        statusState.attributes.updated_at || "",
        statusState.attributes.last_received || "",
        statusState.attributes.latitude ?? "",
        statusState.attributes.longitude ?? "",
        statusState.attributes.heading ?? "",
        statusState.attributes.left_wheel_speed ?? "",
        statusState.attributes.right_wheel_speed ?? "",
        statusState.attributes.left_blade_motor_speed ?? "",
        statusState.attributes.right_blade_motor_speed ?? "",
        statusState.attributes.left_blade_motor_rpm ?? "",
        statusState.attributes.right_blade_motor_rpm ?? "",
      );
    }

    const trackerState = this._entry.tracker_entity_id
      ? this._hass.states[this._entry.tracker_entity_id]
      : null;
    if (trackerState) {
      parts.push(
        trackerState.state,
        trackerState.attributes.updated_at || "",
        trackerState.attributes.latitude ?? "",
        trackerState.attributes.longitude ?? "",
        trackerState.attributes.fix_quality ?? "",
      );
    }

    return parts.join("~");
  }

  _maybeRequestMapData(entry) {
    if (
      !this._hass ||
      entry.site_map ||
      entry.connection_state !== "connected" ||
      this._mapRequestPending
    ) {
      return;
    }

    if (Date.now() - this._mapRequestTimestamp < 30000) {
      return;
    }

    this._mapRequestPending = true;
    this._mapRequestTimestamp = Date.now();
    void this._requestMapData(entry.entry_id);
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
      this._mapRequestPending = false;
      return;
    }

    window.setTimeout(() => {
      this._mapRequestPending = false;
      this._scheduleReload(200);
    }, 2500);
  }

  _syncReferenceState() {
    const reference = this._entry?.site_map?.reference || null;
    const nextSignature = this._referenceSignatureFor(reference);
    if (nextSignature === this._referenceSignature) {
      return;
    }

    this._referenceSignature = nextSignature;
    this._breadcrumbs = [];
    this._gpsCalibration = { ...FIXED_GPS_CALIBRATION };
    const persistedScale = this._loadPersistedZoomScale();
    this._viewState = {
      scale: persistedScale ?? 1,
      panX: 0,
      panY: 0,
    };
  }

  _referenceSignatureFor(reference) {
    if (!reference) {
      return "";
    }

    return `${reference.latitude ?? ""}:${reference.longitude ?? ""}`;
  }

  _recordBreadcrumb() {
    if (!this._entry?.site_map?.reference) {
      return;
    }

    const location = this._entryLocation(this._entry);
    const rawLocalPoint = this._localPointFromLocation(
      location,
      this._entry.site_map.reference,
    );
    const localPoint = this._correctedLocalPoint(this._entry, location, rawLocalPoint);
    if (!localPoint) {
      return;
    }

    const lastPoint = this._breadcrumbs.at(-1);
    if (lastPoint) {
      const deltaX = Number(localPoint.x) - Number(lastPoint.x);
      const deltaY = Number(localPoint.y) - Number(lastPoint.y);
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 0.08) {
        return;
      }
    }

    this._breadcrumbs.push({
      x: Number(localPoint.x),
      y: Number(localPoint.y),
      at: Date.now(),
      reverse: this._entryIsReverse(this._entry),
      cutting: this._entryMowerHeadActive(this._entry),
    });

    if (this._breadcrumbs.length > 3000) {
      this._breadcrumbs.splice(0, this._breadcrumbs.length - 3000);
    }
  }

  _ensureStructure() {
    if (this._structureReady || !this.shadowRoot) {
      return;
    }

    const styles = `
        :host {
          display: block;
        }
        ha-card {
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--primary-color) 14%, transparent), transparent 38%),
            linear-gradient(180deg, color-mix(in srgb, var(--card-background-color) 95%, var(--primary-background-color)), var(--card-background-color));
          border-radius: 22px;
          overflow: hidden;
        }
        .shell {
          display: grid;
          gap: 16px;
          padding: 20px;
        }
        .header {
          align-items: start;
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }
        .title-block {
          min-width: 0;
        }
        .title {
          font-size: 24px;
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
          font-size: 12px;
          white-space: nowrap;
        }
        .error {
          background: color-mix(in srgb, var(--error-color) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color) 35%, transparent);
          border-radius: 14px;
          color: var(--error-color);
          padding: 12px 14px;
        }
        .error[hidden] {
          display: none;
        }
        .body {
          display: block;
        }
        .meta {
          color: var(--secondary-text-color);
          display: flex;
          flex-wrap: wrap;
          font-size: 13px;
          gap: 8px 14px;
        }
        .map-card {
          background:
            radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--primary-color) 10%, transparent), transparent 45%),
            color-mix(in srgb, var(--card-background-color) 72%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 70%, transparent);
          border-radius: 18px;
          overflow: hidden;
          padding: 12px;
        }
        .map-surface {
          min-height: 0;
        }
        .map-canvas {
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.05), rgba(15, 23, 42, 0.01)),
            linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px),
            linear-gradient(0deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
          background-size:
            auto,
            32px 32px,
            32px 32px;
          border-radius: 14px;
          cursor: grab;
          min-height: 360px;
          overflow: hidden;
          position: relative;
          touch-action: none;
          user-select: none;
        }
        .map-canvas.is-dragging {
          cursor: grabbing;
        }
        .map-svg {
          display: block;
          height: 100%;
          min-height: 360px;
          width: 100%;
        }
        .map-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          inset: 8px 8px auto auto;
          justify-content: end;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .map-button {
          align-items: center;
          appearance: none;
          background: color-mix(in srgb, var(--card-background-color) 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 80%, transparent);
          border-radius: 999px;
          color: var(--primary-text-color);
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          gap: 6px;
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
        .map-button:hover {
          background: color-mix(in srgb, var(--primary-color) 16%, var(--card-background-color));
          border-color: color-mix(in srgb, var(--primary-color) 28%, transparent);
          transform: translateY(-1px);
        }
        .map-button.is-active {
          background: color-mix(in srgb, var(--primary-color) 16%, transparent);
          border-color: color-mix(in srgb, var(--primary-color) 30%, transparent);
          color: var(--primary-color);
        }
        .map-empty {
          align-items: center;
          color: var(--secondary-text-color);
          display: flex;
          justify-content: center;
          min-height: 260px;
          padding: 24px;
          text-align: center;
        }
        .map-overlay {
          align-items: end;
          bottom: 8px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px 10px;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .map-overlay-left {
          color: var(--primary-text-color);
          left: 8px;
        }
        .map-overlay-right {
          align-items: flex-end;
          flex-direction: column;
          gap: 8px;
          justify-content: end;
          max-width: min(60%, 320px);
          right: 8px;
          text-align: right;
        }
        .map-reading {
          background: color-mix(in srgb, var(--card-background-color) 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 999px;
          color: inherit;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          padding: 7px 10px;
          white-space: nowrap;
        }
        .map-warning {
          color: #f0b429;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
        }
        .map-stats-pill {
          background: color-mix(in srgb, var(--card-background-color) 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 16px;
          color: var(--primary-text-color);
          display: grid;
          gap: 4px;
          min-width: 180px;
          padding: 10px 12px;
          text-align: left;
        }
        .map-stats-row {
          align-items: baseline;
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }
        .map-stats-label {
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .map-stats-value {
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
    `;

    if (this._embedded) {
      this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="body"></div>
    `;
      this._structureReady = true;
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div class="title-block">
              <h1 class="title">S2JYarbo Map</h1>
              <p class="subtitle">Decoded local map from get_map with live position, follow mode, and breadcrumb trail.</p>
            </div>
            <div class="status"></div>
          </div>
          <div class="error" hidden></div>
          <div class="body"></div>
        </div>
      </ha-card>
    `;
    this._structureReady = true;
  }

  _render() {
    this._ensureStructure();
    if (!this._structureReady) {
      return;
    }

    const status = this.shadowRoot.querySelector(".status");
    if (status) {
      status.textContent = this._loading ? "Loading..." : "Live local map";
    }

    const error = this.shadowRoot.querySelector(".error");
    if (error) {
      error.hidden = !this._error;
      error.textContent = this._error || "";
    }

    const body = this.shadowRoot.querySelector(".body");
    if (!(body instanceof HTMLElement)) {
      return;
    }

    if (!this._entry) {
      body.innerHTML = '<div class="map-empty">No S2JYarbo device is available for this card yet.</div>';
      return;
    }

    const location = this._entryLocation(this._entry);
    const heading = this._entryHeading(this._entry);
    const content = this._renderMapContent(this._entry, location, heading);
    body.innerHTML = content;
    this._bindControls();
  }

  _renderMapContent(entry, location, heading) {
    const siteMap = entry.site_map;
    const meta = this._embedded
      ? ""
      : `
      <div class="meta">
        <span>${this._escape(entry.title || "Yarbo")}</span>
        <span>Serial ${this._escape(entry.serial_number || "Unknown")}</span>
        <span>${this._escape(this._titleCase((entry.connection_state || "unknown").replaceAll("_", " ")))}</span>
      </div>
    `;

    if (!siteMap) {
      const mapState = this._mapRequestPending
        ? "Requesting get_map from device..."
        : entry.connection_state === "connected"
          ? "No decoded get_map payload has been captured yet."
          : "Connect the device to request map data.";
      return `
        ${meta}
        <div class="map-card">
          <div class="map-empty">${this._escape(mapState)}</div>
        </div>
      `;
    }

    const drawing = this._buildMapDrawing(entry, location, heading);
    if (!drawing) {
      return `
        ${meta}
        <div class="map-card">
          <div class="map-empty">The latest get_map response did not contain usable geometry.</div>
        </div>
      `;
    }

    this._lastDrawing = drawing;
    if (this._followMode && drawing.deviceMarkerPoint) {
      this._centerOnPoint(drawing, drawing.deviceMarkerPoint);
    }

    return `
      ${meta}
      <div class="map-card">
          <div class="map-surface">
          <div class="map-canvas">
            <div class="map-controls">
              <button class="map-button ${this._followMode ? "is-active" : ""}" type="button" data-action="follow">${this._followMode ? "Following" : "Follow"}</button>
              <button class="map-button ${this._trailVisible ? "is-active" : ""}" type="button" data-action="trail">${this._trailVisible ? "Trail On" : "Trail Off"}</button>
              <button class="map-button ${this._planFeedbackVisible ? "is-active" : ""}" type="button" data-action="plan-feedback">${this._planFeedbackVisible ? "Plan On" : "Plan Off"}</button>
              <button class="map-button ${this._cloudPointsVisible ? "is-active" : ""}" type="button" data-action="cloud-points">${this._cloudPointsVisible ? "Barrier On" : "Barrier Off"}</button>
              <button class="map-button" type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
              <button class="map-button" type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
              <button class="map-button" type="button" data-action="reset">Reset</button>
            </div>
            <svg
              class="map-svg"
              viewBox="${this._escape(drawing.viewBox)}"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Decoded S2JYarbo map"
            >
              <g class="map-viewport" transform="${this._escape(this._mapTransform())}">
                <rect
                  x="${this._number(drawing.viewBoxX)}"
                  y="${this._number(drawing.viewBoxY)}"
                  width="${this._number(drawing.viewBoxWidth)}"
                  height="${this._number(drawing.viewBoxHeight)}"
                  fill="rgba(15, 23, 42, 0.04)"
                  rx="${this._number(Math.max(drawing.width, drawing.height) * 0.03)}"
                  ry="${this._number(Math.max(drawing.width, drawing.height) * 0.03)}"
                />
                <g transform="scale(1,-1)">
                  ${drawing.areaShapes}
                  ${drawing.fenceShapes}
                  ${drawing.noGoShapes}
                  ${this._planFeedbackVisible ? drawing.planFeedbackShapes : ""}
                  ${this._cloudPointsVisible ? drawing.cloudPointsShapes : ""}
                  ${drawing.rechargePathShape}
                  ${drawing.pathwayShapes}
                  ${drawing.chargingShapes}
                  ${this._trailVisible ? drawing.breadcrumbTrail : ""}
                  ${drawing.deviceMarker}
                </g>
              </g>
            </svg>
            <div class="map-overlay map-overlay-left">
              <span class="map-reading">${this._escape(this._coords(location.latitude, location.longitude))}</span>
              <span class="map-reading">${this._escape(this._headingText(heading))}</span>
            </div>
            <div class="map-overlay map-overlay-right">
              ${this._renderPlanFeedbackSummary(entry)}
              ${this._renderCalibrationWarning(entry)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _bindControls() {
    const body = this.shadowRoot?.querySelector(".body");
    if (!(body instanceof HTMLElement)) {
      return;
    }

    body.querySelector('[data-action="follow"]')?.addEventListener("click", () => {
      this._followMode = !this._followMode;
      if (this._followMode && this._lastDrawing?.deviceMarkerPoint) {
        this._centerOnPoint(this._lastDrawing, this._lastDrawing.deviceMarkerPoint);
      }
      this._render();
    });

    body.querySelector('[data-action="trail"]')?.addEventListener("click", () => {
      this._trailVisible = !this._trailVisible;
      this._render();
    });

    body.querySelector('[data-action="plan-feedback"]')?.addEventListener("click", () => {
      this._planFeedbackVisible = !this._planFeedbackVisible;
      this._render();
    });

    body.querySelector('[data-action="cloud-points"]')?.addEventListener("click", () => {
      this._cloudPointsVisible = !this._cloudPointsVisible;
      this._render();
    });

    body.querySelector('[data-action="zoom-in"]')?.addEventListener("click", () => {
      this._zoom(1.25);
    });

    body.querySelector('[data-action="zoom-out"]')?.addEventListener("click", () => {
      this._zoom(0.8);
    });

    body.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
      this._viewState = {
        scale: 1,
        panX: 0,
        panY: 0,
      };
      this._persistZoomScale();
      if (this._followMode && this._lastDrawing?.deviceMarkerPoint) {
        this._centerOnPoint(this._lastDrawing, this._lastDrawing.deviceMarkerPoint);
      }
      this._render();
    });

    const mapCanvas = body.querySelector(".map-canvas");
    if (mapCanvas instanceof HTMLElement) {
      this._updateCanvasInsets(mapCanvas);
      requestAnimationFrame(() => this._updateCanvasInsets(mapCanvas));
    }
    mapCanvas?.addEventListener("wheel", this._handleWheel, { passive: false });

    const svg = body.querySelector(".map-svg");
    svg?.addEventListener("pointerdown", (event) => this._startDrag(event));
  }

  _zoom(factor, anchor = null) {
    const svg = this.shadowRoot?.querySelector(".map-svg");
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const oldScale = this._viewState.scale;
    const nextScale = Math.min(24.5, Math.max(0.7, oldScale * factor));
    if (Math.abs(nextScale - oldScale) < 0.001) {
      return;
    }

    const viewBox = svg.viewBox.baseVal;
    const viewCenterX = viewBox.x + viewBox.width / 2;
    const viewCenterY = viewBox.y + viewBox.height / 2;
    const focusX = anchor?.x ?? viewCenterX;
    const focusY = anchor?.y ?? viewCenterY;

    if (this._followMode && this._lastDrawing?.deviceMarkerPoint) {
      this._viewState.scale = nextScale;
      this._centerOnPoint(this._lastDrawing, this._lastDrawing.deviceMarkerPoint);
      this._persistZoomScale();
      this._render();
      return;
    }

    const contentFocusX = (focusX - this._viewState.panX) / oldScale;
    const contentFocusY = (focusY - this._viewState.panY) / oldScale;

    this._viewState.scale = nextScale;
    this._viewState.panX = focusX - contentFocusX * nextScale;
    this._viewState.panY = focusY - contentFocusY * nextScale;
    this._persistZoomScale();
    this._render();
  }

  _handleWheel(event) {
    const svg = this.shadowRoot?.querySelector(".map-svg");
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    event.preventDefault();

    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.0015)));
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const pointerX = viewBox.x + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * viewBox.width;
    const pointerY = viewBox.y + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * viewBox.height;
    this._zoom(factor, { x: pointerX, y: pointerY });
  }

  _startDrag(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return;
    }

    event.preventDefault();
    this._clearActiveDrag();
    this._followMode = false;

    const rect = event.currentTarget.getBoundingClientRect();
    const viewBox = event.currentTarget.viewBox.baseVal;

    this._activeDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: this._viewState.panX,
      startPanY: this._viewState.panY,
      unitsPerPixelX: viewBox.width / Math.max(rect.width, 1),
      unitsPerPixelY: viewBox.height / Math.max(rect.height, 1),
      svg: event.currentTarget,
    };

    const canvas = this.shadowRoot?.querySelector(".map-canvas");
    canvas?.classList.add("is-dragging");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
  }

  _handlePointerMove(event) {
    const drag = this._activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    this._viewState.panX =
      drag.startPanX + (event.clientX - drag.startClientX) * drag.unitsPerPixelX;
    this._viewState.panY =
      drag.startPanY + (event.clientY - drag.startClientY) * drag.unitsPerPixelY;
    this._applyTransformOnly();
  }

  _handlePointerUp(event) {
    const drag = this._activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    this._clearActiveDrag();
    this._render();
  }

  _clearActiveDrag() {
    const canvas = this.shadowRoot?.querySelector(".map-canvas");
    canvas?.classList.remove("is-dragging");

    if (this._activeDrag?.svg) {
      this._activeDrag.svg.releasePointerCapture?.(this._activeDrag.pointerId);
    }

    this._activeDrag = null;
    window.removeEventListener("pointermove", this._handlePointerMove);
    window.removeEventListener("pointerup", this._handlePointerUp);
    window.removeEventListener("pointercancel", this._handlePointerUp);
  }

  _applyTransformOnly() {
    const viewport = this.shadowRoot?.querySelector(".map-viewport");
    if (!(viewport instanceof SVGGElement)) {
      return;
    }

    viewport.setAttribute("transform", this._mapTransform());
  }

  _mapTransform() {
    return `matrix(${this._number(this._viewState.scale)} 0 0 ${this._number(this._viewState.scale)} ${this._number(this._viewState.panX)} ${this._number(this._viewState.panY)})`;
  }

  _centerOnPoint(drawing, point) {
    const centerX = drawing.viewBoxX + drawing.viewBoxWidth / 2;
    const centerY = drawing.viewBoxY + drawing.viewBoxHeight / 2;
    this._viewState.panX = centerX - point.x * this._viewState.scale;
    this._viewState.panY = centerY - (-point.y) * this._viewState.scale;
  }

  _buildMapDrawing(entry, location, heading) {
    const siteMap = entry.site_map;
    const areaShapes = Array.isArray(siteMap.areas) ? siteMap.areas : [];
    const noGoShapes = Array.isArray(siteMap.nogozones) ? siteMap.nogozones : [];
    const pathwayShapes = Array.isArray(siteMap.pathways) ? siteMap.pathways : [];
    const fenceShapes = Array.isArray(siteMap.electric_fence) ? siteMap.electric_fence : [];
    const chargingPoints = Array.isArray(siteMap.charging_points) ? siteMap.charging_points : [];
    const planFeedback = this._planFeedback(entry);
    const planSegments = planFeedback ? planFeedback.segments : [];
    const cloudPointsFeedback = this._cloudPointsFeedback(entry);
    const cloudSegments = cloudPointsFeedback ? cloudPointsFeedback.segments : [];
    const rechargeFeedback = this._rechargeFeedback(entry);
    const rechargePoints = rechargeFeedback ? this._displayPoints(rechargeFeedback.points) : [];
    const planPoints = planSegments.flatMap((segment) =>
      this._displayPoints(segment.points),
    );
    const cloudPoints = cloudSegments.flatMap((segment) =>
      this._displayPoints(segment.points),
    );
    const breadcrumbPoints = this._breadcrumbs.map((point) => this._displayPoint(point));

    const allPoints = [
      ...areaShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...noGoShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...pathwayShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...fenceShapes.flatMap((shape) => this._displayPoints(shape.points)),
      ...planPoints,
      ...cloudPoints,
      ...rechargePoints,
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
      ...breadcrumbPoints,
    ];

    const devicePoint = this._correctedLocalPoint(
      this._entry,
      location,
      this._localPointFromLocation(location, siteMap.reference),
    );
    const deviceMarkerPoint = devicePoint ? this._displayPoint(devicePoint) : null;
    if (deviceMarkerPoint) {
      allPoints.push(deviceMarkerPoint);
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
    const viewBoxX = minX - padding;
    const viewBoxY = -(maxY + padding);
    const viewBoxWidth = width + padding * 2;
    const viewBoxHeight = height + padding * 2;
    const viewBox = `${this._number(viewBoxX)} ${this._number(viewBoxY)} ${this._number(viewBoxWidth)} ${this._number(viewBoxHeight)}`;

    return {
      width,
      height,
      padding,
      viewBox,
      viewBoxX,
      viewBoxY,
      viewBoxWidth,
      viewBoxHeight,
      areaShapes: areaShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(45, 166, 153, 0.18)",
          stroke: "#ffffff",
          strokeWidth: 1,
        }))
        .join(""),
      noGoShapes: noGoShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(224, 49, 49, 0.16)",
          stroke: "#ff0000",
          strokeWidth: 1,
        }))
        .join(""),
      fenceShapes: fenceShapes
        .map((shape) => this._renderPolygonShape(shape, {
          fill: "rgba(73, 80, 87, 0.06)",
          stroke: "rgba(73, 80, 87, 0.72)",
          strokeWidth: 0.28,
        }))
        .join(""),
      planFeedbackShapes: planSegments
        .map((segment) => this._renderPlanFeedbackSegment(segment))
        .join(""),
      cloudPointsShapes: cloudSegments
        .map((segment) => this._renderCloudPointsSegment(segment))
        .join(""),
      rechargePathShape:
        rechargePoints.length >= 2 ? this._renderRechargePath(rechargeFeedback) : "",
      pathwayShapes: pathwayShapes
        .map((shape) => this._renderPathwayShape(shape))
        .join(""),
      chargingShapes: chargingPoints.map((item) => this._renderChargingShape(item)).join(""),
      breadcrumbTrail: this._renderBreadcrumbTrail(),
      deviceMarker: deviceMarkerPoint ? this._renderDeviceMarker(deviceMarkerPoint, heading) : "",
      deviceMarkerPoint,
    };
  }

  _renderPolygonShape(shape, style) {
    return `
      <polygon
        points="${this._escape(this._svgPoints(shape.points))}"
        fill="${this._escape(style.fill)}"
        stroke="${this._escape(style.stroke)}"
        stroke-width="${this._number(style.strokeWidth)}"
        ${style.dashArray ? `stroke-dasharray="${this._escape(style.dashArray)}"` : ""}
        vector-effect="non-scaling-stroke"
      ></polygon>
    `;
  }

  _renderPolylineShape(shape, style) {
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
      ></polyline>
    `;
  }

  _renderPathwayShape(shape) {
    const points = this._escape(this._svgPoints(shape.points));
    return `
      <polyline
        points="${points}"
        fill="none"
        stroke="rgba(240, 180, 41, 0.3)"
        stroke-width="0.55"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      <polyline
        points="${points}"
        fill="none"
        stroke="#f0b429"
        stroke-width="2"
        stroke-dasharray="2.8 2.2"
        stroke-linecap="butt"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polyline>
    `;
  }

  _renderPlanFeedbackSegment(segment) {
    const segmentType = Number(segment?.type);
    const pendingStroke =
      segmentType === 1 ? "rgba(132, 204, 22, 0.18)" : "rgba(132, 204, 22, 0.18)";
    const visitedStroke =
      segmentType === 1 ? "rgba(132, 204, 22, 0.9)" : "rgba(132, 204, 22, 0.9)";
    const dashArray = segmentType === 1 ? "5 3" : "2.5 2";
    const progress = this._planFeedbackSegmentProgress(segment);
    const parts = [];

    if (progress.remainingPoints.length >= 2) {
      parts.push(`
        <polyline
          points="${this._escape(this._svgPoints(progress.remainingPoints))}"
          fill="none"
          stroke="${pendingStroke}"
          stroke-width="2.2"
          stroke-dasharray="${dashArray}"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        ></polyline>
      `);
    }

    if (progress.visitedPoints.length >= 2) {
      parts.push(`
        <polyline
          points="${this._escape(this._svgPoints(progress.visitedPoints))}"
          fill="none"
          stroke="${visitedStroke}"
          stroke-width="2.4"
          stroke-dasharray="${dashArray}"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        ></polyline>
      `);
    }

    return parts.join("");
  }

  _renderCloudPointsSegment(segment) {
    const points = Array.isArray(segment?.points) ? segment.points : [];
    if (points.length < 2) {
      return "";
    }

    const line = this._escape(this._svgPoints(points));
    return `
      <polyline
        points="${line}"
        fill="none"
        stroke="rgba(255, 99, 71, 0.42)"
        stroke-width="0.25"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      <polyline
        points="${line}"
        fill="none"
        stroke="rgba(255, 99, 71, 0.42)"
        stroke-width="1.0"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polyline>
    `;
  }

  _renderRechargePath(rechargeFeedback) {
    const points = Array.isArray(rechargeFeedback?.points) ? rechargeFeedback.points : [];
    if (points.length < 2) {
      return "";
    }

    return `
      <polyline
        points="${this._escape(this._svgPoints(points))}"
        fill="none"
        stroke="rgba(34, 211, 238, 0.88)"
        stroke-width="2.2"
        stroke-dasharray="2 4"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polyline>
    `;
  }

  _planFeedback(entry) {
    if (this._embedded || this._config?.show_plan_feedback === false) {
      return null;
    }

    const planFeedback = entry?.plan_feedback;
    if (!planFeedback || typeof planFeedback !== "object") {
      return null;
    }

    return planFeedback;
  }

  _cloudPointsFeedback(entry) {
    if (this._embedded || this._config?.show_cloud_points === false) {
      return null;
    }

    const cloudPointsFeedback = entry?.cloud_points_feedback;
    if (!cloudPointsFeedback || typeof cloudPointsFeedback !== "object") {
      return null;
    }

    return cloudPointsFeedback;
  }

  _rechargeFeedback(entry) {
    if (this._embedded || this._config?.show_recharge_feedback === false) {
      return null;
    }

    const rechargeFeedback = entry?.recharge_feedback;
    if (!rechargeFeedback || typeof rechargeFeedback !== "object") {
      return null;
    }

    return rechargeFeedback;
  }

  _renderPlanFeedbackSummary(entry) {
    const planFeedback = entry?.plan_feedback;
    if (!planFeedback) {
      return "";
    }

    const rows = [
      ["Plan", this._planNameText(entry, planFeedback)],
      ["Progress", this._progressText(planFeedback.progress_percent)],
      ["Remaining", this._areaText(planFeedback.remaining_clean_area)],
      [
        "Estimate",
        this._estimateText(planFeedback.left_time, planFeedback.total_time),
      ],
    ];

    return `
      <div class="map-stats-pill">
        ${rows
          .map(
            ([label, value]) => `
              <div class="map-stats-row">
                <span class="map-stats-label">${this._escape(label)}</span>
                <span class="map-stats-value">${this._escape(value)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  _planFeedbackSegmentProgress(segment) {
    const points = Array.isArray(segment?.points) ? segment.points : [];
    if (points.length < 2) {
      return {
        visitedPoints: [],
        remainingPoints: points,
      };
    }

    if (this._isFinishedPlanFeedbackSegment(segment)) {
      return {
        visitedPoints: points,
        remainingPoints: [],
      };
    }

    const rawIndex = Number(segment?.clean_index);
    const cleanIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : -1;
    const lastPointIndex = points.length - 1;
    if (cleanIndex >= lastPointIndex) {
      return {
        visitedPoints: points,
        remainingPoints: [],
      };
    }

    if (cleanIndex <= 0) {
      return {
        visitedPoints: [],
        remainingPoints: points,
      };
    }

    return {
      visitedPoints: points.slice(0, cleanIndex + 1),
      remainingPoints: points.slice(cleanIndex),
    };
  }

  _isFinishedPlanFeedbackSegment(segment) {
    const planFeedback = this._entry?.plan_feedback;
    const finishIds = Array.isArray(planFeedback?.finish_ids) ? planFeedback.finish_ids : [];
    const segmentId = String(segment?.id ?? "");
    const segmentType = Number(segment?.type);
    return finishIds.some((candidate) => {
      if (!candidate || String(candidate.id ?? "") !== segmentId) {
        return false;
      }
      return Number(candidate.move_type) === segmentType;
    });
  }

  _renderChargingShape(item) {
    const geometry = this._dockGeometry(item);
    if (!geometry) {
      return "";
    }

    return `
      <polygon
        points="${this._escape(this._polygonPoints(geometry.guardCorners))}"
        fill="none"
        stroke="#00ff00"
        stroke-width="2"
        stroke-dasharray="6 4"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polygon>
      <polygon
        points="${this._escape(this._polygonPoints(geometry.dockCorners))}"
        fill="rgba(0, 255, 0, 0.3)"
        stroke="#00ff00"
        stroke-width="1"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polygon>
    `;
  }

  _dockGeometry(item) {
    const chargingPoint = item?.point;
    if (!chargingPoint) {
      return null;
    }

    const forward = this._dockForwardVector(item);
    if (!forward) {
      return null;
    }

    const perpendicular = {
      x: -forward.y,
      y: forward.x,
    };
    const dockHalfWidth = 0.315;
    const backEdgeOffset = 0.51;
    const frontEdgeOffset = 0.36;

    const backCenter = {
      x: chargingPoint.x - forward.x * backEdgeOffset,
      y: chargingPoint.y - forward.y * backEdgeOffset,
    };
    const frontCenter = {
      x: chargingPoint.x + forward.x * frontEdgeOffset,
      y: chargingPoint.y + forward.y * frontEdgeOffset,
    };

    const dockCorners = [
      {
        x: backCenter.x - perpendicular.x * dockHalfWidth,
        y: backCenter.y - perpendicular.y * dockHalfWidth,
      },
      {
        x: backCenter.x + perpendicular.x * dockHalfWidth,
        y: backCenter.y + perpendicular.y * dockHalfWidth,
      },
      {
        x: frontCenter.x + perpendicular.x * dockHalfWidth,
        y: frontCenter.y + perpendicular.y * dockHalfWidth,
      },
      {
        x: frontCenter.x - perpendicular.x * dockHalfWidth,
        y: frontCenter.y - perpendicular.y * dockHalfWidth,
      },
    ];

    const dockCenter = {
      x: (backCenter.x + frontCenter.x) / 2,
      y: (backCenter.y + frontCenter.y) / 2,
    };
    const guardHalfSize = 0.5;
    const guardCorners = [
      {
        x: dockCenter.x - forward.x * guardHalfSize - perpendicular.x * guardHalfSize,
        y: dockCenter.y - forward.y * guardHalfSize - perpendicular.y * guardHalfSize,
      },
      {
        x: dockCenter.x - forward.x * guardHalfSize + perpendicular.x * guardHalfSize,
        y: dockCenter.y - forward.y * guardHalfSize + perpendicular.y * guardHalfSize,
      },
      {
        x: dockCenter.x + forward.x * guardHalfSize + perpendicular.x * guardHalfSize,
        y: dockCenter.y + forward.y * guardHalfSize + perpendicular.y * guardHalfSize,
      },
      {
        x: dockCenter.x + forward.x * guardHalfSize - perpendicular.x * guardHalfSize,
        y: dockCenter.y + forward.y * guardHalfSize - perpendicular.y * guardHalfSize,
      },
    ];

    return {
      dockCorners,
      guardCorners,
    };
  }

  _polygonPoints(points) {
    return points
      .map((corner) => {
        const displayCorner = this._displayPoint(corner);
        return `${this._number(displayCorner.x)},${this._number(displayCorner.y)}`;
      })
      .join(" ");
  }

  _dockForwardVector(item) {
    if (item?.start_point && item?.point) {
      const deltaX = Number(item.start_point.x) - Number(item.point.x);
      const deltaY = Number(item.start_point.y) - Number(item.point.y);
      const magnitude = Math.hypot(deltaX, deltaY);
      if (magnitude > 0.0001) {
        return {
          x: deltaX / magnitude,
          y: deltaY / magnitude,
        };
      }
    }

    const straightPhi = Number(item?.straight_phi);
    if (Number.isFinite(straightPhi)) {
      return {
        x: Math.cos(straightPhi),
        y: Math.sin(straightPhi),
      };
    }

    return null;
  }

  _renderBreadcrumbTrail() {
    if (this._breadcrumbs.length < 2) {
      return "";
    }

    const segments = [];
    for (let index = 1; index < this._breadcrumbs.length; index += 1) {
      const previous = this._displayPoint(this._breadcrumbs[index - 1]);
      const current = this._displayPoint(this._breadcrumbs[index]);
      const isReverse =
        Boolean(this._breadcrumbs[index - 1]?.reverse) ||
        Boolean(this._breadcrumbs[index]?.reverse);
      const isCutting =
        Boolean(this._breadcrumbs[index - 1]?.cutting) ||
        Boolean(this._breadcrumbs[index]?.cutting);
      const stroke = isReverse
        ? "rgba(255, 0, 255, 0.68)"
        : "rgba(10, 132, 255, 0.38)";
      const strokeWidth = isCutting ? "0.55" : "2";
      const vectorEffect = isCutting ? "" : ' vector-effect="non-scaling-stroke"';
      segments.push(`
        <line
          x1="${this._number(previous.x)}"
          y1="${this._number(previous.y)}"
          x2="${this._number(current.x)}"
          y2="${this._number(current.y)}"
          stroke="${stroke}"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
          ${vectorEffect}
        ></line>
      `);
    }

    return segments.join("");
  }

  _renderDeviceMarker(point, heading) {
    const markerImage = typeof this._config?.marker_image === "string"
      ? this._config.marker_image.trim()
      : "";
    const zoomScale = Number.isFinite(this._viewState.scale) && this._viewState.scale > 0
      ? this._viewState.scale
      : 1;
    const rotationOffset = Number(this._config?.marker_rotation_offset);
    const offset = Number.isFinite(rotationOffset) ? rotationOffset : 90;
    const normalizedHeading = Number.isFinite(Number(heading))
      ? ((Number(heading) % 360) + 360) % 360
      : 0;
    const rotation = 180 - normalizedHeading + offset;

    if (markerImage) {
      const markerSize = Number(this._config?.marker_size);
      const size = Number.isFinite(markerSize) ? Math.max(3, markerSize) : 6;
      const imageSize = size / zoomScale;
      return `
        <g transform="translate(${this._number(point.x)} ${this._number(point.y)}) rotate(${this._number(rotation)})">
          <image
            href="${this._escape(markerImage)}"
            x="${this._number(-imageSize / 2)}"
            y="${this._number(-imageSize / 2)}"
            width="${this._number(imageSize)}"
            height="${this._number(imageSize)}"
            preserveAspectRatio="xMidYMid meet"
          ></image>
        </g>
      `;
    }

    const halfWidth = 0.275;
    const frontReach = 0.88;
    const shoulderY = -0.55;
    const rearReach = 0.42;
    return `
      <g transform="translate(${this._number(point.x)} ${this._number(point.y)}) rotate(${this._number(rotation)})">
        <path
          d="M0 ${this._number(-frontReach)} L${this._number(halfWidth)} ${this._number(shoulderY)} L${this._number(halfWidth)} ${this._number(rearReach)} L${this._number(-halfWidth)} ${this._number(rearReach)} L${this._number(-halfWidth)} ${this._number(shoulderY)} Z"
          fill="rgba(10, 132, 255, 0.72)"
          stroke="#ffffff"
          stroke-width="0.08"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        ></path>
        <circle
          cx="0"
          cy="0"
          r="0.07"
          fill="#ffffff"
          stroke="rgba(10, 132, 255, 0.9)"
          stroke-width="0.03"
          vector-effect="non-scaling-stroke"
        ></circle>
      </g>
    `;
  }

  _renderCalibrationWarning(entry) {
    return "";
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
    const statusState = entry.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    if (statusState?.attributes?.heading !== null && statusState?.attributes?.heading !== undefined) {
      return statusState.attributes.heading;
    }

    const trackerState = entry.tracker_entity_id
      ? this._hass?.states?.[entry.tracker_entity_id]
      : null;
    if (trackerState?.attributes?.heading !== null && trackerState?.attributes?.heading !== undefined) {
      return trackerState.attributes.heading;
    }

    if (entry.summary?.heading !== null && entry.summary?.heading !== undefined) {
      return entry.summary.heading;
    }

    if (
      entry.summary?.combined_odom_heading !== null &&
      entry.summary?.combined_odom_heading !== undefined
    ) {
      return entry.summary.combined_odom_heading;
    }

    return null;
  }

  _correctedLocalPoint(entry, location, rawLocalPoint = null) {
    const point = rawLocalPoint
      || this._localPointFromLocation(location, entry?.site_map?.reference);
    if (!point) {
      return null;
    }

    if (!this._gpsCalibration) {
      return point;
    }

    const forward = this._entryForwardVector(entry);
    if (!forward) {
      return point;
    }

    const perpendicular = {
      x: -forward.y,
      y: forward.x,
    };

    return {
      x:
        Number(point.x)
        + forward.x * this._gpsCalibration.longitudinal
        + perpendicular.x * this._gpsCalibration.lateral,
      y:
        Number(point.y)
        + forward.y * this._gpsCalibration.longitudinal
        + perpendicular.y * this._gpsCalibration.lateral,
    };
  }

  _entryForwardVector(entry) {
    const heading = Number(this._entryHeading(entry));
    if (Number.isFinite(heading)) {
      const radians = (heading * Math.PI) / 180;
      return {
        x: Math.cos(radians),
        y: Math.sin(radians),
      };
    }

    const odomHeading = Number(entry?.summary?.combined_odom_heading);
    if (Number.isFinite(odomHeading)) {
      return {
        x: Math.cos(odomHeading),
        y: Math.sin(odomHeading),
      };
    }

    return null;
  }

  _entryMowerHeadActive(entry) {
    const statusState = entry?.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    const statusAttrs = statusState?.attributes || null;
    const statusBladeSpeeds = [
      Number(statusAttrs?.left_blade_motor_speed),
      Number(statusAttrs?.right_blade_motor_speed),
      Number(statusAttrs?.left_blade_motor_rpm),
      Number(statusAttrs?.right_blade_motor_rpm),
    ];
    if (statusBladeSpeeds.some((value) => Number.isFinite(value) && Math.abs(value) > 0)) {
      return true;
    }

    const summaryBladeSpeeds = [
      Number(entry?.summary?.left_blade_motor_speed),
      Number(entry?.summary?.right_blade_motor_speed),
      Number(entry?.summary?.left_blade_motor_rpm),
      Number(entry?.summary?.right_blade_motor_rpm),
    ];
    return summaryBladeSpeeds.some((value) => Number.isFinite(value) && Math.abs(value) > 0);
  }

  _storageKey(suffix) {
    if (!suffix || !this._entry?.entry_id || !this._referenceSignature) {
      return null;
    }

    return `s2jyarbo-map-card:${suffix}:${this._entry.entry_id}:${this._referenceSignature}`;
  }

  _readStorageJson(key) {
    if (!key || typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  _writeStorageJson(key, value) {
    if (!key || typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_err) {
      // Ignore storage failures and keep the card functional.
    }
  }

  _persistZoomScale() {
    const scale = Number(this._viewState?.scale);
    if (!Number.isFinite(scale)) {
      return;
    }

    this._writeStorageJson(this._storageKey("zoom"), { scale });
  }

  _loadPersistedZoomScale() {
    const stored = this._readStorageJson(this._storageKey("zoom"));
    const scale = Number(stored?.scale);
    if (!Number.isFinite(scale)) {
      return null;
    }

    return Math.min(24.5, Math.max(0.7, scale));
  }

  _entryIsReverse(entry) {
    const statusState = entry?.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    const statusAttrs = statusState?.attributes || null;
    const statusLeft = Number(statusAttrs?.left_wheel_speed);
    const statusRight = Number(statusAttrs?.right_wheel_speed);
    if (Number.isFinite(statusLeft) && Number.isFinite(statusRight)) {
      return statusLeft < 0 && statusRight < 0;
    }

    const summaryLeft = Number(entry?.summary?.left_wheel_speed);
    const summaryRight = Number(entry?.summary?.right_wheel_speed);
    if (Number.isFinite(summaryLeft) && Number.isFinite(summaryRight)) {
      return summaryLeft < 0 && summaryRight < 0;
    }

    return false;
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
    const metersPerDegreeLongitude = Math.cos((referenceLatitude * Math.PI) / 180) * 111320;
    if (!Number.isFinite(metersPerDegreeLongitude) || metersPerDegreeLongitude === 0) {
      return null;
    }

    return {
      x: -(longitude - referenceLongitude) * metersPerDegreeLongitude,
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
    const candidates = Array.isArray(points) ? points : [];
    return candidates
      .map((point) => {
        const displayPoint = this._displayPoint(point);
        return `${this._number(displayPoint.x)},${this._number(displayPoint.y)}`;
      })
      .join(" ");
  }

  _coords(latitude, longitude) {
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return "No fix";
    }

    return `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
  }

  _planRunningText(planFeedback) {
    if (planFeedback?.plan_running === true) {
      return "Running";
    }
    if (planFeedback?.plan_running === false) {
      return "Stopped";
    }

    const state = Number(planFeedback?.state);
    return Number.isFinite(state) ? `State ${state}` : "Unknown";
  }

  _planNameText(entry, planFeedback) {
    const planId = String(planFeedback?.plan_id ?? "");
    if (!planId) {
      return "Unknown";
    }

    const plans = Array.isArray(entry?.plans) ? entry.plans : [];
    const match = plans.find((plan) => String(plan?.id ?? "") === planId);
    if (match?.name) {
      return String(match.name);
    }

    return `Plan ${planId}`;
  }

  _progressText(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "—";
    }

    return `${numeric.toFixed(1)}%`;
  }

  _areaText(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "—";
    }

    return `${numeric.toFixed(1)} m²`;
  }

  _estimateText(leftTime, totalTime) {
    const left = this._durationText(leftTime);
    const total = this._durationText(totalTime);
    if (left === "—" && total === "—") {
      return "—";
    }
    if (total === "—") {
      return left;
    }
    if (left === "—") {
      return `of ${total}`;
    }

    return `${left} / ${total}`;
  }

  _durationText(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "—";
    }

    const roundedSeconds = Math.max(0, Math.round(numeric));
    const hours = Math.floor(roundedSeconds / 3600);
    const minutes = Math.floor((roundedSeconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  _updateCanvasInsets(mapCanvas) {
    if (!(mapCanvas instanceof HTMLElement)) {
      return;
    }

    const drawing = this._lastDrawing;
    if (!drawing) {
      mapCanvas.style.removeProperty("--content-inset-top");
      mapCanvas.style.removeProperty("--content-inset-right");
      mapCanvas.style.removeProperty("--content-inset-bottom");
      mapCanvas.style.removeProperty("--content-inset-left");
      return;
    }

    const canvasWidth = mapCanvas.clientWidth;
    const canvasHeight = mapCanvas.clientHeight;
    if (!canvasWidth || !canvasHeight || !drawing.viewBoxWidth || !drawing.viewBoxHeight) {
      return;
    }

    const viewAspect = drawing.viewBoxWidth / drawing.viewBoxHeight;
    const canvasAspect = canvasWidth / canvasHeight;

    let insetX = 0;
    let insetY = 0;
    let contentWidth = canvasWidth;
    let contentHeight = canvasHeight;

    if (canvasAspect > viewAspect) {
      contentWidth = canvasHeight * viewAspect;
      insetX = Math.max((canvasWidth - contentWidth) / 2, 0);
    } else {
      contentHeight = canvasWidth / viewAspect;
      insetY = Math.max((canvasHeight - contentHeight) / 2, 0);
    }

    const paddingInsetX = drawing.padding
      ? (drawing.padding / drawing.viewBoxWidth) * contentWidth
      : 0;
    const paddingInsetY = drawing.padding
      ? (drawing.padding / drawing.viewBoxHeight) * contentHeight
      : 0;

    mapCanvas.style.setProperty("--content-inset-top", `${insetY + paddingInsetY}px`);
    mapCanvas.style.setProperty("--content-inset-right", `${insetX + paddingInsetX}px`);
    mapCanvas.style.setProperty("--content-inset-bottom", `${insetY + paddingInsetY}px`);
    mapCanvas.style.setProperty("--content-inset-left", `${insetX + paddingInsetX}px`);
  }

  _headingText(value) {
    if (value === null || value === undefined || value === "") {
      return "Heading —";
    }

    return `Heading ${Number(value).toFixed(1)}°`;
  }

  _titleCase(value) {
    return String(value).replace(/\b\w/g, (char) => char.toUpperCase());
  }

  _number(value) {
    return Number(value).toFixed(3);
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

if (!customElements.get("s2jyarbo-map-card")) {
  customElements.define(
    "s2jyarbo-map-card",
    class S2JYarboStandaloneMapCard extends S2JYarboMapCard {},
  );
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "s2jyarbo-map-card")) {
  window.customCards.push({
    type: "s2jyarbo-map-card",
    name: "S2JYarbo Map",
    description:
      "Development map card using cached decoded get_map geometry with optional live updates.",
    preview: false,
  });
}
