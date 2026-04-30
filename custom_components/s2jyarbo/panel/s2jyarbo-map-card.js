const FIXED_GPS_CALIBRATION = {
  longitudinal: 0.12733925057566753,
  lateral: 0.2076810316749709,
};
const MEMORY_PATH_WIDTH_METERS = 0.55;
const MEMORY_PATH_HALF_WIDTH_METERS = MEMORY_PATH_WIDTH_METERS / 2;

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
    this._deferredReloadAfterEdit = false;
    this._error = "";
    this._initialized = false;
    this._structureReady = false;
    this._refreshHandle = null;
    this._reloadHandle = null;
    this._historyGuardInstalled = false;
    this._historyGuardOriginalPushState = null;
    this._historyGuardOriginalReplaceState = null;
    this._historyGuardPushState = null;
    this._historyGuardReplaceState = null;
    this._historyGuardBypass = false;
    this._navigationGuardCurrentUrl = "";
    this._lastLoadTimestamp = 0;
    this._lastEntitySignature = "";
    this._pendingEmbeddedEntry = undefined;
    this._mapRequestPending = false;
    this._mapRequestTimestamp = 0;
    this._followMode = true;
    this._trailVisible = true;
    this._planFeedbackVisible = true;
    this._cloudPointsVisible = true;
    this._aerialOverlayVisible = true;
    this._aerialPanelOpen = false;
    this._aerialCalibrationMode = false;
    this._aerialCalibrationStep = "image";
    this._aerialCalibrationDraft = [];
    this._aerialCalibrationTransform = null;
    this._aerialPendingImagePoint = null;
    this._aerialOverlaySaving = false;
    this._aerialOverlayNotice = "";
    this._aerialPlacementOriginalSignature = "";
    this._aerialPlacementOriginalOverlay = null;
    this._editMode = false;
    this._editToolsExpanded = false;
    this._activeEditTool = null;
    this._pathwayDraftPoints = [];
    this._pathwayDraftJson = "";
    this._pathwayDraftCommittedJson = "";
    this._pathwayDraftName = "";
    this._pathwayDraftId = null;
    this._pathwayDraftKind = "pathway";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._pathwayDraftConnectIds = [];
    this._pathwayDraftHeadType = 99;
    this._pathwayDraftSnowPiles = [];
    this._pathwayDraftTrimmingEdges = [];
    this._pathwayDraftTrimmingEdgeAnchors = [];
    this._memoryPathTrimmerMode = false;
    this._memoryPathAutoAddTrimmingEdges = false;
    this._selectedDraftPointIndex = null;
    this._selectedTrimmingEdgeIndex = null;
    this._selectedTrimmingPointIndex = null;
    this._selectedTrimmingSelectionKind = null;
    this._pathwayDraftPendingName = "";
    this._pathwayDraftOriginalSignature = "";
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftSending = false;
    this._pathwayDraftNotice = "";
    this._pathwayNameDialogMode = "create";
    this._selectedPathwayKey = "";
    this._selectedMemoryPathKey = "";
    this._selectedNoGoKey = "";
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._memoryPathSettings = {
      en_blade: true,
      blade_height: 0,
      plan_speed: 0.5,
    };
    this._unsavedChangesDialogOpen = false;
    this._unsavedChangesAction = null;
    this._unsavedChangesNavigationUrl = "";
    this._unsavedChangesAfterSaveAction = null;
    this._unsavedChangesAfterSaveNavigationUrl = "";
    this._editContextMenu = null;
    this._editConfirmationOpen = false;
    this._editAcknowledged = false;
    this._editConfirmationSaving = false;
    this._editConfirmationError = "";
    this._viewState = {
      scale: 1,
      panX: 0,
      panY: 0,
    };
    this._lastDrawing = null;
    this._breadcrumbs = [];
    this._referenceSignature = "";
    this._gpsCalibration = { ...FIXED_GPS_CALIBRATION };
    this._stationaryLockPoint = null;
    this._stationaryLockHeading = null;
    this._activeDrag = null;
    this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
    this._handleDocumentClickCapture = this._handleDocumentClickCapture.bind(this);
    this._handlePopStateCapture = this._handlePopStateCapture.bind(this);
    this._handlePointerMove = this._handlePointerMove.bind(this);
    this._handlePointerUp = this._handlePointerUp.bind(this);
    this._handleKeyDown = this._handleKeyDown.bind(this);
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
      if (!this._isEditUpdateLocked()) {
        this._ingestEmbeddedEntry(this._entry);
      }
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
    window.addEventListener("beforeunload", this._handleBeforeUnload);
    window.addEventListener("popstate", this._handlePopStateCapture, true);
    window.addEventListener("keydown", this._handleKeyDown);
    document.addEventListener("click", this._handleDocumentClickCapture, true);
    this._installHistoryNavigationGuard();
    this._render();
  }

  disconnectedCallback() {
    window.removeEventListener("beforeunload", this._handleBeforeUnload);
    window.removeEventListener("popstate", this._handlePopStateCapture, true);
    window.removeEventListener("keydown", this._handleKeyDown);
    document.removeEventListener("click", this._handleDocumentClickCapture, true);
    this._restoreHistoryNavigationGuard();
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
    if (this._isEditUpdateLocked()) {
      this._pendingEmbeddedEntry = entry || null;
      return;
    }

    this._pendingEmbeddedEntry = undefined;
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

    if (this._isEditUpdateLocked()) {
      this._deferredReloadAfterEdit = true;
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
        if (this._entry) {
          this._error = "";
          return;
        }
        this._entry = null;
        this._error =
          "No S2JYarbo device matched this card configuration. Re-add the card from the device page or update its selector.";
        return;
      }

      if (entries.length === 0 && this._entry) {
        this._error = "";
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
    return (this._embedded || this._config?.live_updates !== false) && !this._editMode;
  }

  _isEditUpdateLocked() {
    return this._editMode || this._aerialCalibrationMode || Boolean(this._activeDrag);
  }

  _flushDeferredUpdatesAfterUnlock() {
    if (this._isEditUpdateLocked()) {
      return false;
    }

    if (this._pendingEmbeddedEntry !== undefined) {
      const pendingEntry = this._pendingEmbeddedEntry;
      this._pendingEmbeddedEntry = undefined;
      this._ingestEmbeddedEntry(pendingEntry);
      return true;
    }

    if (this._deferredReloadAfterEdit) {
      this._deferredReloadAfterEdit = false;
      void this._loadEntry();
      return true;
    }

    return false;
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
    if (this._isEditUpdateLocked()) {
      this._deferredReloadAfterEdit = true;
      return;
    }

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

  async _requestFreshMapAfterEdit() {
    const entryId = this._entry?.entry_id;
    if (!this._hass || !entryId) {
      return;
    }

    this._mapRequestPending = true;
    this._mapRequestTimestamp = Date.now();

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
      if (this._isEditUpdateLocked()) {
        this._deferredReloadAfterEdit = true;
        return;
      }
      void this._loadEntry();
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
    this._stationaryLockPoint = null;
    this._stationaryLockHeading = null;
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
        .map-canvas.is-aerial-calibrating,
        .map-canvas.is-aerial-calibrating .map-svg,
        .map-canvas.is-aerial-calibrating .map-svg * {
          cursor: crosshair;
        }
        .map-canvas.is-aerial-calibrating.is-dragging,
        .map-canvas.is-aerial-calibrating.is-dragging .map-svg,
        .map-canvas.is-aerial-calibrating.is-dragging .map-svg * {
          cursor: grabbing;
        }
        .map-canvas.is-aerial-calibrating .map-controls,
        .map-canvas.is-aerial-calibrating .map-edit-controls,
        .map-canvas.is-aerial-calibrating .map-edit-actions,
        .map-canvas.is-aerial-calibrating .map-selected-actions,
        .map-canvas.is-aerial-calibrating .map-overlay {
          display: none;
        }
        .map-svg {
          display: block;
          height: 100%;
          min-height: 360px;
          width: 100%;
        }
        .aerial-image {
          pointer-events: auto;
        }
        .aerial-image.is-calibrating {
          cursor: crosshair;
        }
        .aerial-panel {
          background: color-mix(in srgb, var(--card-background-color) 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 12px;
          display: grid;
          gap: 8px;
          left: var(--content-inset-left, 12px);
          max-width: min(380px, calc(100% - var(--content-inset-left, 12px) - var(--content-inset-right, 12px) - 16px));
          padding: 10px;
          pointer-events: auto;
          position: absolute;
          top: calc(var(--content-inset-top, 12px) + 56px);
          z-index: 2;
        }
        .aerial-panel-row {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .aerial-file-input,
        .aerial-import-input {
          display: none;
        }
        .aerial-notice {
          color: var(--secondary-text-color);
          font-size: 12px;
          line-height: 1.35;
        }
        .aerial-notice.error {
          color: var(--error-color);
        }
        .aerial-opacity {
          accent-color: var(--primary-color);
          width: 120px;
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
        .map-edit-controls {
          display: grid;
          gap: 8px;
          inset: 8px 146px auto 8px;
          justify-items: start;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .map-edit-primary-row {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          max-width: 100%;
          pointer-events: none;
        }
        .map-edit-controls-row {
          display: flex;
          gap: 8px;
          pointer-events: none;
        }
        .map-edit-hints {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          pointer-events: none;
        }
        .map-edit-hint {
          background: color-mix(in srgb, var(--card-background-color) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 68%, transparent);
          border-radius: 8px;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 650;
          line-height: 1.15;
          padding: 6px 8px;
          white-space: nowrap;
        }
        .map-edit-tools {
          display: flex;
          gap: 8px;
          max-width: 0;
          opacity: 0;
          overflow: hidden;
          pointer-events: none;
          transform: translateX(-8px);
          transition:
            max-width 180ms ease,
            opacity 180ms ease,
            transform 180ms ease;
          white-space: nowrap;
        }
        .map-edit-tools.is-open {
          max-width: 270px;
          opacity: 1;
          pointer-events: auto;
          transform: translateX(0);
        }
        .map-edit-actions {
          display: flex;
          gap: 8px;
          inset: auto 8px 8px auto;
          justify-content: end;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .map-selected-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          inset: auto 8px 8px auto;
          justify-content: end;
          max-width: min(75%, 340px);
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .map-context-menu {
          background: color-mix(in srgb, var(--card-background-color) 96%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 78%, transparent);
          border-radius: 10px;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.28);
          display: grid;
          gap: 4px;
          min-width: 132px;
          padding: 6px;
          pointer-events: auto;
          position: absolute;
          z-index: 3;
        }
        .map-context-item {
          appearance: none;
          background: transparent;
          border: 0;
          border-radius: 7px;
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 650;
          padding: 8px 10px;
          text-align: left;
        }
        .map-context-item:hover:not(:disabled) {
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
        }
        .map-context-item:disabled {
          color: var(--disabled-text-color);
          cursor: default;
        }
        .map-dialog-backdrop {
          align-items: center;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          inset: 0;
          justify-content: center;
          padding: 18px;
          pointer-events: auto;
          position: absolute;
          z-index: 2;
        }
        .map-dialog {
          background: color-mix(in srgb, var(--card-background-color) 94%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 75%, transparent);
          border-radius: 18px;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.32);
          display: grid;
          gap: 12px;
          max-width: 320px;
          padding: 16px;
          width: 100%;
        }
        .map-dialog-title {
          color: var(--primary-text-color);
          font-size: 15px;
          font-weight: 700;
          line-height: 1.2;
        }
        .map-dialog-copy {
          color: var(--secondary-text-color);
          font-size: 13px;
          line-height: 1.45;
        }
        .map-dialog-input {
          background: color-mix(in srgb, var(--card-background-color) 84%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 76%, transparent);
          border-radius: 12px;
          color: var(--primary-text-color);
          font: inherit;
          outline: none;
          padding: 10px 12px;
          width: 100%;
        }
        .map-dialog-input:focus {
          border-color: color-mix(in srgb, var(--primary-color) 45%, transparent);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 28%, transparent);
        }
        .map-dialog-actions {
          display: flex;
          gap: 8px;
          justify-content: end;
        }
        .map-edit-confirmation-backdrop {
          align-items: center;
          background: rgba(2, 6, 23, 0.72);
          display: flex;
          inset: 0;
          justify-content: center;
          padding: 24px;
          pointer-events: auto;
          position: fixed;
          z-index: 2147483647;
        }
        .map-edit-confirmation-dialog {
          background: color-mix(in srgb, var(--card-background-color) 96%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 72%, transparent);
          border-radius: 12px;
          box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38);
          color: var(--primary-text-color);
          display: grid;
          gap: 14px;
          max-width: 560px;
          padding: 22px;
          width: min(100%, 560px);
        }
        .map-edit-confirmation-title {
          font-size: 18px;
          font-weight: 800;
          line-height: 1.2;
        }
        .map-edit-confirmation-copy {
          color: var(--secondary-text-color);
          display: grid;
          font-size: 14px;
          gap: 10px;
          line-height: 1.45;
        }
        .map-edit-confirmation-error {
          background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--error-color, #db4437) 45%, transparent);
          border-radius: 8px;
          color: var(--error-color, #db4437);
          font-size: 13px;
          line-height: 1.35;
          padding: 9px 10px;
        }
        .map-edit-confirmation-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: end;
          margin-top: 4px;
        }
        .map-unsaved-actions {
          align-items: center;
          display: flex;
          gap: 10px;
          justify-content: space-between;
          margin-top: 4px;
        }
        .map-unsaved-actions-right {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: end;
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
        .map-button.is-icon-only {
          background: transparent;
          border-color: transparent;
          color: #fff;
          min-width: 32px;
          padding: 0;
          width: 32px;
        }
        .map-button.is-icon-only:hover,
        .map-button.is-icon-only.is-active {
          background: transparent;
          border-color: transparent;
          color: #fff;
          transform: none;
        }
        .map-button.is-icon-plain {
          background: transparent;
          border-color: transparent;
        }
        .map-button.is-icon-plain:hover {
          background: transparent;
          border-color: transparent;
        }
        .map-button.is-icon-outlined ha-icon {
          filter:
            drop-shadow(1px 0 0 #000)
            drop-shadow(-1px 0 0 #000)
            drop-shadow(0 1px 0 #000)
            drop-shadow(0 -1px 0 #000);
        }
        .map-button ha-icon {
          --mdc-icon-size: 20px;
          display: block;
          height: 20px;
          width: 20px;
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
        .dev-json-panel {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .dev-json-header {
          align-items: center;
          display: flex;
          gap: 10px;
          justify-content: space-between;
        }
        .dev-json-title {
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .dev-json-note {
          color: var(--secondary-text-color);
          font-size: 12px;
        }
        .dev-json-preview {
          background: color-mix(in srgb, var(--card-background-color) 82%, transparent);
          border: 1px solid color-mix(in srgb, var(--divider-color) 72%, transparent);
          border-radius: 14px;
          color: var(--primary-text-color);
          font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
          min-height: 132px;
          padding: 12px 14px;
          resize: vertical;
          width: 100%;
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
      status.textContent = this._loading ? "Loading..." : this._editMode ? "Edit mode" : "Live local map";
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
          <div class="map-canvas ${this._aerialCalibrationMode ? "is-aerial-calibrating" : ""}">
            <div class="map-edit-controls">
              <div class="map-edit-primary-row">
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._editMode ? "is-active" : ""}"
                  type="button"
                  data-action="edit-mode"
                  aria-label="${this._editMode ? "End edit" : "Edit"}"
                  title="${this._editMode ? "End edit" : "Edit"}"
                >
                  <ha-icon icon="${this._editMode ? "mdi:pencil-off-outline" : "mdi:vector-polyline-edit"}"></ha-icon>
                </button>
                ${this._renderEditModeHints()}
              </div>
              ${this._editMode && !this._activeEditTool && !this._aerialPanelOpen ? `
                <div class="map-edit-controls-row">
                  <button class="map-button" type="button" data-action="edit-tools">${this._editToolsExpanded ? "−" : "+"}</button>
                  <div class="map-edit-tools ${this._editToolsExpanded ? "is-open" : ""}">
                    <button class="map-button is-icon-only ${this._activeEditTool === "pa" ? "is-active" : ""}" type="button" data-action="tool-pa" aria-label="Pathway" title="Pathway">
                      <ha-icon icon="mdi:map-marker-path"></ha-icon>
                    </button>
                    <button class="map-button is-icon-only ${this._activeEditTool === "ng" ? "is-active" : ""}" type="button" data-action="tool-ng" aria-label="No-go zone" title="No-go zone">
                      <ha-icon icon="mdi:sign-caution"></ha-icon>
                    </button>
                    <button class="map-button is-icon-only ${this._activeEditTool === "wp" ? "is-active" : ""}" type="button" data-action="tool-wp" aria-label="Waypoint" title="Waypoint">
                      <ha-icon icon="mdi:vector-polyline"></ha-icon>
                    </button>
                    <button class="map-button is-icon-only ${this._activeEditTool === "mp" ? "is-active" : ""}" type="button" data-action="tool-mp" aria-label="Memory path" title="Memory path">
                      <ha-icon icon="mdi:memory"></ha-icon>
                    </button>
                    <button class="map-button is-icon-only ${this._aerialPanelOpen ? "is-active" : ""}" type="button" data-action="background-image" aria-label="Background image" title="Background image">
                      <ha-icon icon="mdi:image-edit-outline"></ha-icon>
                    </button>
                  </div>
                </div>
              ` : ""}
            </div>
            <div class="map-controls">
              ${this._editMode ? "" : `
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._followMode ? "is-active" : ""}"
                  type="button"
                  data-action="follow"
                  aria-label="${this._followMode ? "Following" : "Follow"}"
                  title="${this._followMode ? "Following" : "Follow"}"
                >
                  <ha-icon icon="${this._followMode ? "mdi:arrow-all" : "mdi:arrow-collapse-all"}"></ha-icon>
                </button>
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._trailVisible ? "is-active" : ""}"
                  type="button"
                  data-action="trail"
                  aria-label="${this._trailVisible ? "Trail on" : "Trail off"}"
                  title="${this._trailVisible ? "Trail on" : "Trail off"}"
                >
                  <ha-icon icon="${this._trailVisible ? "mdi:led-strip-variant" : "mdi:led-strip-variant-off"}"></ha-icon>
                </button>
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._planFeedbackVisible ? "is-active" : ""}"
                  type="button"
                  data-action="plan-feedback"
                  aria-label="${this._planFeedbackVisible ? "Plan on" : "Plan off"}"
                  title="${this._planFeedbackVisible ? "Plan on" : "Plan off"}"
                >
                  <ha-icon icon="${this._planFeedbackVisible ? "mdi:nfc-variant" : "mdi:nfc-variant-off"}"></ha-icon>
                </button>
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._cloudPointsVisible ? "is-active" : ""}"
                  type="button"
                  data-action="cloud-points"
                  aria-label="${this._cloudPointsVisible ? "Barrier on" : "Barrier off"}"
                  title="${this._cloudPointsVisible ? "Barrier on" : "Barrier off"}"
                >
                  <ha-icon icon="${this._cloudPointsVisible ? "mdi:boom-gate-outline" : "mdi:boom-gate-up-outline"}"></ha-icon>
                </button>
                <button
                  class="map-button is-icon-only is-icon-outlined ${this._aerialOverlayVisible && entry.aerial_overlay?.image_data ? "is-active" : ""}"
                  type="button"
                  data-action="aerial-toggle"
                  aria-label="${this._aerialOverlayVisible ? "Aerial on" : "Aerial off"}"
                  title="${this._aerialOverlayVisible ? "Aerial on" : "Aerial off"}"
                  ${entry.aerial_overlay?.image_data ? "" : "disabled"}
                >
                  <ha-icon icon="${this._aerialOverlayVisible ? "mdi:image" : "mdi:image-off"}"></ha-icon>
                </button>
              `}
              <button class="map-button is-icon-only is-icon-plain is-icon-outlined" type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in">
                <ha-icon icon="mdi:magnify-plus"></ha-icon>
              </button>
              <button class="map-button is-icon-only is-icon-plain is-icon-outlined" type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out">
                <ha-icon icon="mdi:magnify-minus"></ha-icon>
              </button>
              <button class="map-button is-icon-only is-icon-plain is-icon-outlined" type="button" data-action="reset" aria-label="Reset view" title="Reset view">
                <ha-icon icon="mdi:restart"></ha-icon>
              </button>
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
                  ${this._renderAerialOverlay(entry.aerial_overlay)}
                  ${drawing.areaShapes}
                  ${drawing.fenceShapes}
                  ${drawing.noGoShapes}
                  ${this._planFeedbackVisible ? drawing.planFeedbackShapes : ""}
                  ${this._cloudPointsVisible ? drawing.cloudPointsShapes : ""}
                  ${drawing.rechargePathShape}
                  ${drawing.sidewalkShapes}
                  ${drawing.pathwayShapes}
                  ${drawing.chargingShapes}
                  ${drawing.editDraftShapes}
                  ${this._trailVisible ? drawing.breadcrumbTrail : ""}
                  ${drawing.deviceMarker}
                </g>
              </g>
            </svg>
            ${this._editMode && (
              this._activeEditTool === "pa"
              || this._activeEditTool === "mp"
              || this._activeEditTool === "pathway-edit"
              || this._activeEditTool === "pathway-move"
              || this._activeEditTool === "ng"
              || this._activeEditTool === "nogozone-edit"
              || this._activeEditTool === "nogozone-move"
            ) ? `
              <div class="map-edit-actions">
                ${this._pathwayDraftKind === "sidewalk" ? `
                  <button class="map-button ${this._memoryPathTrimmerMode ? "is-active" : ""}" type="button" data-action="edit-trimmer">${this._memoryPathTrimmerMode ? "Edit path" : "Edit trimmer"}</button>
                  ${this._activeEditTool === "mp" ? `
                    <button class="map-button ${this._memoryPathAutoAddTrimmingEdges ? "is-active" : ""}" type="button" data-action="toggle-auto-trimmer">${this._memoryPathAutoAddTrimmingEdges ? "Trimmer On" : "Trimmer Off"}</button>
                  ` : ""}
                ` : ""}
                <button class="map-button is-active" type="button" data-action="edit-accept">✓</button>
                <button class="map-button" type="button" data-action="edit-cancel">✕</button>
              </div>
            ` : ""}
            ${this._editMode && !this._activeEditTool && this._selectedPathway() ? `
              <div class="map-selected-actions">
                <button class="map-button is-active" type="button" data-action="pathway-edit">Edit</button>
                <button class="map-button" type="button" data-action="pathway-rename">Rename</button>
                <button class="map-button" type="button" data-action="pathway-settings">Settings</button>
                <button class="map-button" type="button" data-action="pathway-delete">Delete</button>
              </div>
            ` : ""}
            ${this._editMode && !this._activeEditTool && !this._selectedPathway() && this._selectedMemoryPath() ? `
              <div class="map-selected-actions">
                <button class="map-button is-active" type="button" data-action="memorypath-edit">Edit</button>
                <button class="map-button" type="button" data-action="memorypath-rename">Rename</button>
                <button class="map-button" type="button" data-action="memorypath-settings">Settings</button>
                <button class="map-button" type="button" data-action="memorypath-delete">Delete</button>
              </div>
            ` : ""}
            ${this._editMode && !this._activeEditTool && !this._selectedPathway() && !this._selectedMemoryPath() && this._selectedNoGoZone() ? `
              <div class="map-selected-actions">
                <button class="map-button is-active" type="button" data-action="nogozone-edit">Edit</button>
                <button class="map-button" type="button" data-action="nogozone-rename">Rename</button>
                <button class="map-button" type="button" data-action="nogozone-settings">Settings</button>
                <button class="map-button" type="button" data-action="nogozone-toggle-enable">${this._selectedNoGoZone()?.enable === false ? "Enable" : "Disable"}</button>
                <button class="map-button" type="button" data-action="nogozone-delete">Delete</button>
              </div>
            ` : ""}
            ${this._renderEditContextMenu()}
            ${this._renderPathwayNameDialog()}
            ${this._renderPathwayDeleteDialog()}
            ${this._renderMemoryPathSettingsDialog()}
            ${this._renderUnsavedChangesDialog()}
            ${this._renderEditConfirmationDialog()}
            ${this._editMode && this._aerialPanelOpen ? this._renderAerialPanel(entry) : ""}
            <div class="map-overlay map-overlay-left">
              <span class="map-reading">${this._escape(this._coords(location.latitude, location.longitude))}</span>
              <span class="map-reading">${this._escape(this._headingText(heading))}</span>
            </div>
            <div class="map-overlay map-overlay-right">
              ${this._editMode ? "" : this._renderPlanFeedbackSummary(entry)}
              ${this._renderCalibrationWarning(entry)}
            </div>
          </div>
        </div>
        ${this._renderEditJsonPanel(entry)}
      </div>
    `;
  }

  _renderAerialPanel(entry) {
    const overlay = entry?.aerial_overlay || null;
    const hasImage = Boolean(overlay?.image_data);
    const canCalibrate = hasImage;
    const notice = this._aerialOverlayNotice
      || (this._aerialCalibrationMode
        ? "Shift-drag moves the image. Wheel scales. Ctrl-wheel rotates. Save placement when it looks right."
        : hasImage
          ? "Open placement to move, scale, and rotate the background image."
          : "Upload an aerial image, then manually place it.");

    return `
      <div class="aerial-panel">
        <div class="aerial-panel-row">
          <button class="map-button" type="button" data-action="aerial-upload">Upload image</button>
          <input class="aerial-file-input" type="file" accept="image/*" />
          <button class="map-button" type="button" data-action="aerial-import">Import placement</button>
          <input class="aerial-import-input" type="file" accept="application/json,.json" />
          <button class="map-button" type="button" data-action="aerial-export" ${hasImage ? "" : "disabled"}>Export placement</button>
          <button class="map-button is-icon-only" type="button" data-action="aerial-rotate-left" aria-label="Rotate left" title="Rotate left" ${hasImage && !this._aerialOverlaySaving ? "" : "disabled"}>
            <ha-icon icon="mdi:rotate-left"></ha-icon>
          </button>
          <button class="map-button is-icon-only" type="button" data-action="aerial-rotate-right" aria-label="Rotate right" title="Rotate right" ${hasImage && !this._aerialOverlaySaving ? "" : "disabled"}>
            <ha-icon icon="mdi:rotate-right"></ha-icon>
          </button>
          <button class="map-button is-icon-only" type="button" data-action="aerial-flip-horizontal" aria-label="Flip horizontal" title="Flip horizontal" ${hasImage && !this._aerialOverlaySaving ? "" : "disabled"}>
            <ha-icon icon="mdi:flip-horizontal"></ha-icon>
          </button>
          <button class="map-button is-icon-only" type="button" data-action="aerial-flip-vertical" aria-label="Flip vertical" title="Flip vertical" ${hasImage && !this._aerialOverlaySaving ? "" : "disabled"}>
            <ha-icon icon="mdi:flip-vertical"></ha-icon>
          </button>
          <button class="map-button ${this._aerialCalibrationMode ? "is-active" : ""}" type="button" data-action="aerial-calibrate" ${hasImage ? "" : "disabled"}>
            ${this._aerialCalibrationMode ? "Stop placing" : "Place image"}
          </button>
          <button class="map-button is-icon-only" type="button" data-action="aerial-panel-close" aria-label="Close background image panel" title="Close">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
          <button class="map-button" type="button" data-action="aerial-save" ${canCalibrate && !this._aerialOverlaySaving ? "" : "disabled"}>
            ${this._aerialOverlaySaving ? "Saving..." : "Save placement"}
          </button>
          <button class="map-button" type="button" data-action="aerial-clear" ${hasImage ? "" : "disabled"}>Clear</button>
        </div>
        <div class="aerial-panel-row">
          <label class="aerial-notice">
            Opacity
            <input class="aerial-opacity" type="range" min="0.1" max="1" step="0.05" value="${this._escape(overlay?.opacity ?? 0.62)}" ${hasImage ? "" : "disabled"} />
          </label>
        </div>
        <div class="aerial-notice ${this._aerialOverlayNotice.startsWith("Failed") ? "error" : ""}">${this._escape(notice)}</div>
      </div>
    `;
  }

  _renderAerialOverlay(overlay) {
    const transform = this._currentAerialTransform(overlay);
    if (
      !this._aerialOverlayVisible
      || !overlay?.image_data
      || !transform
    ) {
      return this._renderAerialAnchors(overlay);
    }

    const opacity = Math.max(0.05, Math.min(1, Number(overlay.opacity) || 0.62));
    const width = Math.max(1, Number(overlay.image_width) || 1);
    const height = Math.max(1, Number(overlay.image_height) || 1);

    return `
      <image
        class="aerial-image ${this._aerialCalibrationMode ? "is-calibrating" : ""}"
        data-aerial-image="true"
        href="${this._escape(overlay.image_data)}"
        x="0"
        y="0"
        width="${this._number(width)}"
        height="${this._number(height)}"
        opacity="${this._number(opacity)}"
        preserveAspectRatio="none"
        transform="matrix(${this._number(transform.a)} ${this._number(transform.b)} ${this._number(transform.c)} ${this._number(transform.d)} ${this._number(transform.e)} ${this._number(transform.f)})"
      />
    `;
  }

  _renderProjectiveAerialOverlay(overlay, transform, width, height, opacity) {
    const gridSize = 12;
    const sourceId = this._aerialSvgId("source");
    const triangles = [];

    for (let row = 0; row < gridSize; row += 1) {
      const y0 = (height * row) / gridSize;
      const y1 = (height * (row + 1)) / gridSize;
      for (let col = 0; col < gridSize; col += 1) {
        const x0 = (width * col) / gridSize;
        const x1 = (width * (col + 1)) / gridSize;
        triangles.push([
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
        ]);
        triangles.push([
          { x: x0, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ]);
      }
    }

    const renderedTriangles = triangles
      .map((sourceTriangle, index) => {
        const targetTriangle = sourceTriangle.map((point) =>
          this._transformAerialImagePoint(point, transform),
        );
        if (targetTriangle.some((point) => !point)) {
          return "";
        }

        const affine = this._affineFromTriangles(sourceTriangle, targetTriangle);
        if (!affine) {
          return "";
        }

        const clipId = this._aerialSvgId(`clip-${index}`);
        const targetPoints = targetTriangle
          .map((point) => `${this._number(point.x)},${this._number(point.y)}`)
          .join(" ");
        return `
          <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
            <polygon points="${targetPoints}" />
          </clipPath>
          <use
            class="aerial-image ${this._aerialCalibrationMode ? "is-calibrating" : ""}"
            href="#${sourceId}"
            opacity="${this._number(opacity)}"
            clip-path="url(#${clipId})"
            transform="matrix(${this._number(affine.a)} ${this._number(affine.b)} ${this._number(affine.c)} ${this._number(affine.d)} ${this._number(affine.e)} ${this._number(affine.f)})"
          />
        `;
      })
      .join("");

    return `
      <defs>
        <image
          id="${sourceId}"
          href="${this._escape(overlay.image_data)}"
          x="0"
          y="0"
          width="${this._number(width)}"
          height="${this._number(height)}"
          preserveAspectRatio="none"
        />
      </defs>
      ${renderedTriangles}
    `;
  }

  _renderMeshAerialOverlay(overlay, points, transform, width, height, opacity) {
    const vertices = this._aerialMeshVertices(points, transform, width, height);
    const triangles = this._delaunayTriangles(vertices);
    if (!vertices.length || !triangles.length) {
      return this._renderProjectiveAerialOverlay(overlay, transform, width, height, opacity);
    }

    const renderedTriangles = triangles
      .map((triangle, index) => {
        const sourceTriangle = triangle.map((vertexIndex) => vertices[vertexIndex].source);
        const targetTriangle = triangle.map((vertexIndex) => vertices[vertexIndex].target);
        if (sourceTriangle.some((point) => !point) || targetTriangle.some((point) => !point)) {
          return "";
        }

        const affine = this._affineFromTriangles(sourceTriangle, targetTriangle);
        if (
          !affine
          || ![affine.a, affine.b, affine.c, affine.d, affine.e, affine.f].every(Number.isFinite)
        ) {
          return "";
        }

        const clipId = this._aerialSvgId(`mesh-clip-${index}`);
        const targetPoints = targetTriangle
          .map((point) => `${this._number(point.x)},${this._number(point.y)}`)
          .join(" ");
        return `
          <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
            <polygon points="${targetPoints}" />
          </clipPath>
          <g clip-path="url(#${clipId})">
            <image
              class="aerial-image ${this._aerialCalibrationMode ? "is-calibrating" : ""}"
              href="${this._escape(overlay.image_data)}"
              x="0"
              y="0"
              width="${this._number(width)}"
              height="${this._number(height)}"
              opacity="${this._number(opacity)}"
              preserveAspectRatio="none"
              transform="matrix(${this._number(affine.a)} ${this._number(affine.b)} ${this._number(affine.c)} ${this._number(affine.d)} ${this._number(affine.e)} ${this._number(affine.f)})"
            />
          </g>
        `;
      })
      .join("");

    return renderedTriangles;
  }

  _aerialMeshVertices(points, transform, width, height) {
    const baseTransform = this._baseAerialTransformForMesh(points, transform);
    const vertices = [
      { source: { x: 0, y: 0 } },
      { source: { x: width, y: 0 } },
      { source: { x: width, y: height } },
      { source: { x: 0, y: height } },
    ];

    for (const pair of points) {
      const source = pair?.image;
      const target = pair?.map;
      if (
        source
        && target
        && Number.isFinite(Number(source.x))
        && Number.isFinite(Number(source.y))
        && Number.isFinite(Number(target.x))
        && Number.isFinite(Number(target.y))
      ) {
        vertices.push({
          source: { x: Number(source.x), y: Number(source.y) },
          target: { x: Number(target.x), y: Number(target.y) },
        });
      }
    }

    return vertices
      .filter((vertex, index, allVertices) =>
        allVertices.findIndex((candidate) =>
          Math.hypot(
            Number(candidate.source.x) - Number(vertex.source.x),
            Number(candidate.source.y) - Number(vertex.source.y),
          ) < 0.001
        ) === index
      )
      .map((vertex) => ({
        ...vertex,
        target: vertex.target || this._transformAerialImagePoint(vertex.source, baseTransform),
      }))
      .filter((vertex) => vertex.target);
  }

  _baseAerialTransformForMesh(points, fallbackTransform) {
    const validPoints = Array.isArray(points)
      ? points.filter((pair) =>
          Number.isFinite(Number(pair?.image?.x))
          && Number.isFinite(Number(pair?.image?.y))
          && Number.isFinite(Number(pair?.map?.x))
          && Number.isFinite(Number(pair?.map?.y))
        )
      : [];
    if (validPoints.length < 3) {
      return fallbackTransform;
    }

    let bestTriple = validPoints.slice(0, 3);
    let bestArea = 0;
    for (let first = 0; first < validPoints.length - 2; first += 1) {
      for (let second = first + 1; second < validPoints.length - 1; second += 1) {
        for (let third = second + 1; third < validPoints.length; third += 1) {
          const area = Math.abs(this._triangleArea(
            validPoints[first].image,
            validPoints[second].image,
            validPoints[third].image,
          ));
          if (area > bestArea) {
            bestArea = area;
            bestTriple = [validPoints[first], validPoints[second], validPoints[third]];
          }
        }
      }
    }

    return this._affineAerialTransformFromPoints(bestTriple) || fallbackTransform;
  }

  _delaunayTriangles(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
      return [];
    }

    const sourcePoints = vertices.map((vertex) => vertex.source);
    const bounds = sourcePoints.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const delta = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;
    const allPoints = [
      ...sourcePoints,
      { x: midX - delta * 20, y: midY - delta },
      { x: midX, y: midY + delta * 20 },
      { x: midX + delta * 20, y: midY - delta },
    ];
    const superStart = sourcePoints.length;
    let triangles = [[superStart, superStart + 1, superStart + 2]];

    for (let pointIndex = 0; pointIndex < sourcePoints.length; pointIndex += 1) {
      const point = allPoints[pointIndex];
      const badTriangles = triangles.filter((triangle) =>
        this._triangleCircumcircleContains(
          allPoints[triangle[0]],
          allPoints[triangle[1]],
          allPoints[triangle[2]],
          point,
        ),
      );
      const polygonEdges = [];
      for (const triangle of badTriangles) {
        for (const edge of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
          const existingIndex = polygonEdges.findIndex((candidate) =>
            candidate[0] === edge[1] && candidate[1] === edge[0]
          );
          if (existingIndex >= 0) {
            polygonEdges.splice(existingIndex, 1);
          } else {
            polygonEdges.push(edge);
          }
        }
      }
      triangles = triangles.filter((triangle) => !badTriangles.includes(triangle));
      for (const edge of polygonEdges) {
        triangles.push([edge[0], edge[1], pointIndex]);
      }
    }

    return triangles
      .filter((triangle) => triangle.every((index) => index < sourcePoints.length))
      .filter((triangle) => Math.abs(this._triangleArea(
        sourcePoints[triangle[0]],
        sourcePoints[triangle[1]],
        sourcePoints[triangle[2]],
      )) > 0.000001);
  }

  _triangleCircumcircleContains(a, b, c, point) {
    const ax = a.x - point.x;
    const ay = a.y - point.y;
    const bx = b.x - point.x;
    const by = b.y - point.y;
    const cx = c.x - point.x;
    const cy = c.y - point.y;
    const determinant =
      (ax * ax + ay * ay) * (bx * cy - cx * by)
      - (bx * bx + by * by) * (ax * cy - cx * ay)
      + (cx * cx + cy * cy) * (ax * by - bx * ay);
    return this._triangleArea(a, b, c) > 0 ? determinant > 0 : determinant < 0;
  }

  _triangleArea(a, b, c) {
    return ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }

  _renderAerialAnchors(overlay) {
    return "";
  }

  async _uploadAerialImage(file) {
    if (!this._hass || !this._entry?.entry_id) {
      this._aerialOverlayNotice = "Home Assistant is not ready to store the aerial image.";
      this._render();
      return;
    }

    if (!file.type.startsWith("image/")) {
      this._aerialOverlayNotice = "Failed: choose an image file.";
      this._render();
      return;
    }

    this._aerialOverlaySaving = true;
    this._aerialOverlayNotice = "Loading aerial image...";
    this._render();

    try {
      const imageData = await this._readFileAsDataUrl(file);
      const dimensions = await this._imageDimensions(imageData);
      const overlay = {
        image_data: imageData,
        image_width: dimensions.width,
        image_height: dimensions.height,
        opacity: this._entry.aerial_overlay?.opacity ?? 0.62,
        points: [],
        transform: this._defaultAerialTransform(dimensions.width, dimensions.height),
      };
      await this._saveAerialOverlay(overlay);
      this._aerialCalibrationDraft = [];
      this._aerialCalibrationTransform = this._normalizeAffineAerialTransform(overlay.transform)
        || this._defaultAerialTransform(dimensions.width, dimensions.height);
      this._saveAerialPlacementDraft(this._aerialCalibrationTransform, this._aerialCalibrationDraft);
      this._aerialPendingImagePoint = null;
      this._aerialCalibrationStep = "image";
      this._aerialCalibrationMode = true;
      this._aerialOverlayVisible = true;
      this._aerialPanelOpen = true;
      this._aerialOverlayNotice = "Image uploaded. Shift-drag to move, wheel to scale, Ctrl-wheel to rotate.";
      this._markAerialPlacementClean();
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._aerialOverlaySaving = false;
      this._render();
    }
  }

  _readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Could not read image file."));
        }
      });
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image file.")));
      reader.readAsDataURL(file);
    });
  }

  _imageDimensions(imageData) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => {
        resolve({
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
      });
      image.addEventListener("error", () => reject(new Error("Could not load image dimensions.")));
      image.src = imageData;
    });
  }

  async _importAerialPlacementFile(file) {
    if (!file) {
      return;
    }

    this._aerialOverlaySaving = true;
    this._aerialOverlayNotice = "Importing background image placement...";
    this._render();

    try {
      const raw = await this._readFileAsText(file);
      const payload = JSON.parse(raw);
      const imported = this._normalizeAerialPlacementImport(payload);
      if (!imported) {
        throw new Error("The selected file is not a valid S2JYarbo background image placement export.");
      }

      const currentOverlay = this._entry?.aerial_overlay || null;
      if (!currentOverlay?.image_data && !imported.image_data) {
        throw new Error("Upload the background image first, then import its placement data.");
      }

      const overlay = {
        ...(currentOverlay || {}),
        ...(imported.image_data ? { image_data: imported.image_data } : {}),
        image_width: imported.image_width || currentOverlay?.image_width,
        image_height: imported.image_height || currentOverlay?.image_height,
        opacity: imported.opacity ?? currentOverlay?.opacity ?? 0.62,
        points: [],
        transform: imported.transform,
      };

      if (!overlay.image_data || !overlay.image_width || !overlay.image_height) {
        throw new Error("The import needs either a full image backup or an already uploaded image.");
      }

      this._entry = {
        ...this._entry,
        aerial_overlay: overlay,
      };
      this._aerialPanelOpen = true;
      this._aerialOverlayVisible = true;
      this._aerialCalibrationMode = true;
      this._aerialCalibrationTransform = imported.transform;
      this._aerialCalibrationDraft = [];
      this._aerialPendingImagePoint = null;
      this._aerialCalibrationStep = "image";
      this._saveAerialPlacementDraft(imported.transform, []);
      this._aerialOverlayNotice = "Placement imported. Review it, then Save placement.";
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._aerialOverlaySaving = false;
      this._render();
    }
  }

  _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Could not read import file."));
        }
      });
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read import file.")));
      reader.readAsText(file);
    });
  }

  _normalizeAerialPlacementImport(payload) {
    const source = payload?.aerial_overlay || payload?.background_image || payload;
    const transform = this._normalizeAffineAerialTransform(source?.transform);
    if (!source || !transform) {
      return null;
    }

    const imageWidth = Number(source.image_width ?? source.imageWidth);
    const imageHeight = Number(source.image_height ?? source.imageHeight);
    const opacity = Number(source.opacity);
    const imported = {
      transform,
      image_width: Number.isFinite(imageWidth) && imageWidth > 0 ? imageWidth : null,
      image_height: Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight : null,
      opacity: Number.isFinite(opacity) ? Math.max(0.1, Math.min(1, opacity)) : null,
    };
    if (typeof source.image_data === "string" && source.image_data.startsWith("data:image/")) {
      imported.image_data = source.image_data;
    }
    return imported;
  }

  _exportAerialPlacement() {
    const overlay = this._entry?.aerial_overlay;
    const transform = this._currentAerialTransform(overlay);
    if (!overlay?.image_data || !transform) {
      this._aerialOverlayNotice = "Upload a background image before exporting placement data.";
      this._render();
      return;
    }

    const payload = {
      type: "s2jyarbo-background-image-placement",
      version: 1,
      exported_at: new Date().toISOString(),
      entry_id: this._entry?.entry_id || null,
      image_width: Number(overlay.image_width) || null,
      image_height: Number(overlay.image_height) || null,
      opacity: Number.isFinite(Number(overlay.opacity)) ? Number(overlay.opacity) : 0.62,
      transform: this._normalizeAffineAerialTransform(transform),
    };
    const safeName = String(this._entry?.title || this._entry?.entry_id || "yarbo")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "yarbo";
    this._downloadJson(`${safeName}-background-image-placement.json`, payload);
    this._aerialOverlayNotice = "Placement exported.";
    this._render();
  }

  _downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    this.shadowRoot?.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  _defaultAerialTransform(width, height) {
    const drawing = this._lastDrawing;
    const imageWidth = Math.max(1, Number(width) || 1);
    const imageHeight = Math.max(1, Number(height) || 1);
    if (!drawing) {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    const scale = Math.min(
      drawing.viewBoxWidth / imageWidth,
      drawing.viewBoxHeight / imageHeight,
    );
    return {
      a: scale,
      b: 0,
      c: 0,
      d: scale,
      e: drawing.viewBoxX + (drawing.viewBoxWidth - imageWidth * scale) / 2,
      f: -drawing.viewBoxY - drawing.viewBoxHeight + (drawing.viewBoxHeight - imageHeight * scale) / 2,
    };
  }

  _toggleAerialCalibrationMode() {
    const overlay = this._entry?.aerial_overlay;
    if (!overlay?.image_data) {
      return;
    }

    this._aerialCalibrationMode = !this._aerialCalibrationMode;
    this._aerialCalibrationDraft = this._aerialCalibrationMode && Array.isArray(overlay.points)
      ? overlay.points.map((pair) => ({
          image: { ...pair.image },
          map: { ...pair.map },
        }))
      : [];
    if (this._aerialCalibrationMode) {
      const storedDraft = this._loadAerialPlacementDraft(overlay);
      this._aerialCalibrationDraft = storedDraft?.points?.length
        ? storedDraft.points
        : this._aerialCalibrationDraft;
      this._aerialCalibrationTransform = storedDraft?.transform
        || this._normalizeAffineAerialTransform(overlay.transform)
        || this._defaultAerialTransform(overlay.image_width, overlay.image_height);
      this._saveAerialPlacementDraft(this._aerialCalibrationTransform, this._aerialCalibrationDraft);
    } else {
      this._clearAerialPlacementDraft();
      this._aerialCalibrationTransform = null;
    }
    this._aerialPendingImagePoint = null;
    this._aerialCalibrationStep = "image";
    this._aerialOverlayNotice = this._aerialCalibrationMode
      ? "Manually place the image. Shift-drag moves it, wheel scales it, Ctrl-wheel rotates it."
      : "Background image placement paused.";
    this._render();
  }

  _closeAerialPanel() {
    if (this._hasUnsavedAerialPlacementChanges()) {
      this._openUnsavedChangesDialog("close-aerial-panel");
      return;
    }

    this._aerialPanelOpen = false;
    this._aerialCalibrationMode = false;
    this._aerialCalibrationTransform = null;
    this._aerialPendingImagePoint = null;
    this._aerialCalibrationStep = "image";
    this._clearAerialPlacementDraft();
    this._aerialOverlayNotice = "";
    this._render();
  }

  async _saveAerialCalibration() {
    const overlay = this._entry?.aerial_overlay;
    const transform = this._currentAerialTransform(overlay);
    if (!overlay?.image_data || !transform) {
      return;
    }

    this._aerialOverlaySaving = true;
    this._render();
    try {
      await this._saveAerialOverlay({
        ...overlay,
        points: [],
        transform,
      });
      this._aerialCalibrationMode = false;
      this._clearAerialPlacementDraft();
      this._aerialCalibrationTransform = null;
      this._aerialPendingImagePoint = null;
      this._aerialCalibrationStep = "image";
      this._aerialCalibrationDraft = [];
      this._aerialOverlayNotice = "Aerial image placement saved.";
      this._markAerialPlacementClean();
      return true;
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    } finally {
      this._aerialOverlaySaving = false;
      this._render();
    }
  }

  async _updateAerialOpacity(opacity) {
    const overlay = this._entry?.aerial_overlay;
    if (!overlay?.image_data) {
      return;
    }

    try {
      await this._saveAerialOverlay({
        ...overlay,
        opacity: Math.max(0.1, Math.min(1, Number(opacity) || 0.62)),
      });
      this._markAerialPlacementClean();
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      this._render();
    }
  }

  _currentAerialTransform(overlay = this._entry?.aerial_overlay) {
    if (this._aerialCalibrationMode && this._aerialCalibrationTransform) {
      return this._aerialCalibrationTransform;
    }
    const storedDraft = this._loadAerialPlacementDraft(overlay);
    if (storedDraft?.transform) {
      if (!this._aerialCalibrationTransform) {
        this._aerialCalibrationTransform = storedDraft.transform;
      }
      if (!this._aerialCalibrationDraft.length && Array.isArray(storedDraft.points)) {
        this._aerialCalibrationDraft = storedDraft.points;
      }
      return storedDraft.transform;
    }
    return overlay?.transform || null;
  }

  _aerialPlacementDraftKey(overlay = this._entry?.aerial_overlay) {
    const entryId = this._entry?.entry_id;
    if (!entryId || !overlay?.image_data) {
      return "";
    }
    return `s2jyarbo:aerial-placement:${entryId}`;
  }

  _saveAerialPlacementDraft(transform, points = this._aerialCalibrationDraft) {
    const key = this._aerialPlacementDraftKey();
    const normalized = this._normalizeAffineAerialTransform(transform);
    if (!key || !normalized) {
      return;
    }

    try {
      window.sessionStorage?.setItem(
        key,
        JSON.stringify({
          transform: normalized,
          points: Array.isArray(points) ? points : [],
          updated_at: Date.now(),
        }),
      );
    } catch (_err) {
      // Placement still works without session storage; it just cannot survive parent refreshes.
    }
  }

  _loadAerialPlacementDraft(overlay = this._entry?.aerial_overlay) {
    const key = this._aerialPlacementDraftKey(overlay);
    if (!key) {
      return null;
    }

    try {
      const raw = window.sessionStorage?.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (Date.now() - Number(parsed?.updated_at || 0) > 30 * 60 * 1000) {
        window.sessionStorage?.removeItem(key);
        return null;
      }
      const transform = this._normalizeAffineAerialTransform(parsed?.transform);
      if (!transform) {
        return null;
      }
      const points = Array.isArray(parsed?.points)
        ? parsed.points
            .filter((pair) =>
              Number.isFinite(Number(pair?.image?.x))
              && Number.isFinite(Number(pair?.image?.y))
              && Number.isFinite(Number(pair?.map?.x))
              && Number.isFinite(Number(pair?.map?.y))
            )
            .map((pair) => ({
              image: { x: Number(pair.image.x), y: Number(pair.image.y) },
              map: { x: Number(pair.map.x), y: Number(pair.map.y) },
            }))
        : [];
      return { transform, points };
    } catch (_err) {
      return null;
    }
  }

  _clearAerialPlacementDraft() {
    const key = this._aerialPlacementDraftKey();
    if (!key) {
      return;
    }
    try {
      window.sessionStorage?.removeItem(key);
    } catch (_err) {
      // No-op.
    }
  }

  _aerialPlacementSignature() {
    const overlay = this._entry?.aerial_overlay || null;
    const transform = this._currentAerialTransform(overlay);
    return JSON.stringify({
      hasImage: Boolean(overlay?.image_data),
      imageWidth: Number.isFinite(Number(overlay?.image_width)) ? Number(overlay.image_width) : null,
      imageHeight: Number.isFinite(Number(overlay?.image_height)) ? Number(overlay.image_height) : null,
      opacity: Number.isFinite(Number(overlay?.opacity)) ? Number(overlay.opacity) : null,
      transform: transform ? this._normalizeAffineAerialTransform(transform) : null,
    });
  }

  _cloneAerialOverlay(overlay = this._entry?.aerial_overlay) {
    if (!overlay) {
      return null;
    }

    return {
      ...overlay,
      points: Array.isArray(overlay.points)
        ? overlay.points.map((pair) => ({
            image: pair?.image ? { ...pair.image } : null,
            map: pair?.map ? { ...pair.map } : null,
          }))
        : [],
      transform: overlay.transform ? { ...overlay.transform } : null,
    };
  }

  _markAerialPlacementClean() {
    this._aerialPlacementOriginalSignature = this._aerialPlacementSignature();
    this._aerialPlacementOriginalOverlay = this._cloneAerialOverlay();
  }

  _hasUnsavedAerialPlacementChanges() {
    if (!this._editMode || !this._aerialPanelOpen) {
      return false;
    }

    if (!this._aerialPlacementOriginalSignature) {
      this._markAerialPlacementClean();
      return false;
    }

    return this._aerialPlacementSignature() !== this._aerialPlacementOriginalSignature;
  }

  _discardAerialPlacementChanges(options = {}) {
    const { render = true } = options;
    if (this._entry) {
      this._entry = {
        ...this._entry,
        aerial_overlay: this._cloneAerialOverlay(this._aerialPlacementOriginalOverlay),
      };
    }
    this._aerialCalibrationMode = false;
    this._aerialCalibrationTransform = null;
    this._aerialCalibrationDraft = [];
    this._aerialPendingImagePoint = null;
    this._aerialCalibrationStep = "image";
    this._aerialPanelOpen = false;
    this._clearAerialPlacementDraft();
    this._aerialOverlayNotice = "";
    this._markAerialPlacementClean();
    if (render) {
      this._render();
    }
  }

  _setAerialOverlayTransform(transform, points = this._aerialCalibrationDraft) {
    const overlay = this._entry?.aerial_overlay;
    if (!overlay?.image_data || !transform) {
      return false;
    }

    const normalized = this._normalizeAffineAerialTransform(transform);
    if (!normalized) {
      return false;
    }

    if (this._aerialCalibrationMode) {
      this._aerialCalibrationTransform = normalized;
      this._saveAerialPlacementDraft(normalized, points);
    }

    this._entry = {
      ...this._entry,
      aerial_overlay: {
        ...overlay,
        points: Array.isArray(points) ? points : [],
        transform: normalized,
      },
    };
    return true;
  }

  _normalizeAffineAerialTransform(transform) {
    const normalized = {
      a: Number(transform.a),
      b: Number(transform.b),
      c: Number(transform.c),
      d: Number(transform.d),
      e: Number(transform.e),
      f: Number(transform.f),
    };
    return Object.values(normalized).every(Number.isFinite) ? normalized : null;
  }

  _adjustAerialTransformInPlace(operation, notice) {
    const overlay = this._entry?.aerial_overlay;
    const baseTransform = this._currentAerialTransform(overlay);
    if (!overlay?.image_data || !baseTransform) {
      return false;
    }

    const transform = this._multiplyAerialAffineMatrices(operation, baseTransform);
    if (!this._setAerialOverlayTransform(transform)) {
      this._aerialOverlayNotice = "Failed: could not adjust aerial image.";
      this._render();
      return false;
    }

    this._aerialOverlayNotice = notice;
    this._render();
    return true;
  }

  _translateAerialOverlay(deltaX, deltaY) {
    return this._adjustAerialTransformInPlace(
      { a: 1, b: 0, c: 0, d: 1, e: deltaX, f: deltaY },
      "Aerial image moved. Save placement when it looks right.",
    );
  }

  _scaleAerialOverlayAt(anchor, scaleFactor) {
    const factor = Math.max(0.2, Math.min(5, Number(scaleFactor) || 1));
    if (!anchor || Math.abs(factor - 1) < 0.000001) {
      return false;
    }
    return this._adjustAerialTransformAroundCursor(
      anchor,
      {
        a: factor,
        b: 0,
        c: 0,
        d: factor,
        e: Number(anchor.x) - factor * Number(anchor.x),
        f: Number(anchor.y) - factor * Number(anchor.y),
      },
      "Aerial image scaled. Save placement when it looks right.",
    );
  }

  _rotateAerialOverlayAt(anchor, deltaAngle) {
    const angle = Number(deltaAngle);
    if (!anchor || !Number.isFinite(angle) || Math.abs(angle) < 0.000001) {
      return false;
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return this._adjustAerialTransformAroundCursor(
      anchor,
      {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: Number(anchor.x) - cos * Number(anchor.x) + sin * Number(anchor.y),
        f: Number(anchor.y) - sin * Number(anchor.x) - cos * Number(anchor.y),
      },
      "Aerial image rotated. Save placement when it looks right.",
    );
  }

  _adjustAerialTransformAroundCursor(anchor, operation, notice) {
    const overlay = this._entry?.aerial_overlay;
    const baseTransform = this._currentAerialTransform(overlay);
    if (!overlay?.image_data || !baseTransform || !anchor || !operation) {
      return false;
    }

    const imageAnchor = this._inverseTransformAerialPoint(anchor, baseTransform);
    if (!imageAnchor) {
      return false;
    }

    const nextTransform = this._multiplyAerialAffineMatrices(operation, baseTransform);
    if (!nextTransform) {
      return false;
    }

    const movedAnchor = this._transformAerialImagePoint(imageAnchor, nextTransform);
    if (!movedAnchor) {
      return false;
    }

    nextTransform.e += Number(anchor.x) - Number(movedAnchor.x);
    nextTransform.f += Number(anchor.y) - Number(movedAnchor.y);
    if (!this._setAerialOverlayTransform(nextTransform)) {
      this._aerialOverlayNotice = "Failed: could not adjust aerial image.";
      this._render();
      return false;
    }

    this._aerialOverlayNotice = notice;
    this._render();
    return true;
  }

  async _adjustAerialTransform(action) {
    const overlay = this._entry?.aerial_overlay;
    if (!overlay?.image_data || this._aerialOverlaySaving) {
      return;
    }

    const transform = this._aerialAdjustmentTransform(overlay, action);
    if (!transform) {
      this._aerialOverlayNotice = "Failed: could not adjust aerial image.";
      this._render();
      return;
    }

    this._aerialOverlaySaving = true;
    this._render();
    try {
      await this._saveAerialOverlay({
        ...overlay,
        points: [],
        transform,
      });
      this._aerialCalibrationDraft = [];
      this._aerialPendingImagePoint = null;
      this._aerialCalibrationStep = "image";
      this._aerialCalibrationMode = true;
      this._aerialOverlayVisible = true;
      this._aerialOverlayNotice = "Image adjusted. Continue manual placement or save.";
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._aerialOverlaySaving = false;
      this._render();
    }
  }

  _aerialAdjustmentTransform(overlay, action) {
    const base = overlay.transform || this._defaultAerialTransform(
      overlay.image_width,
      overlay.image_height,
    );
    const width = Math.max(1, Number(overlay.image_width) || 1);
    const height = Math.max(1, Number(overlay.image_height) || 1);
    const cx = width / 2;
    const cy = height / 2;
    const operation = this._aerialImageSpaceOperation(action, cx, cy);
    return operation ? this._multiplyAerialMatrices(base, operation) : null;
  }

  _aerialImageSpaceOperation(action, cx, cy) {
    let linear = null;
    if (action === "rotate-left") {
      linear = { a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 };
    } else if (action === "rotate-right") {
      linear = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    } else if (action === "flip-horizontal") {
      linear = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    } else if (action === "flip-vertical") {
      linear = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };
    }
    if (!linear) {
      return null;
    }

    const translated = this._multiplyAerialMatrices(
      { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy },
      linear,
    );
    return translated
      ? this._multiplyAerialMatrices(
          translated,
          { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
        )
      : null;
  }

  _multiplyAerialMatrices(left, right) {
    if (!left || !right) {
      return null;
    }
    const a =
      Number(left.a) * Number(right.a)
      + Number(left.c) * Number(right.b)
      + Number(left.e) * Number(right.g || 0);
    const b =
      Number(left.b) * Number(right.a)
      + Number(left.d) * Number(right.b)
      + Number(left.f) * Number(right.g || 0);
    const c =
      Number(left.a) * Number(right.c)
      + Number(left.c) * Number(right.d)
      + Number(left.e) * Number(right.h || 0);
    const d =
      Number(left.b) * Number(right.c)
      + Number(left.d) * Number(right.d)
      + Number(left.f) * Number(right.h || 0);
    const e =
      Number(left.a) * Number(right.e)
      + Number(left.c) * Number(right.f)
      + Number(left.e);
    const f =
      Number(left.b) * Number(right.e)
      + Number(left.d) * Number(right.f)
      + Number(left.f);
    const g =
      Number(left.g || 0) * Number(right.a)
      + Number(left.h || 0) * Number(right.b)
      + Number(right.g || 0);
    const h =
      Number(left.g || 0) * Number(right.c)
      + Number(left.h || 0) * Number(right.d)
      + Number(right.h || 0);
    const i =
      Number(left.g || 0) * Number(right.e)
      + Number(left.h || 0) * Number(right.f)
      + 1;
    if (!Number.isFinite(i) || Math.abs(i) < 1e-12) {
      return null;
    }
    const result = {
      a: a / i,
      b: b / i,
      c: c / i,
      d: d / i,
      e: e / i,
      f: f / i,
    };
    if (Math.abs(g / i) > 1e-12) {
      result.g = g / i;
    }
    if (Math.abs(h / i) > 1e-12) {
      result.h = h / i;
    }
    return result;
  }

  _multiplyAerialAffineMatrices(left, right) {
    return {
      a: Number(left.a) * Number(right.a) + Number(left.c) * Number(right.b),
      b: Number(left.b) * Number(right.a) + Number(left.d) * Number(right.b),
      c: Number(left.a) * Number(right.c) + Number(left.c) * Number(right.d),
      d: Number(left.b) * Number(right.c) + Number(left.d) * Number(right.d),
      e: Number(left.a) * Number(right.e) + Number(left.c) * Number(right.f) + Number(left.e),
      f: Number(left.b) * Number(right.e) + Number(left.d) * Number(right.f) + Number(left.f),
    };
  }

  async _clearAerialOverlay() {
    if (!this._hass || !this._entry?.entry_id) {
      return;
    }

    this._aerialOverlaySaving = true;
    this._render();
    try {
      await this._hass.callApi(
        "DELETE",
        `s2jyarbo/aerial_overlay?entry_id=${encodeURIComponent(this._entry.entry_id)}`,
      );
      this._entry = {
        ...this._entry,
        aerial_overlay: null,
      };
      this._aerialCalibrationMode = false;
      this._aerialCalibrationDraft = [];
      this._aerialCalibrationTransform = null;
      this._clearAerialPlacementDraft();
      this._aerialPendingImagePoint = null;
      this._aerialOverlayNotice = "Aerial overlay cleared.";
      this._aerialPanelOpen = false;
      this._markAerialPlacementClean();
    } catch (err) {
      this._aerialOverlayNotice = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._aerialOverlaySaving = false;
      this._render();
    }
  }

  _confirmClearAerialOverlay() {
    if (!this._entry?.aerial_overlay?.image_data) {
      return;
    }

    const confirmed = window.confirm(
      "Clear the saved background image and its placement for this map?",
    );
    if (!confirmed) {
      return;
    }

    void this._clearAerialOverlay();
  }

  async _saveAerialOverlay(overlay) {
    if (!this._hass || !this._entry?.entry_id) {
      throw new Error("Home Assistant is not ready.");
    }

    const response = await this._hass.callApi("POST", "s2jyarbo/aerial_overlay", {
      entry_id: this._entry.entry_id,
      aerial_overlay: overlay,
    });
    this._entry = {
      ...this._entry,
      aerial_overlay: response?.aerial_overlay || overlay,
    };
  }

  _displayPointFromSvgEvent(svg, event) {
    const localPoint = this._localPointFromSvgEvent(svg, event);
    return localPoint ? this._displayPoint(localPoint) : null;
  }

  _aerialTransformFromPoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return null;
    }

    return this._affineAerialTransformFromPoints(points);
  }

  _affineAerialTransformFromPoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return null;
    }
    const ata = Array.from({ length: 6 }, () => Array(6).fill(0));
    const atb = Array(6).fill(0);
    for (const pair of points) {
      const imageX = Number(pair?.image?.x);
      const imageY = Number(pair?.image?.y);
      const mapX = Number(pair?.map?.x);
      const mapY = Number(pair?.map?.y);
      if (![imageX, imageY, mapX, mapY].every(Number.isFinite)) {
        continue;
      }

      const rows = [
        [[imageX, imageY, 1, 0, 0, 0], mapX],
        [[0, 0, 0, imageX, imageY, 1], mapY],
      ];
      for (const [row, target] of rows) {
        for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
          atb[rowIndex] += row[rowIndex] * target;
          for (let colIndex = 0; colIndex < 6; colIndex += 1) {
            ata[rowIndex][colIndex] += row[rowIndex] * row[colIndex];
          }
        }
      }
    }

    const solved = this._solveLinearSystem(ata, atb);
    return solved
      ? { a: solved[0], c: solved[1], e: solved[2], b: solved[3], d: solved[4], f: solved[5] }
      : null;
  }

  _projectiveAerialTransformFromPoints(points) {
    const ata = Array.from({ length: 8 }, () => Array(8).fill(0));
    const atb = Array(8).fill(0);

    for (const pair of points) {
      const imageX = Number(pair?.image?.x);
      const imageY = Number(pair?.image?.y);
      const mapX = Number(pair?.map?.x);
      const mapY = Number(pair?.map?.y);
      if (![imageX, imageY, mapX, mapY].every(Number.isFinite)) {
        continue;
      }

      const rows = [
        [[imageX, imageY, 1, 0, 0, 0, -mapX * imageX, -mapX * imageY], mapX],
        [[0, 0, 0, imageX, imageY, 1, -mapY * imageX, -mapY * imageY], mapY],
      ];
      for (const [row, target] of rows) {
        for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
          atb[rowIndex] += row[rowIndex] * target;
          for (let colIndex = 0; colIndex < 8; colIndex += 1) {
            ata[rowIndex][colIndex] += row[rowIndex] * row[colIndex];
          }
        }
      }
    }

    const solved = this._solveLinearSystem(ata, atb);
    return solved
      ? {
          a: solved[0],
          c: solved[1],
          e: solved[2],
          b: solved[3],
          d: solved[4],
          f: solved[5],
          g: solved[6],
          h: solved[7],
        }
      : null;
  }

  _solveLinearSystem(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);

    for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
      let bestRow = pivotIndex;
      for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
        if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[bestRow][pivotIndex])) {
          bestRow = rowIndex;
        }
      }
      if (Math.abs(augmented[bestRow][pivotIndex]) < 1e-9) {
        return null;
      }
      if (bestRow !== pivotIndex) {
        [augmented[pivotIndex], augmented[bestRow]] = [augmented[bestRow], augmented[pivotIndex]];
      }

      const pivot = augmented[pivotIndex][pivotIndex];
      for (let colIndex = pivotIndex; colIndex <= size; colIndex += 1) {
        augmented[pivotIndex][colIndex] /= pivot;
      }

      for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
        if (rowIndex === pivotIndex) {
          continue;
        }
        const factor = augmented[rowIndex][pivotIndex];
        for (let colIndex = pivotIndex; colIndex <= size; colIndex += 1) {
          augmented[rowIndex][colIndex] -= factor * augmented[pivotIndex][colIndex];
        }
      }
    }

    return augmented.map((row) => row[size]);
  }

  _transformAerialImagePoint(point, transform) {
    if (!point || !transform) {
      return null;
    }
    const x = Number(point.x);
    const y = Number(point.y);
    const denominator = Number(transform.g || 0) * x + Number(transform.h || 0) * y + 1;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
      return null;
    }
    return {
      x: (Number(transform.a) * x + Number(transform.c) * y + Number(transform.e)) / denominator,
      y: (Number(transform.b) * x + Number(transform.d) * y + Number(transform.f)) / denominator,
    };
  }

  _inverseTransformAerialPoint(point, transform) {
    if (!point || !transform) {
      return null;
    }
    const inverse = this._invertAerialMatrix(transform);
    if (!inverse) {
      return null;
    }
    return this._transformAerialImagePoint(point, inverse);
  }

  _isProjectiveAerialTransform(transform) {
    return Boolean(
      transform
      && (Math.abs(Number(transform.g) || 0) > 1e-12 || Math.abs(Number(transform.h) || 0) > 1e-12)
    );
  }

  _invertAerialMatrix(transform) {
    const a = Number(transform.a);
    const b = Number(transform.b);
    const c = Number(transform.c);
    const d = Number(transform.d);
    const e = Number(transform.e);
    const f = Number(transform.f);
    const g = Number(transform.g || 0);
    const h = Number(transform.h || 0);
    const determinant =
      a * (d - f * h)
      - c * (b - f * g)
      + e * (b * h - d * g);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
      return null;
    }
    const bottomRight = (a * d - c * b) / determinant;
    if (!Number.isFinite(bottomRight) || Math.abs(bottomRight) < 1e-12) {
      return null;
    }
    return this._normalizeAerialMatrix({
      a: (d - f * h) / determinant,
      c: (e * h - c) / determinant,
      e: (c * f - e * d) / determinant,
      b: (f * g - b) / determinant,
      d: (a - e * g) / determinant,
      f: (e * b - a * f) / determinant,
      g: (b * h - d * g) / determinant,
      h: (c * g - a * h) / determinant,
      i: bottomRight,
    });
  }

  _normalizeAerialMatrix(transform) {
    const bottomRight = Number(transform.i ?? 1);
    if (!Number.isFinite(bottomRight) || Math.abs(bottomRight) < 1e-12) {
      return null;
    }
    const normalized = {
      a: Number(transform.a) / bottomRight,
      b: Number(transform.b) / bottomRight,
      c: Number(transform.c) / bottomRight,
      d: Number(transform.d) / bottomRight,
      e: Number(transform.e) / bottomRight,
      f: Number(transform.f) / bottomRight,
    };
    const g = Number(transform.g || 0) / bottomRight;
    const h = Number(transform.h || 0) / bottomRight;
    if (Math.abs(g) > 1e-12) {
      normalized.g = g;
    }
    if (Math.abs(h) > 1e-12) {
      normalized.h = h;
    }
    return normalized;
  }

  _aerialSvgId(suffix) {
    const entryId = this._entry?.entry_id || "entry";
    return `s2jyarbo-aerial-${entryId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  _affineFromTriangles(sourceTriangle, targetTriangle) {
    const matrix = [
      [sourceTriangle[0].x, sourceTriangle[0].y, 1, 0, 0, 0],
      [0, 0, 0, sourceTriangle[0].x, sourceTriangle[0].y, 1],
      [sourceTriangle[1].x, sourceTriangle[1].y, 1, 0, 0, 0],
      [0, 0, 0, sourceTriangle[1].x, sourceTriangle[1].y, 1],
      [sourceTriangle[2].x, sourceTriangle[2].y, 1, 0, 0, 0],
      [0, 0, 0, sourceTriangle[2].x, sourceTriangle[2].y, 1],
    ];
    const vector = [
      targetTriangle[0].x,
      targetTriangle[0].y,
      targetTriangle[1].x,
      targetTriangle[1].y,
      targetTriangle[2].x,
      targetTriangle[2].y,
    ];
    const solved = this._solveLinearSystem(matrix, vector);
    return solved
      ? { a: solved[0], c: solved[1], e: solved[2], b: solved[3], d: solved[4], f: solved[5] }
      : null;
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

    body.querySelector('[data-action="aerial-toggle"]')?.addEventListener("click", () => {
      this._aerialOverlayVisible = !this._aerialOverlayVisible;
      this._render();
    });

    body.querySelector('[data-action="aerial-upload"]')?.addEventListener("click", () => {
      const input = body.querySelector(".aerial-file-input");
      if (input instanceof HTMLInputElement) {
        input.click();
      }
    });

    const aerialFileInput = body.querySelector(".aerial-file-input");
    if (aerialFileInput instanceof HTMLInputElement) {
      aerialFileInput.addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0] || null;
        if (file) {
          void this._uploadAerialImage(file);
        }
        event.currentTarget.value = "";
      });
    }

    body.querySelector('[data-action="aerial-import"]')?.addEventListener("click", () => {
      const input = body.querySelector(".aerial-import-input");
      if (input instanceof HTMLInputElement) {
        input.click();
      }
    });

    const aerialImportInput = body.querySelector(".aerial-import-input");
    if (aerialImportInput instanceof HTMLInputElement) {
      aerialImportInput.addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0] || null;
        if (file) {
          void this._importAerialPlacementFile(file);
        }
        event.currentTarget.value = "";
      });
    }

    body.querySelector('[data-action="aerial-export"]')?.addEventListener("click", () => {
      this._exportAerialPlacement();
    });

    const aerialOpacity = body.querySelector(".aerial-opacity");
    if (aerialOpacity instanceof HTMLInputElement) {
      aerialOpacity.addEventListener("change", (event) => {
        const value = event.currentTarget instanceof HTMLInputElement
          ? Number(event.currentTarget.value)
          : 0.62;
        void this._updateAerialOpacity(value);
      });
    }

    body.querySelector('[data-action="aerial-rotate-left"]')?.addEventListener("click", () => {
      void this._adjustAerialTransform("rotate-left");
    });

    body.querySelector('[data-action="aerial-rotate-right"]')?.addEventListener("click", () => {
      void this._adjustAerialTransform("rotate-right");
    });

    body.querySelector('[data-action="aerial-flip-horizontal"]')?.addEventListener("click", () => {
      void this._adjustAerialTransform("flip-horizontal");
    });

    body.querySelector('[data-action="aerial-flip-vertical"]')?.addEventListener("click", () => {
      void this._adjustAerialTransform("flip-vertical");
    });

    body.querySelector('[data-action="aerial-calibrate"]')?.addEventListener("click", () => {
      this._toggleAerialCalibrationMode();
    });

    body.querySelector('[data-action="aerial-panel-close"]')?.addEventListener("click", () => {
      this._closeAerialPanel();
    });

    body.querySelector('[data-action="aerial-save"]')?.addEventListener("click", () => {
      void this._saveAerialCalibration();
    });

    body.querySelector('[data-action="aerial-clear"]')?.addEventListener("click", () => {
      this._confirmClearAerialOverlay();
    });

    body.querySelector('[data-action="edit-mode"]')?.addEventListener("click", () => {
      void this._handleEditModeButtonClick();
    });

    body.querySelector('[data-action="edit-confirm-accept"]')?.addEventListener("click", () => {
      void this._acceptEditConfirmation();
    });

    body.querySelector('[data-action="edit-confirm-cancel"]')?.addEventListener("click", () => {
      this._cancelEditConfirmation();
    });

    body.querySelector('[data-action="unsaved-yes"]')?.addEventListener("click", () => {
      this._confirmUnsavedChangesDiscard();
    });

    body.querySelector('[data-action="unsaved-no"]')?.addEventListener("click", () => {
      this._dismissUnsavedChangesDialog();
    });

    body.querySelector('[data-action="unsaved-save"]')?.addEventListener("click", () => {
      this._saveUnsavedChangesDialog();
    });

    body.querySelector('[data-action="edit-tools"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      this._editToolsExpanded = !this._editToolsExpanded;
      this._render();
    });

    body.querySelector('[data-action="background-image"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      if (this._aerialPanelOpen) {
        this._closeAerialPanel();
        return;
      }
      this._aerialPanelOpen = true;
      this._markAerialPlacementClean();
      this._editToolsExpanded = false;
      this._render();
    });

    body.querySelector('[data-action="tool-pa"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      this._beginPathwayDraftSession();
    });

    body.querySelector('[data-action="tool-ng"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      this._beginNoGoZoneDraftSession();
    });

    body.querySelector('[data-action="tool-wp"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      this._activeEditTool = "wp";
      this._editToolsExpanded = false;
      this._pathwayDraftNotice = "Wp editing is not implemented yet.";
      this._render();
    });

    body.querySelector('[data-action="tool-mp"]')?.addEventListener("click", () => {
      if (!this._editMode) {
        return;
      }
      this._beginMemoryPathDraftSession();
    });

    body.querySelector('[data-action="pathway-edit"]')?.addEventListener("click", () => {
      this._beginSelectedPathwayEdit();
    });

    body.querySelector('[data-action="pathway-rename"]')?.addEventListener("click", () => {
      this._beginSelectedPathwayRename();
    });

    body.querySelector('[data-action="pathway-settings"]')?.addEventListener("click", () => {
      this._pathwayDraftNotice = "Pathway settings are not implemented yet.";
      this._render();
    });

    body.querySelector('[data-action="pathway-delete"]')?.addEventListener("click", () => {
      this._beginSelectedPathwayDelete();
    });

    body.querySelector('[data-action="memorypath-edit"]')?.addEventListener("click", () => {
      this._beginSelectedMemoryPathEdit();
    });

    body.querySelector('[data-action="memorypath-rename"]')?.addEventListener("click", () => {
      this._beginSelectedMemoryPathRename();
    });

    body.querySelector('[data-action="memorypath-settings"]')?.addEventListener("click", () => {
      this._beginSelectedMemoryPathSettings();
    });

    body.querySelector('[data-action="memorypath-delete"]')?.addEventListener("click", () => {
      this._beginSelectedMemoryPathDelete();
    });

    body.querySelector('[data-action="nogozone-edit"]')?.addEventListener("click", () => {
      this._beginSelectedNoGoZoneEdit();
    });

    body.querySelector('[data-action="nogozone-rename"]')?.addEventListener("click", () => {
      this._beginSelectedNoGoZoneRename();
    });

    body.querySelector('[data-action="nogozone-settings"]')?.addEventListener("click", () => {
      this._pathwayDraftNotice = "No-go zone settings are not implemented yet.";
      this._render();
    });

    body.querySelector('[data-action="nogozone-toggle-enable"]')?.addEventListener("click", () => {
      void this._toggleSelectedNoGoZoneEnabled();
    });

    body.querySelector('[data-action="nogozone-delete"]')?.addEventListener("click", () => {
      this._beginSelectedNoGoZoneDelete();
    });

    body.querySelector('[data-action="edit-accept"]')?.addEventListener("click", () => {
      this._acceptPathwayDraft();
    });

    body.querySelector('[data-action="edit-trimmer"]')?.addEventListener("click", () => {
      this._toggleMemoryPathTrimmerEdit();
    });

    body.querySelector('[data-action="toggle-auto-trimmer"]')?.addEventListener("click", () => {
      this._toggleMemoryPathAutoAddTrimmingEdges();
    });

    body.querySelector('[data-action="edit-cancel"]')?.addEventListener("click", () => {
      if (this._hasUnsavedEditorChanges()) {
        this._openUnsavedChangesDialog("cancel-draft");
        return;
      }
      this._cancelPathwayDraft();
    });

    body.querySelector('[data-action="pathway-name-confirm"]')?.addEventListener("click", () => {
      void this._confirmPathwayDraftName();
    });

    body.querySelector('[data-action="pathway-name-cancel"]')?.addEventListener("click", () => {
      this._dismissPathwayNameDialog();
    });

    body.querySelector('[data-action="pathway-delete-confirm"]')?.addEventListener("click", () => {
      void this._confirmDeleteSelectedPathway();
    });

    body.querySelector('[data-action="pathway-delete-cancel"]')?.addEventListener("click", () => {
      this._dismissPathwayDeleteDialog();
    });

    body.querySelector('[data-action="memorypath-settings-save"]')?.addEventListener("click", () => {
      void this._saveSelectedMemoryPathSettings();
    });

    body.querySelector('[data-action="memorypath-settings-cancel"]')?.addEventListener("click", () => {
      this._dismissMemoryPathSettingsDialog();
    });

    body.querySelector('[data-action="context-tocircle"]')?.addEventListener("click", () => {
      this._convertNoGoZoneDraftToCircle();
    });

    body.querySelector('[data-action="context-add-square"]')?.addEventListener("click", () => {
      this._addPresetNoGoZoneDraft("square");
    });

    body.querySelector('[data-action="context-add-circle"]')?.addEventListener("click", () => {
      this._addPresetNoGoZoneDraft("circle");
    });

    const pathwayNameInput = body.querySelector('[data-action="pathway-name-input"]');
    if (pathwayNameInput instanceof HTMLInputElement) {
      requestAnimationFrame(() => {
        pathwayNameInput.focus();
        pathwayNameInput.select();
      });
      pathwayNameInput.addEventListener("input", (event) => {
        if (event.currentTarget instanceof HTMLInputElement) {
          this._pathwayDraftPendingName = event.currentTarget.value;
        }
      });
      pathwayNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this._confirmPathwayDraftName();
        } else if (event.key === "Escape") {
          event.preventDefault();
          this._dismissPathwayNameDialog();
        }
      });
    }

    const memoryPathBladeToggle = body.querySelector('[data-action="memorypath-settings-blade"]');
    if (memoryPathBladeToggle instanceof HTMLInputElement) {
      memoryPathBladeToggle.addEventListener("change", (event) => {
        if (event.currentTarget instanceof HTMLInputElement) {
          this._memoryPathSettings.en_blade = event.currentTarget.checked;
        }
      });
    }

    for (const fieldName of ["blade_height", "plan_speed"]) {
      const input = body.querySelector(`[data-action="memorypath-settings-${fieldName}"]`);
      if (input instanceof HTMLInputElement) {
        input.addEventListener("input", (event) => {
          if (event.currentTarget instanceof HTMLInputElement) {
            this._memoryPathSettings[fieldName] = event.currentTarget.value;
          }
        });
      }
    }

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
    svg?.addEventListener("contextmenu", (event) => this._handleEditContextMenu(event));
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

    if (this._aerialCalibrationMode && this._handleAerialCalibrationWheel(svg, event)) {
      return;
    }

    if (this._editMode && event.ctrlKey && !event.shiftKey && this._resizeNoGoZoneFromWheel(event)) {
      return;
    }

    if (this._editMode && event.shiftKey && this._rotateSelectedOrDraftFromWheel(event)) {
      return;
    }

    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.0015)));
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const pointerX = viewBox.x + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * viewBox.width;
    const pointerY = viewBox.y + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * viewBox.height;
    this._zoom(factor, { x: pointerX, y: pointerY });
  }

  _handleAerialCalibrationWheel(svg, event) {
    const anchor = this._displayPointFromSvgEvent(svg, event);
    if (!anchor) {
      return true;
    }

    const delta = this._wheelDominantDelta(event) * this._wheelModeScale(event);
    if (event.ctrlKey) {
      const deltaAngle = Math.max(-Math.PI / 18, Math.min(Math.PI / 18, -delta * 0.002));
      this._rotateAerialOverlayAt(anchor, deltaAngle);
      return true;
    }

    const scaleFactor = Math.max(0.96, Math.min(1.04, Math.exp(-delta * 0.00035)));
    this._scaleAerialOverlayAt(anchor, scaleFactor);
    return true;
  }

  _rotateSelectedOrDraftFromWheel(event) {
    if (this._pathwayDraftSending || this._activeDrag) {
      return true;
    }

    if (!this._isDraftEditActive() && !this._prepareSelectedFeatureForTransform()) {
      return false;
    }

    const minimumPoints = this._pathwayDraftKind === "nogozone" ? 3 : 2;
    if (!Array.isArray(this._pathwayDraftPoints) || this._pathwayDraftPoints.length < minimumPoints) {
      this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
        ? "Select a no-go zone with at least three points before rotating."
        : this._pathwayDraftKind === "sidewalk"
          ? "Select a memory path with at least two points before rotating."
        : "Select a pathway with at least two points before rotating.";
      this._render();
      return true;
    }

    const rawAngle = -this._wheelDominantDelta(event) * this._wheelModeScale(event) * 0.002;
    const deltaAngle = Math.max(-Math.PI / 12, Math.min(Math.PI / 12, rawAngle));
    if (!Number.isFinite(deltaAngle) || Math.abs(deltaAngle) < 0.000001) {
      return true;
    }

    return this._rotatePathwayDraft(deltaAngle);
  }

  _resizeNoGoZoneFromWheel(event) {
    if (this._pathwayDraftSending || this._activeDrag) {
      return true;
    }

    if (!this._isDraftEditActive()) {
      const selectedNoGoZone = this._selectedNoGoZone();
      if (!selectedNoGoZone) {
        return false;
      }
      this._prepareSelectedNoGoZoneMove(selectedNoGoZone);
    }

    if (this._pathwayDraftKind !== "nogozone") {
      return false;
    }

    if (!Array.isArray(this._pathwayDraftPoints) || this._pathwayDraftPoints.length < 3) {
      this._pathwayDraftNotice = "Select a no-go zone with at least three points before resizing.";
      this._render();
      return true;
    }

    const rawScale = Math.exp(-this._wheelDominantDelta(event) * this._wheelModeScale(event) * 0.0015);
    const scaleFactor = Math.max(0.8, Math.min(1.2, rawScale));
    if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.000001) {
      return true;
    }

    return this._resizeNoGoZoneDraft(scaleFactor);
  }

  _wheelDominantDelta(event) {
    const deltaX = Number(event.deltaX);
    const deltaY = Number(event.deltaY);
    const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
    const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
    return Math.abs(safeDeltaY) >= Math.abs(safeDeltaX) ? safeDeltaY : safeDeltaX;
  }

  _wheelModeScale(event) {
    return event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
  }

  _prepareSelectedFeatureForTransform() {
    const selectedPathway = this._selectedPathway();
    const selectedMemoryPath = selectedPathway ? null : this._selectedMemoryPath();
    const selectedNoGoZone = selectedPathway || selectedMemoryPath ? null : this._selectedNoGoZone();
    if (selectedPathway) {
      this._prepareSelectedPathwayMove(selectedPathway);
      return true;
    }
    if (selectedMemoryPath) {
      this._prepareSelectedMemoryPathMove(selectedMemoryPath);
      return true;
    }
    if (selectedNoGoZone) {
      this._prepareSelectedNoGoZoneMove(selectedNoGoZone);
      return true;
    }
    return false;
  }

  _rotatePathwayDraft(deltaAngle) {
    const points = Array.isArray(this._pathwayDraftPoints) ? this._pathwayDraftPoints : [];
    const center = this._pointsCenter(points);
    if (!center) {
      this._pathwayDraftNotice = "Could not rotate the selected object because its points are invalid.";
      this._render();
      return true;
    }

    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);
    this._pathwayDraftPoints = points.map((point) => {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ...point };
      }

      const offsetX = x - center.x;
      const offsetY = y - center.y;
      return {
        ...point,
        x: center.x + offsetX * cos - offsetY * sin,
        y: center.y + offsetX * sin + offsetY * cos,
      };
    });
    if (this._pathwayDraftKind === "sidewalk" && Array.isArray(this._pathwayDraftTrimmingEdges)) {
      this._pathwayDraftTrimmingEdges = this._pathwayDraftTrimmingEdges.map((edge) => ({
        ...edge,
        points: Array.isArray(edge.points)
          ? edge.points.map((point) => {
              const x = Number(point.x);
              const y = Number(point.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return { ...point };
              }

              const offsetX = x - center.x;
              const offsetY = y - center.y;
              return {
                ...point,
                x: center.x + offsetX * cos - offsetY * sin,
                y: center.y + offsetX * sin + offsetY * cos,
              };
            })
          : [],
      }));
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
      ? "No-go zone rotated. Click tick to save or cross to cancel."
      : this._pathwayDraftKind === "sidewalk"
        ? "Memory path rotated. Click tick to save or cross to cancel."
      : "Pathway rotated. Click tick to save or cross to cancel.";
    this._editContextMenu = null;
    this._render();
    return true;
  }

  _resizeNoGoZoneDraft(scaleFactor) {
    const points = Array.isArray(this._pathwayDraftPoints) ? this._pathwayDraftPoints : [];
    const center = this._pointsCenter(points);
    if (!center) {
      this._pathwayDraftNotice = "Could not resize the selected no-go zone because its points are invalid.";
      this._render();
      return true;
    }

    const maxRadius = points.reduce((currentMax, point) => {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return currentMax;
      }
      return Math.max(currentMax, Math.hypot(x - center.x, y - center.y));
    }, 0);
    if (!Number.isFinite(maxRadius) || maxRadius <= 0.000001) {
      this._pathwayDraftNotice = "Could not resize the selected no-go zone because it has no usable area.";
      this._render();
      return true;
    }

    const minimumRadius = 0.05;
    const adjustedScaleFactor = scaleFactor < 1 && maxRadius * scaleFactor < minimumRadius
      ? minimumRadius / maxRadius
      : scaleFactor;

    this._pathwayDraftPoints = points.map((point) => {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ...point };
      }

      return {
        ...point,
        x: center.x + (x - center.x) * adjustedScaleFactor,
        y: center.y + (y - center.y) * adjustedScaleFactor,
      };
    });
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = "No-go zone resized. Click tick to save or cross to cancel.";
    this._editContextMenu = null;
    this._render();
    return true;
  }

  _pointsCenter(points) {
    const numericPoints = points
      .map((point) => ({
        x: Number(point?.x),
        y: Number(point?.y),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!numericPoints.length) {
      return null;
    }

    const total = numericPoints.reduce(
      (sum, point) => ({
        x: sum.x + point.x,
        y: sum.y + point.y,
      }),
      { x: 0, y: 0 },
    );
    return {
      x: total.x / numericPoints.length,
      y: total.y / numericPoints.length,
    };
  }

  _startDrag(event) {
    if (this._aerialCalibrationMode) {
      if (event.shiftKey) {
        this._startAerialImagePanDrag(event);
      }
      return;
    }

    if (event.button === 0 && this._editContextMenu) {
      this._editContextMenu = null;
      this._render();
      return;
    }

    if (this._editMode && this._isMemoryPathTrimmerEditActive()) {
      this._handleMemoryPathTrimmerPointerDown(event);
      return;
    }

    if (this._editMode && event.shiftKey && this._canAddConnectedDraftPoint()) {
      this._startPanDrag(event, { addDraftPointOnClick: true });
      return;
    }

    if (this._editMode && !event.shiftKey) {
      const isPathwayDraftTool = this._isDraftEditActive();
      if (
        event.ctrlKey
        && isPathwayDraftTool
      ) {
        this._startPathwayShapeDrag(event);
      } else if (this._activeEditTool === "pa" || this._activeEditTool === "mp" || this._activeEditTool === "ng") {
        if (!this._startPathwayPointDrag(event)) {
          if (!this._handleExistingPathwayEditClick(event)) {
            this._handlePathwayDraftClick(event);
          }
        }
      } else if (this._activeEditTool === "pathway-edit" || this._activeEditTool === "nogozone-edit") {
        if (!this._startPathwayPointDrag(event)) {
          this._handleExistingPathwayEditClick(event);
        }
      } else if (!this._activeEditTool) {
        if (event.ctrlKey && this._startSelectedFeatureMove(event)) {
          return;
        }
        this._startPanDrag(event, { selectOnClick: true });
      } else if (!isPathwayDraftTool) {
        this._startPanDrag(event);
      }
      return;
    }

    this._startPanDrag(event);
  }

  _startAerialImagePanDrag(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const startPoint = this._displayPointFromSvgEvent(event.currentTarget, event);
    if (!startPoint) {
      return false;
    }

    event.preventDefault();
    this._clearActiveDrag();
    this._activeDrag = {
      kind: "aerial-image-pan",
      pointerId: event.pointerId,
      startPoint,
      lastPoint: startPoint,
      dragged: false,
      svg: event.currentTarget,
    };

    const canvas = this.shadowRoot?.querySelector(".map-canvas");
    canvas?.classList.add("is-dragging");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
    return true;
  }

  _startPanDrag(event, options = {}) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    event.preventDefault();
    this._clearActiveDrag();
    this._followMode = false;

    const rect = event.currentTarget.getBoundingClientRect();
    const viewBox = event.currentTarget.viewBox.baseVal;

    this._activeDrag = {
      kind: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: this._viewState.panX,
      startPanY: this._viewState.panY,
      unitsPerPixelX: viewBox.width / Math.max(rect.width, 1),
      unitsPerPixelY: viewBox.height / Math.max(rect.height, 1),
      selectOnClick: Boolean(options.selectOnClick),
      addDraftPointOnClick: Boolean(options.addDraftPointOnClick),
      dragged: false,
      svg: event.currentTarget,
    };

    const canvas = this.shadowRoot?.querySelector(".map-canvas");
    canvas?.classList.add("is-dragging");
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
    return true;
  }

  _handlePointerMove(event) {
    const drag = this._activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    if (drag.kind === "pathway-point") {
      const localPoint = this._localPointFromSvgEvent(drag.svg, event);
      if (!localPoint) {
        return;
      }

      const nextPoints = [...this._pathwayDraftPoints];
      nextPoints[drag.pointIndex] = localPoint;
      this._pathwayDraftPoints = nextPoints;
      this._selectedDraftPointIndex = drag.pointIndex;
      if (this._pathwayDraftKind === "sidewalk") {
        this._pathwayDraftTrimmingEdges =
          this._resnapMemoryPathTrimmingEdgesForMovedCenterPoint(
            drag.pointIndex,
            Array.isArray(drag.startPoints) ? drag.startPoints : [],
            nextPoints,
            Array.isArray(drag.startTrimmingEdges) ? drag.startTrimmingEdges : [],
          );
      }
      this._pathwayDraftJson = this._buildPathwayDraftJson();
      drag.dragged = true;
      this._render();
      const nextSvg = this.shadowRoot?.querySelector(".map-svg");
      if (nextSvg instanceof SVGSVGElement) {
        drag.svg = nextSvg;
      }
      const canvas = this.shadowRoot?.querySelector(".map-canvas");
      canvas?.classList.add("is-dragging");
      return;
    }

    if (drag.kind === "trimmer-point") {
      const localPoint = this._localPointFromSvgEvent(drag.svg, event);
      const snappedPoint = localPoint ? this._snapMemoryPathTrimmerPoint(localPoint) : null;
      if (!snappedPoint) {
        return;
      }

      this._updateMemoryPathTrimmingPoint(drag.edgeIndex, drag.pointIndex, snappedPoint);
      this._selectedTrimmingEdgeIndex = drag.edgeIndex;
      this._selectedTrimmingPointIndex = drag.pointIndex;
      this._pathwayDraftTrimmingEdgeAnchors =
        this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
      this._pathwayDraftJson = this._buildPathwayDraftJson();
      drag.dragged = true;
      this._render();
      const nextSvg = this.shadowRoot?.querySelector(".map-svg");
      if (nextSvg instanceof SVGSVGElement) {
        drag.svg = nextSvg;
      }
      const canvas = this.shadowRoot?.querySelector(".map-canvas");
      canvas?.classList.add("is-dragging");
      return;
    }

    if (drag.kind === "pathway-shape") {
      const localPoint = this._localPointFromSvgEvent(drag.svg, event);
      if (!localPoint) {
        return;
      }

      const deltaX = Number(localPoint.x) - Number(drag.startPoint.x);
      const deltaY = Number(localPoint.y) - Number(drag.startPoint.y);
      this._pathwayDraftPoints = drag.startPoints.map((point) => ({
        ...point,
        x: Number(point.x) + deltaX,
        y: Number(point.y) + deltaY,
      }));
      this._pathwayDraftTrimmingEdges = Array.isArray(drag.startTrimmingEdges)
        ? drag.startTrimmingEdges.map((edge) => ({
            ...edge,
            points: Array.isArray(edge.points)
              ? edge.points.map((point) => ({
                  ...point,
                  x: Number(point.x) + deltaX,
                  y: Number(point.y) + deltaY,
                }))
              : [],
          }))
        : [];
      this._pathwayDraftJson = this._buildPathwayDraftJson();
      this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
        ? "No-go zone moved. Click tick to save or cross to cancel."
        : this._pathwayDraftKind === "sidewalk"
          ? "Memory path moved. Click tick to save or cross to cancel."
        : "Pathway moved. Click tick to save or cross to cancel.";
      drag.dragged = true;
      this._render();
      const nextSvg = this.shadowRoot?.querySelector(".map-svg");
      if (nextSvg instanceof SVGSVGElement) {
        drag.svg = nextSvg;
      }
      const canvas = this.shadowRoot?.querySelector(".map-canvas");
      canvas?.classList.add("is-dragging");
      return;
    }

    if (drag.kind === "aerial-image-pan") {
      const point = this._displayPointFromSvgEvent(drag.svg, event);
      if (!point) {
        return;
      }

      const deltaX = Number(point.x) - Number(drag.lastPoint.x);
      const deltaY = Number(point.y) - Number(drag.lastPoint.y);
      if (Math.hypot(deltaX, deltaY) < 0.000001) {
        return;
      }

      drag.lastPoint = point;
      drag.dragged = true;
      this._translateAerialOverlay(deltaX, deltaY);
      const nextSvg = this.shadowRoot?.querySelector(".map-svg");
      if (nextSvg instanceof SVGSVGElement) {
        drag.svg = nextSvg;
      }
      const canvas = this.shadowRoot?.querySelector(".map-canvas");
      canvas?.classList.add("is-dragging");
      return;
    }

    if (drag.kind === "pan") {
      const deltaClientX = event.clientX - drag.startClientX;
      const deltaClientY = event.clientY - drag.startClientY;
      if (drag.selectOnClick && !drag.dragged && Math.hypot(deltaClientX, deltaClientY) < 4) {
        return;
      }

      drag.dragged = true;
      this._viewState.panX = drag.startPanX + deltaClientX * drag.unitsPerPixelX;
      this._viewState.panY = drag.startPanY + deltaClientY * drag.unitsPerPixelY;
      this._applyTransformOnly();
    }
  }

  _handlePointerUp(event) {
    const drag = this._activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    if (drag.kind === "pan" && drag.addDraftPointOnClick && !drag.dragged) {
      const draftClickEvent = {
        currentTarget: drag.svg,
        button: 0,
        clientX: drag.startClientX,
        clientY: drag.startClientY,
      };
      this._clearActiveDrag();
      this._handleConnectedPathwayDraftClick(draftClickEvent);
      return;
    }

    if (drag.kind === "pan" && drag.selectOnClick && !drag.dragged) {
      const selectionEvent = {
        currentTarget: drag.svg,
        button: 0,
        clientX: drag.startClientX,
        clientY: drag.startClientY,
      };
      this._clearActiveDrag();
      this._handleEditModeSelectionClick(selectionEvent);
      return;
    }

    if (drag.kind === "pathway-point" && !drag.dragged) {
      this._selectedDraftPointIndex = drag.pointIndex;
      this._pathwayDraftNotice = `${this._pathwayDraftKind === "nogozone" ? "No-go zone" : this._pathwayDraftKind === "sidewalk" ? "Memory path" : "Pathway"} point selected. Press Backspace or Delete to remove it.`;
    }

    if (drag.kind === "trimmer-point" && !drag.dragged) {
      this._selectedTrimmingEdgeIndex = drag.edgeIndex;
      this._selectedTrimmingPointIndex = drag.pointIndex;
      this._selectedTrimmingSelectionKind = "point";
      this._pathwayDraftNotice = `Selected trimmer segment ${drag.edgeIndex + 1}. Hold Shift and click to add a snapped point.`;
    }

    if (drag.kind === "pathway-shape" && !drag.dragged) {
      this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
        ? "No-go zone ready to move. Drag with Ctrl held, or click cross to cancel."
        : this._pathwayDraftKind === "sidewalk"
          ? "Memory path ready to move. Drag with Ctrl held, or click cross to cancel."
        : "Pathway ready to move. Drag with Ctrl held, or click cross to cancel.";
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
    this._flushDeferredUpdatesAfterUnlock();
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
    const sidewalkShapes = Array.isArray(siteMap.sidewalks) ? siteMap.sidewalks : [];
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
      ...sidewalkShapes.flatMap((shape) => [
        ...this._displayPoints(shape.points),
        ...this._memoryPathEdgePoints(shape).flatMap((edge) => this._displayPoints(edge.points)),
      ]),
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
        .map((shape, index) =>
          this._renderNoGoShape(shape, {
            selected:
              this._selectedNoGoKey !== ""
              && this._selectedNoGoKey === this._noGoKey(shape, index),
          }),
        )
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
      sidewalkShapes: sidewalkShapes
        .map((shape, index) =>
          this._renderMemoryPathShape(shape, {
            selected:
              this._selectedMemoryPathKey !== ""
              && this._selectedMemoryPathKey === this._memoryPathKey(shape, index),
          }),
        )
        .join(""),
      pathwayShapes: pathwayShapes
        .map((shape, index) =>
          this._renderPathwayShape(shape, {
            selected:
              this._selectedPathwayKey !== ""
              && this._selectedPathwayKey === this._pathwayKey(shape, index),
          }),
        )
        .join(""),
      chargingShapes: chargingPoints.map((item) => this._renderChargingShape(item)).join(""),
      editDraftShapes: this._renderPathwayDraftShapes(),
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

  _renderNoGoShape(shape, options = {}) {
    const selected = options.selected === true;
    const enabled = shape?.enable !== false;
    return this._renderPolygonShape(shape, {
      fill: enabled
        ? (selected ? "rgba(224, 49, 49, 0.24)" : "rgba(224, 49, 49, 0.16)")
        : (selected ? "rgba(148, 163, 184, 0.18)" : "rgba(148, 163, 184, 0.1)"),
      stroke: enabled
        ? (selected ? "#ff6b6b" : "#ff0000")
        : (selected ? "#cbd5e1" : "#94a3b8"),
      strokeWidth: selected ? 1.4 : 1,
    });
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

  _renderPathwayShape(shape, options = {}) {
    const points = this._escape(this._svgPoints(shape.points));
    const selected = options.selected === true;
    return `
      <polyline
        points="${points}"
        fill="none"
        stroke="${selected ? "rgba(250, 204, 21, 0.48)" : "rgba(240, 180, 41, 0.3)"}"
        stroke-width="${selected ? "0.78" : "0.55"}"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      <polyline
        points="${points}"
        fill="none"
        stroke="${selected ? "#fde047" : "#f0b429"}"
        stroke-width="${selected ? "2.6" : "2"}"
        stroke-dasharray="2.8 2.2"
        stroke-linecap="butt"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      ></polyline>
    `;
  }

  _renderMemoryPathShape(shape, options = {}) {
    const points = Array.isArray(shape?.points) ? shape.points : [];
    if (points.length < 2) {
      return "";
    }

    const selected = options.selected === true;
    const edgeShapes = this._memoryPathEdgePoints(shape);
    return `
      <polyline
        points="${this._escape(this._svgPoints(points))}"
        fill="none"
        stroke="${selected ? "rgba(56, 189, 248, 0.42)" : "rgba(56, 189, 248, 0.26)"}"
        stroke-width="${this._number(MEMORY_PATH_WIDTH_METERS)}"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      <polyline
        points="${this._escape(this._svgPoints(points))}"
        fill="none"
        stroke="${selected ? "#e0f2fe" : "rgba(14, 165, 233, 0.88)"}"
        stroke-width="${selected ? "0.1" : "0.06"}"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      ${edgeShapes.map((edge) => `
        <polyline
          points="${this._escape(this._svgPoints(edge.points))}"
          fill="none"
          stroke="${selected ? "#fef08a" : "#facc15"}"
          stroke-width="${selected ? "0.12" : "0.08"}"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></polyline>
      `).join("")}
    `;
  }

  _memoryPathEdgePoints(shape) {
    const edges = Array.isArray(shape?.trimming_edges) ? shape.trimming_edges : [];
    const normalizedEdges = edges
      .map((edge) => ({
        ...edge,
        ref: edge?.ref,
        points: Array.isArray(edge?.points) ? edge.points : [],
      }))
      .filter((edge) => edge.points.length >= 2);
    if (normalizedEdges.length) {
      return normalizedEdges;
    }

    const fallbackPoints = Array.isArray(shape?.points)
      ? this._memoryPathRightEdgeFromPoints(shape.points)
      : [];
    return fallbackPoints.length >= 2 ? [{ id: 1, points: fallbackPoints }] : [];
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
    const guardHalfSize = 1.0;
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

  _renderEditJsonPanel(entry) {
    const hasPreview =
      this._pathwayDraftJson || this._pathwayDraftCommittedJson || this._pathwayDraftNotice;
    if (!this._editMode && !hasPreview) {
      return "";
    }

    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    const previewCommand = this._pathwayDraftCommandName();
    const jsonText = this._pathwayDraftJson || this._pathwayDraftCommittedJson || "";
    const note = this._pathwayDraftNotice
      || (isMemoryPath
        ? "Review the generated save_sidewalk payload."
      : ((this._activeEditTool === "pa" || this._activeEditTool === "pathway-edit") && !isNoGoZone)
        ? "Review the generated save_pathway payload."
        : ((this._activeEditTool === "ng" || this._activeEditTool === "nogozone-edit") && isNoGoZone)
          ? "Review the generated save_nogozone payload."
        : "Development preview panel.");

    return `
      <div class="dev-json-panel">
        <div class="dev-json-header">
          <span class="dev-json-title">${previewCommand} preview</span>
          <span class="dev-json-note">${this._escape(note)}</span>
        </div>
        <textarea class="dev-json-preview" readonly>${this._escape(jsonText)}</textarea>
      </div>
    `;
  }

  _siteNoGoZones() {
    return Array.isArray(this._entry?.site_map?.nogozones) ? this._entry.site_map.nogozones : [];
  }

  _sitePathways() {
    return Array.isArray(this._entry?.site_map?.pathways) ? this._entry.site_map.pathways : [];
  }

  _siteMemoryPaths() {
    return Array.isArray(this._entry?.site_map?.sidewalks) ? this._entry.site_map.sidewalks : [];
  }

  _pathwayKey(shape, index = 0) {
    if (!shape || typeof shape !== "object") {
      return "";
    }

    const id = shape.id;
    if (id !== null && id !== undefined && `${id}` !== "") {
      return `id:${id}`;
    }

    const name = typeof shape.name === "string" ? shape.name.trim() : "";
    if (name) {
      return `name:${name}:${index}`;
    }

    return `index:${index}`;
  }

  _memoryPathKey(shape, index = 0) {
    if (!shape || typeof shape !== "object") {
      return "";
    }

    const id = shape.id;
    if (id !== null && id !== undefined && `${id}` !== "") {
      return `id:${id}`;
    }

    const name = typeof shape.name === "string" ? shape.name.trim() : "";
    if (name) {
      return `name:${name}:${index}`;
    }

    return `index:${index}`;
  }

  _selectedPathway() {
    const pathways = this._sitePathways();
    for (const [index, shape] of pathways.entries()) {
      if (this._pathwayKey(shape, index) === this._selectedPathwayKey) {
        return {
          ...shape,
          _index: index,
          _key: this._selectedPathwayKey,
        };
      }
    }

    return null;
  }

  _selectedMemoryPath() {
    const memoryPaths = this._siteMemoryPaths();
    for (const [index, shape] of memoryPaths.entries()) {
      if (this._memoryPathKey(shape, index) === this._selectedMemoryPathKey) {
        return {
          ...shape,
          _index: index,
          _key: this._selectedMemoryPathKey,
        };
      }
    }

    return null;
  }

  _resetMemoryPathDraftDetails() {
    this._pathwayDraftConnectIds = [];
    this._pathwayDraftHeadType = 99;
    this._pathwayDraftSnowPiles = [];
    this._pathwayDraftTrimmingEdges = [];
    this._pathwayDraftTrimmingEdgeAnchors = [];
    this._memoryPathTrimmerMode = false;
    this._memoryPathAutoAddTrimmingEdges = false;
    this._selectedDraftPointIndex = null;
    this._selectedTrimmingEdgeIndex = null;
    this._selectedTrimmingPointIndex = null;
    this._selectedTrimmingSelectionKind = null;
  }

  _setMemoryPathDraftFromShape(selectedMemoryPath) {
    this._pathwayDraftKind = "sidewalk";
    this._pathwayDraftId = selectedMemoryPath.id ?? null;
    this._pathwayDraftName = selectedMemoryPath.name || "Memory Path";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._pathwayDraftConnectIds = Array.isArray(selectedMemoryPath.connectids)
      ? selectedMemoryPath.connectids.map((id) => id)
      : [];
    this._pathwayDraftHeadType = Number.isFinite(Number(selectedMemoryPath.head_type))
      ? Number(selectedMemoryPath.head_type)
      : 99;
    this._pathwayDraftSnowPiles = Array.isArray(selectedMemoryPath.snowPiles)
      ? selectedMemoryPath.snowPiles.map((item) => item)
      : [];
    this._pathwayDraftPoints = Array.isArray(selectedMemoryPath.points)
      ? selectedMemoryPath.points.map((point) => ({ ...point }))
      : [];
    this._pathwayDraftTrimmingEdges = this._memoryPathEdgePoints(selectedMemoryPath)
      .map((edge) => ({
        id: edge.id,
        ref: edge.ref,
        points: edge.points.map((point) => ({ ...point })),
      }));
    this._pathwayDraftTrimmingEdgeAnchors =
      this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
    this._memoryPathTrimmerMode = false;
    this._memoryPathAutoAddTrimmingEdges = false;
    this._selectedDraftPointIndex = null;
    this._selectedTrimmingEdgeIndex = null;
    this._selectedTrimmingPointIndex = null;
    this._selectedTrimmingSelectionKind = null;
    this._pathwayDraftJson = this._buildPathwayDraftJson();
  }

  _noGoKey(shape, index = 0) {
    if (!shape || typeof shape !== "object") {
      return "";
    }

    const id = shape.id;
    if (id !== null && id !== undefined && `${id}` !== "") {
      return `id:${id}`;
    }

    const name = typeof shape.name === "string" ? shape.name.trim() : "";
    if (name) {
      return `name:${name}:${index}`;
    }

    return `index:${index}`;
  }

  _selectedNoGoZone() {
    const nogozones = this._siteNoGoZones();
    for (const [index, shape] of nogozones.entries()) {
      if (this._noGoKey(shape, index) === this._selectedNoGoKey) {
        return {
          ...shape,
          _index: index,
          _key: this._selectedNoGoKey,
        };
      }
    }

    return null;
  }

  _renderEditModeHints() {
    if (!this._editMode) {
      return "";
    }

    const selectedPathway = this._selectedPathway();
    const selectedMemoryPath = selectedPathway ? null : this._selectedMemoryPath();
    const selectedNoGoZone = selectedPathway || selectedMemoryPath ? null : this._selectedNoGoZone();
    const activePathOrNoGoDraft = this._isDraftEditActive();
    const hasSelectedObject = Boolean(selectedPathway || selectedMemoryPath || selectedNoGoZone || activePathOrNoGoDraft);
    const selectedIsNoGoZone =
      Boolean(selectedNoGoZone)
      || (activePathOrNoGoDraft && this._pathwayDraftKind === "nogozone");

    const hints = [];
    if (activePathOrNoGoDraft) {
      hints.push("Hold Shift to Pan");
    }
    if (hasSelectedObject) {
      hints.push("Shift Scroll to Rotate", "Ctrl Drag to Move");
      if (selectedIsNoGoZone) {
        hints.push("Ctrl Scroll to Size");
      }
    }
    if (!hints.length) {
      return "";
    }

    return `
      <div class="map-edit-hints" aria-label="Edit mode hints">
        ${hints.map((hint) => `<span class="map-edit-hint">${this._escape(hint)}</span>`).join("")}
      </div>
    `;
  }

  _renderEditConfirmationDialog() {
    if (!this._editConfirmationOpen) {
      return "";
    }

    return `
      <div class="map-edit-confirmation-backdrop">
        <div
          class="map-edit-confirmation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="map-edit-confirmation-title"
        >
          <div class="map-edit-confirmation-title" id="map-edit-confirmation-title">
            Map Editing Warning
          </div>
          <div class="map-edit-confirmation-copy">
            <p>
              Editing paths or no-go zones can change where Yarbo operates. Incorrect map edits may cause unexpected movement, missed areas, property damage, device damage, or unsafe operation.
            </p>
            <p>
              Only continue if you understand the risk and accept responsibility for checking the edited map before using it with the device.
            </p>
            <p>
              By continuing, you acknowledge this experimental editor is provided without warranty and that you use it at your own risk.
            </p>
          </div>
          ${this._editConfirmationError ? `
            <div class="map-edit-confirmation-error">
              ${this._escape(this._editConfirmationError)}
            </div>
          ` : ""}
          <div class="map-edit-confirmation-actions">
            <button class="map-button" type="button" data-action="edit-confirm-cancel" ${this._editConfirmationSaving ? "disabled" : ""}>Cancel</button>
            <button class="map-button is-active" type="button" data-action="edit-confirm-accept" ${this._editConfirmationSaving ? "disabled" : ""}>${this._editConfirmationSaving ? "Saving..." : "Accept and Edit"}</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderUnsavedChangesDialog() {
    if (!this._unsavedChangesDialogOpen) {
      return "";
    }

    const busy = this._pathwayDraftSending || this._aerialOverlaySaving;
    return `
      <div class="map-edit-confirmation-backdrop">
        <div
          class="map-edit-confirmation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="map-unsaved-changes-title"
        >
          <div class="map-edit-confirmation-title" id="map-unsaved-changes-title">
            Unsaved changes made
          </div>
          <div class="map-edit-confirmation-copy">
            <p>
              Unsaved changes have been made. Are you sure you want to discard them?
            </p>
          </div>
          <div class="map-unsaved-actions">
            <button class="map-button is-active" type="button" data-action="unsaved-save" ${busy ? "disabled" : ""}>Save</button>
            <div class="map-unsaved-actions-right">
              <button class="map-button" type="button" data-action="unsaved-no" ${busy ? "disabled" : ""}>No</button>
              <button class="map-button" type="button" data-action="unsaved-yes" ${busy ? "disabled" : ""}>Yes</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderPathwayDeleteDialog() {
    const selectedPathway = this._selectedPathway();
    const selectedMemoryPath = selectedPathway ? null : this._selectedMemoryPath();
    const selectedNoGoZone = selectedPathway || selectedMemoryPath ? null : this._selectedNoGoZone();
    const selectedFeature = selectedPathway || selectedMemoryPath || selectedNoGoZone;
    if (!this._pathwayDeleteDialogOpen || !selectedFeature) {
      return "";
    }

    const isNoGoZone = Boolean(selectedNoGoZone && !selectedPathway);
    const isMemoryPath = Boolean(selectedMemoryPath && !selectedPathway && !selectedNoGoZone);
    const label = selectedFeature.name
      || `${isNoGoZone ? "No-go zone" : isMemoryPath ? "Memory path" : "Pathway"} ${selectedFeature.id ?? ""}`.trim();
    const escapedLabel = this._escape(label);
    const title = isNoGoZone ? "Delete no-go zone" : isMemoryPath ? "Delete memory path" : "Delete pathway";
    const copy = `Are you sure you want to delete ${escapedLabel}?`;
    return `
      <div class="map-dialog-backdrop">
        <div class="map-dialog" role="dialog" aria-modal="true" aria-label="${this._escape(title)}">
          <div class="map-dialog-title">${this._escape(title)}</div>
          <div class="map-dialog-copy">${copy}</div>
          <div class="map-dialog-actions">
            <button class="map-button" type="button" data-action="pathway-delete-cancel" ${this._pathwayDraftSending ? "disabled" : ""}>Cancel</button>
            <button class="map-button is-active" type="button" data-action="pathway-delete-confirm" ${this._pathwayDraftSending ? "disabled" : ""}>${this._pathwayDraftSending ? "Deleting..." : "Delete"}</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderMemoryPathSettingsDialog() {
    const selectedMemoryPath = this._selectedMemoryPath();
    if (!this._memoryPathSettingsDialogOpen || !selectedMemoryPath) {
      return "";
    }

    const label = selectedMemoryPath.name || `Memory path ${selectedMemoryPath.id ?? ""}`.trim();
    return `
      <div class="map-dialog-backdrop">
        <div class="map-dialog" role="dialog" aria-modal="true" aria-label="Memory path settings">
          <div class="map-dialog-title">Memory path settings</div>
          <div class="map-dialog-copy">${this._escape(label)}</div>
          <label class="map-dialog-copy">
            <input
              type="checkbox"
              data-action="memorypath-settings-blade"
              ${this._memoryPathSettings.en_blade !== false ? "checked" : ""}
              ${this._pathwayDraftSending ? "disabled" : ""}
            />
            Blade enabled
          </label>
          <input
            class="map-dialog-input"
            type="number"
            step="1"
            data-action="memorypath-settings-blade_height"
            value="${this._escape(this._memoryPathSettings.blade_height)}"
            placeholder="Blade height"
            ${this._pathwayDraftSending ? "disabled" : ""}
          />
          <input
            class="map-dialog-input"
            type="number"
            step="0.1"
            min="0"
            data-action="memorypath-settings-plan_speed"
            value="${this._escape(this._memoryPathSettings.plan_speed)}"
            placeholder="Plan speed"
            ${this._pathwayDraftSending ? "disabled" : ""}
          />
          <div class="map-dialog-actions">
            <button class="map-button" type="button" data-action="memorypath-settings-cancel" ${this._pathwayDraftSending ? "disabled" : ""}>Cancel</button>
            <button class="map-button is-active" type="button" data-action="memorypath-settings-save" ${this._pathwayDraftSending ? "disabled" : ""}>${this._pathwayDraftSending ? "Sending..." : "Save"}</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderPathwayNameDialog() {
    if (!this._pathwayNameDialogOpen) {
      return "";
    }

    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    const itemLabel = isNoGoZone ? "no-go zone" : isMemoryPath ? "memory path" : "pathway";
    const shortLabel = isNoGoZone ? "zone" : "path";
    const commandName = this._pathwayDraftCommandName();
    return `
      <div class="map-dialog-backdrop">
        <div class="map-dialog" role="dialog" aria-modal="true" aria-label="Name ${itemLabel}">
          <div class="map-dialog-title">${this._pathwayNameDialogMode === "rename" ? `Rename this ${itemLabel}` : `Name this ${itemLabel}`}</div>
          <div class="map-dialog-copy">Enter the ${shortLabel} name to include in the ${commandName} JSON.</div>
          <input
            class="map-dialog-input"
            type="text"
            maxlength="80"
            value="${this._escape(this._pathwayDraftPendingName)}"
            data-action="pathway-name-input"
            placeholder="${isNoGoZone ? "No-go zone name" : isMemoryPath ? "Memory path name" : "Pathway name"}"
          />
          <div class="map-dialog-actions">
            <button class="map-button" type="button" data-action="pathway-name-cancel" ${this._pathwayDraftSending ? "disabled" : ""}>Cancel</button>
            <button class="map-button is-active" type="button" data-action="pathway-name-confirm" ${this._pathwayDraftSending ? "disabled" : ""}>${this._pathwayDraftSending ? "Sending..." : "OK"}</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderEditContextMenu() {
    if (!this._editContextMenu || !this._isDraftEditActive()) {
      return "";
    }

    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const item = isNoGoZone
      ? `
        <button class="map-context-item" type="button" data-action="context-tocircle">ToCircle</button>
        <button class="map-context-item" type="button" data-action="context-add-square">addSquare</button>
        <button class="map-context-item" type="button" data-action="context-add-circle">addCircle</button>
      `
      : '<button class="map-context-item" type="button" disabled>No path actions</button>';

    return `
      <div
        class="map-context-menu"
        style="left: ${this._number(this._editContextMenu.x)}px; top: ${this._number(this._editContextMenu.y)}px;"
      >
        ${item}
      </div>
    `;
  }

  _handleEditContextMenu(event) {
    if (!this._editMode || !this._isDraftEditActive()) {
      return;
    }

    event.preventDefault();
    if (this._isMemoryPathTrimmerEditActive()) {
      return;
    }

    if (event.ctrlKey) {
      return;
    }

    const canvas = this.shadowRoot?.querySelector(".map-canvas");
    if (!(canvas instanceof HTMLElement)) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const menuWidth = 150;
    const menuHeight = this._pathwayDraftKind === "nogozone" ? 126 : 42;
    const localPoint = event.currentTarget instanceof SVGSVGElement
      ? this._localPointFromSvgEvent(event.currentTarget, event)
      : null;
    this._editContextMenu = {
      x: Math.min(Math.max(event.clientX - rect.left, 8), Math.max(rect.width - menuWidth, 8)),
      y: Math.min(Math.max(event.clientY - rect.top, 8), Math.max(rect.height - menuHeight, 8)),
      localPoint,
    };
    this._render();
  }

  _handleKeyDown(event) {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    if (this._eventHasTextInputTarget(event)) {
      return;
    }

    if (!this._handleEditorDeleteKey()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  _isTextInputTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return (
      target.isContentEditable
      || tagName === "input"
      || tagName === "textarea"
      || tagName === "select"
    );
  }

  _eventHasTextInputTarget(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.some((target) => this._isTextInputTarget(target))) {
      return true;
    }
    return this._isTextInputTarget(event.target);
  }

  _handleEditorDeleteKey() {
    if (!this._editMode || this._pathwayDraftSending || !this._isDraftEditActive()) {
      return false;
    }

    if (this._isMemoryPathTrimmerEditActive()) {
      if (
        this._selectedTrimmingSelectionKind !== "point"
        || !Number.isInteger(this._selectedTrimmingEdgeIndex)
        || !Number.isInteger(this._selectedTrimmingPointIndex)
      ) {
        return false;
      }

      const removed = this._removeMemoryPathTrimmingPoint(
        this._selectedTrimmingEdgeIndex,
        this._selectedTrimmingPointIndex,
      );
      if (removed) {
        this._render();
      }
      return removed;
    }

    if (!Number.isInteger(this._selectedDraftPointIndex)) {
      return false;
    }

    this._removePathwayDraftPoint(this._selectedDraftPointIndex);
    this._render();
    return true;
  }

  _handleBeforeUnload(event) {
    if (!this._hasUnsavedEditorChanges()) {
      return undefined;
    }

    event.preventDefault();
    event.returnValue = "";
    return "";
  }

  _handleDocumentClickCapture(event) {
    if (
      !this.isConnected
      || event.defaultPrevented
      || !this._hasUnsavedEditorChanges()
      || this._unsavedChangesDialogOpen
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const link = this._navigationLinkFromEvent(event);
    const url = this._navigationUrlFromLink(link);
    if (!url || url.href === window.location.href) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this._openUnsavedChangesDialog("navigate", { url: url.href });
  }

  _installHistoryNavigationGuard() {
    if (this._historyGuardInstalled) {
      return;
    }

    this._navigationGuardCurrentUrl = window.location.href;
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const owner = this;

    const guardedPushState = function guardedPushState(state, title, url) {
      if (owner._shouldBlockHistoryNavigation(url)) {
        owner._openUnsavedChangesDialog("navigate", {
          url: owner._absoluteNavigationUrl(url),
        });
        return undefined;
      }
      const result = originalPushState.apply(this, arguments);
      owner._navigationGuardCurrentUrl = window.location.href;
      return result;
    };

    const guardedReplaceState = function guardedReplaceState(state, title, url) {
      if (owner._shouldBlockHistoryNavigation(url)) {
        owner._openUnsavedChangesDialog("navigate", {
          url: owner._absoluteNavigationUrl(url),
        });
        return undefined;
      }
      const result = originalReplaceState.apply(this, arguments);
      owner._navigationGuardCurrentUrl = window.location.href;
      return result;
    };

    window.history.pushState = guardedPushState;
    window.history.replaceState = guardedReplaceState;
    this._historyGuardInstalled = true;
    this._historyGuardOriginalPushState = originalPushState;
    this._historyGuardOriginalReplaceState = originalReplaceState;
    this._historyGuardPushState = guardedPushState;
    this._historyGuardReplaceState = guardedReplaceState;
  }

  _restoreHistoryNavigationGuard() {
    if (!this._historyGuardInstalled) {
      return;
    }

    if (this._historyGuardOriginalPushState && window.history.pushState === this._historyGuardPushState) {
      window.history.pushState = this._historyGuardOriginalPushState;
    }
    if (
      this._historyGuardOriginalReplaceState
      && window.history.replaceState === this._historyGuardReplaceState
    ) {
      window.history.replaceState = this._historyGuardOriginalReplaceState;
    }

    this._historyGuardInstalled = false;
    this._historyGuardOriginalPushState = null;
    this._historyGuardOriginalReplaceState = null;
    this._historyGuardPushState = null;
    this._historyGuardReplaceState = null;
    this._historyGuardBypass = false;
    this._navigationGuardCurrentUrl = "";
  }

  _handlePopStateCapture(event) {
    const nextUrl = window.location.href;
    if (this._historyGuardBypass || nextUrl === this._navigationGuardCurrentUrl) {
      this._navigationGuardCurrentUrl = nextUrl;
      return;
    }

    if (!this._hasUnsavedEditorChanges()) {
      this._navigationGuardCurrentUrl = nextUrl;
      return;
    }

    const previousUrl = this._navigationGuardCurrentUrl || nextUrl;
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this._historyGuardBypass = true;
    window.history.pushState(null, "", previousUrl);
    this._historyGuardBypass = false;
    this._navigationGuardCurrentUrl = previousUrl;
    if (!this._unsavedChangesDialogOpen) {
      this._openUnsavedChangesDialog("navigate", { url: nextUrl });
    }
  }

  _shouldBlockHistoryNavigation(url) {
    if (
      this._historyGuardBypass
      || !this.isConnected
      || !url
      || this._unsavedChangesDialogOpen
      || !this._hasUnsavedEditorChanges()
    ) {
      return false;
    }

    const absoluteUrl = this._absoluteNavigationUrl(url);
    if (!absoluteUrl || absoluteUrl === window.location.href) {
      return false;
    }

    const nextUrl = new URL(absoluteUrl);
    if (
      nextUrl.origin === window.location.origin
      && nextUrl.pathname === window.location.pathname
      && nextUrl.search === window.location.search
    ) {
      return false;
    }

    return true;
  }

  _absoluteNavigationUrl(url) {
    if (!url) {
      return "";
    }

    try {
      return new URL(url, window.location.href).href;
    } catch (_err) {
      return "";
    }
  }

  _navigationLinkFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (!(item instanceof Element)) {
        continue;
      }
      if (item.matches?.("a[href], area[href]")) {
        return item;
      }
      if (item instanceof HTMLElement && item.hasAttribute("href")) {
        return item;
      }
    }
    return null;
  }

  _navigationUrlFromLink(link) {
    if (!(link instanceof Element)) {
      return null;
    }

    const target = link.getAttribute("target");
    if (target && target.toLowerCase() !== "_self") {
      return null;
    }
    if (link.hasAttribute("download")) {
      return null;
    }

    const rawHref =
      typeof link.href === "string"
        ? link.href
        : link.getAttribute("href");
    if (!rawHref) {
      return null;
    }

    const lowerHref = rawHref.trim().toLowerCase();
    if (
      lowerHref.startsWith("#")
      || lowerHref.startsWith("javascript:")
      || lowerHref.startsWith("mailto:")
      || lowerHref.startsWith("tel:")
    ) {
      return null;
    }

    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch (_err) {
      return null;
    }

    if (
      url.origin === window.location.origin
      && url.pathname === window.location.pathname
      && url.search === window.location.search
    ) {
      return null;
    }

    return url;
  }

  _isDraftEditActive() {
    return (
      this._activeEditTool === "pa"
      || this._activeEditTool === "mp"
      || this._activeEditTool === "pathway-edit"
      || this._activeEditTool === "pathway-move"
      || this._activeEditTool === "ng"
      || this._activeEditTool === "nogozone-edit"
      || this._activeEditTool === "nogozone-move"
    );
  }

  _canAddConnectedDraftPoint() {
    return (
      this._activeEditTool === "pa"
      || this._activeEditTool === "mp"
      || this._activeEditTool === "ng"
      || this._activeEditTool === "pathway-edit"
      || this._activeEditTool === "nogozone-edit"
    );
  }

  _isMemoryPathTrimmerEditActive() {
    return (
      this._memoryPathTrimmerMode === true
      && this._pathwayDraftKind === "sidewalk"
      && this._isDraftEditActive()
    );
  }

  _toggleMemoryPathTrimmerEdit() {
    if (this._pathwayDraftKind !== "sidewalk" || !this._isDraftEditActive()) {
      return;
    }

    if (this._pathwayDraftPoints.length < 2) {
      this._pathwayDraftNotice = "Add at least two memory path points before editing trimmer segments.";
      this._render();
      return;
    }

    this._memoryPathTrimmerMode = !this._memoryPathTrimmerMode;
    this._selectedDraftPointIndex = null;
    this._selectedTrimmingEdgeIndex = null;
    this._selectedTrimmingPointIndex = null;
    this._selectedTrimmingSelectionKind = null;
    this._editContextMenu = null;
    this._pathwayDraftNotice = this._memoryPathTrimmerMode
      ? "Trimmer editing enabled. Click trimmer points or lines to select. Hold Shift and click to add a snapped trimmer point."
      : "Memory path point editing enabled.";
    this._render();
  }

  _toggleMemoryPathAutoAddTrimmingEdges() {
    if (this._pathwayDraftKind !== "sidewalk" || this._activeEditTool !== "mp") {
      return;
    }

    this._memoryPathAutoAddTrimmingEdges = !this._memoryPathAutoAddTrimmingEdges;
    this._pathwayDraftNotice = this._memoryPathAutoAddTrimmingEdges
      ? "New memory path points will add a new trimmer section."
      : "New memory path points will not add trimmer sections.";
    this._render();
  }

  _pathwayDraftSignature() {
    const points = Array.isArray(this._pathwayDraftPoints)
      ? this._pathwayDraftPoints.map((point) => ({
          x: Number.isFinite(Number(point?.x)) ? Number(point.x) : null,
          y: Number.isFinite(Number(point?.y)) ? Number(point.y) : null,
        }))
      : [];

    return JSON.stringify({
      kind: this._pathwayDraftKind,
      id: this._pathwayDraftId ?? null,
      name: this._pathwayDraftName || "",
      enabled: this._pathwayDraftEnabled !== false,
      type: Number.isFinite(Number(this._pathwayDraftType)) ? Number(this._pathwayDraftType) : 0,
      connectids: Array.isArray(this._pathwayDraftConnectIds) ? this._pathwayDraftConnectIds : [],
      trimmingEdges: Array.isArray(this._pathwayDraftTrimmingEdges)
        ? this._pathwayDraftTrimmingEdges.map((edge) => ({
            id: edge?.id ?? null,
            points: Array.isArray(edge?.points)
              ? edge.points.map((point) => ({
                  x: Number.isFinite(Number(point?.x)) ? Number(point.x) : null,
                  y: Number.isFinite(Number(point?.y)) ? Number(point.y) : null,
                }))
              : [],
          }))
        : [],
      points,
    });
  }

  _markPathwayDraftClean() {
    this._pathwayDraftOriginalSignature = this._pathwayDraftSignature();
  }

  _hasUnsavedPathwayDraftChanges() {
    if (!this._isDraftEditActive()) {
      return false;
    }

    const currentSignature = this._pathwayDraftSignature();
    if (!this._pathwayDraftOriginalSignature) {
      return Boolean(this._pathwayDraftPoints.length || this._pathwayDraftJson);
    }
    return currentSignature !== this._pathwayDraftOriginalSignature;
  }

  _hasUnsavedEditorChanges() {
    return this._hasUnsavedPathwayDraftChanges()
      || this._hasUnsavedAerialPlacementChanges();
  }

  _openUnsavedChangesDialog(action, options = {}) {
    this._unsavedChangesAction = action;
    this._unsavedChangesNavigationUrl = options.url || "";
    this._unsavedChangesDialogOpen = true;
    this._editContextMenu = null;
    this._render();
  }

  _dismissUnsavedChangesDialog() {
    if (this._pathwayDraftSending || this._aerialOverlaySaving) {
      return;
    }

    this._unsavedChangesDialogOpen = false;
    this._unsavedChangesAction = null;
    this._unsavedChangesNavigationUrl = "";
    this._render();
  }

  _confirmUnsavedChangesDiscard() {
    if (this._pathwayDraftSending || this._aerialOverlaySaving) {
      return;
    }

    const action = this._unsavedChangesAction;
    const navigationUrl = this._unsavedChangesNavigationUrl;
    this._unsavedChangesDialogOpen = false;
    this._unsavedChangesAction = null;
    this._unsavedChangesNavigationUrl = "";
    this._unsavedChangesAfterSaveAction = null;
    this._unsavedChangesAfterSaveNavigationUrl = "";

    if (action === "exit-edit-mode") {
      if (this._hasUnsavedPathwayDraftChanges()) {
        this._discardPathwayDraft({ notice: false, requestFreshMap: false, render: false });
      }
      if (this._hasUnsavedAerialPlacementChanges()) {
        this._discardAerialPlacementChanges({ render: false });
      }
      if (this._editMode) {
        this._toggleEditMode();
        return;
      }
    } else if (action === "close-aerial-panel") {
      this._discardAerialPlacementChanges({ render: false });
    } else if (action === "navigate" && navigationUrl) {
      if (this._hasUnsavedPathwayDraftChanges()) {
        this._discardPathwayDraft({ notice: false, requestFreshMap: false, render: false });
      }
      if (this._hasUnsavedAerialPlacementChanges()) {
        this._discardAerialPlacementChanges({ render: false });
      }
      this._continueUnsavedNavigation(navigationUrl);
      return;
    } else {
      if (this._hasUnsavedPathwayDraftChanges()) {
        this._discardPathwayDraft({ render: false });
      }
      if (this._hasUnsavedAerialPlacementChanges()) {
        this._discardAerialPlacementChanges({ render: false });
      }
    }

    this._render();
  }

  async _saveUnsavedChangesDialog() {
    if (this._pathwayDraftSending || this._aerialOverlaySaving) {
      return;
    }

    const action = this._unsavedChangesAction;
    const navigationUrl = this._unsavedChangesNavigationUrl;
    this._unsavedChangesDialogOpen = false;
    this._unsavedChangesAction = null;
    this._unsavedChangesNavigationUrl = "";
    this._unsavedChangesAfterSaveAction = action;
    this._unsavedChangesAfterSaveNavigationUrl = navigationUrl;
    if (this._hasUnsavedAerialPlacementChanges() && !this._hasUnsavedPathwayDraftChanges()) {
      const saved = await this._saveAerialCalibration();
      if (saved) {
        this._completePendingUnsavedSaveAction();
      } else {
        this._unsavedChangesAfterSaveAction = null;
        this._unsavedChangesAfterSaveNavigationUrl = "";
      }
      return;
    }

    this._acceptPathwayDraft();
  }

  _completePendingUnsavedSaveAction() {
    const action = this._unsavedChangesAfterSaveAction;
    const navigationUrl = this._unsavedChangesAfterSaveNavigationUrl;
    this._unsavedChangesAfterSaveAction = null;
    this._unsavedChangesAfterSaveNavigationUrl = "";
    if (action === "exit-edit-mode" && this._editMode) {
      this._toggleEditMode();
      return true;
    }
    if (action === "close-aerial-panel") {
      this._aerialPanelOpen = false;
      this._aerialCalibrationMode = false;
      this._aerialCalibrationTransform = null;
      this._clearAerialPlacementDraft();
      this._render();
      return true;
    }
    if (action === "navigate" && navigationUrl) {
      this._continueUnsavedNavigation(navigationUrl);
      return true;
    }
    return false;
  }

  _continueUnsavedNavigation(url) {
    if (!url) {
      return;
    }

    window.location.assign(url);
  }

  _clearPendingUnsavedSaveAction() {
    this._unsavedChangesAfterSaveAction = null;
    this._unsavedChangesAfterSaveNavigationUrl = "";
  }

  _convertNoGoZoneDraftToCircle() {
    if (this._pathwayDraftKind !== "nogozone") {
      this._editContextMenu = null;
      this._pathwayDraftNotice = "ToCircle is only available for no-go zones.";
      this._render();
      return;
    }

    const points = this._pathwayDraftPoints;
    if (!Array.isArray(points) || points.length < 3) {
      this._editContextMenu = null;
      this._pathwayDraftNotice = "Add at least three no-go zone points before using ToCircle.";
      this._render();
      return;
    }

    const center = points.reduce(
      (total, point) => ({
        x: total.x + Number(point.x),
        y: total.y + Number(point.y),
      }),
      { x: 0, y: 0 },
    );
    center.x /= points.length;
    center.y /= points.length;

    const radius =
      points.reduce(
        (total, point) =>
          total + Math.hypot(Number(point.x) - center.x, Number(point.y) - center.y),
        0,
      ) / points.length;
    const safeRadius = Number.isFinite(radius) && radius > 0.05 ? radius : 1;
    const firstAngle = Math.atan2(Number(points[0].y) - center.y, Number(points[0].x) - center.x);
    const stepDirection = this._signedPolygonArea(points) < 0 ? -1 : 1;
    const angleStep = (Math.PI * 2 * stepDirection) / points.length;

    this._pathwayDraftPoints = points.map((point, index) => {
      const angle = firstAngle + angleStep * index;
      return {
        ...point,
        x: center.x + Math.cos(angle) * safeRadius,
        y: center.y + Math.sin(angle) * safeRadius,
      };
    });
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice =
      `ToCircle applied to ${points.length} no-go zone points. Click tick to save or cross to cancel.`;
    this._editContextMenu = null;
    this._render();
  }

  _addPresetNoGoZoneDraft(shape) {
    if (this._pathwayDraftKind !== "nogozone") {
      this._editContextMenu = null;
      this._pathwayDraftNotice = "Preset shapes are only available for no-go zones.";
      this._render();
      return;
    }

    const center = this._editContextMenu?.localPoint
      || this._pointsCenter(this._pathwayDraftPoints);
    if (!center) {
      this._editContextMenu = null;
      this._pathwayDraftNotice = "Right-click on the map where the preset no-go zone should be placed.";
      this._render();
      return;
    }

    const size = 1;
    const halfSize = size / 2;
    if (shape === "square") {
      this._pathwayDraftPoints = [
        { x: center.x - halfSize, y: center.y - halfSize },
        { x: center.x + halfSize, y: center.y - halfSize },
        { x: center.x + halfSize, y: center.y + halfSize },
        { x: center.x - halfSize, y: center.y + halfSize },
      ];
    } else {
      const pointCount = 8;
      this._pathwayDraftPoints = Array.from({ length: pointCount }, (_unused, index) => {
        const angle = (Math.PI * 2 * index) / pointCount;
        return {
          x: center.x + Math.cos(angle) * halfSize,
          y: center.y + Math.sin(angle) * halfSize,
        };
      });
    }

    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice =
      `${shape === "square" ? "1m square" : "1m 8-point circle"} no-go zone added. Click tick to save or cross to cancel.`;
    this._editContextMenu = null;
    this._render();
  }

  _signedPolygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return 0;
    }

    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const nextPoint = points[(index + 1) % points.length];
      area += Number(point.x) * Number(nextPoint.y) - Number(nextPoint.x) * Number(point.y);
    }
    return area / 2;
  }

  _toggleEditMode() {
    this._editMode = !this._editMode;
    this._editConfirmationOpen = false;
    this._editConfirmationSaving = false;
    this._editConfirmationError = "";
    if (!this._editMode) {
      this._editToolsExpanded = false;
      this._aerialPanelOpen = false;
      this._aerialCalibrationMode = false;
      this._aerialCalibrationTransform = null;
      this._aerialCalibrationDraft = [];
      this._aerialPendingImagePoint = null;
      this._aerialCalibrationStep = "image";
      this._clearAerialPlacementDraft();
      this._activeEditTool = null;
      this._pathwayNameDialogOpen = false;
      this._pathwayDraftSending = false;
      this._pathwayDeleteDialogOpen = false;
      this._selectedPathwayKey = "";
      this._selectedMemoryPathKey = "";
      this._selectedNoGoKey = "";
      this._pathwayDraftPoints = [];
      this._pathwayDraftJson = "";
      this._pathwayDraftName = "";
      this._pathwayDraftId = null;
      this._pathwayDraftKind = "pathway";
      this._pathwayDraftEnabled = true;
      this._pathwayDraftType = 0;
      this._pathwayDraftConnectIds = [];
      this._pathwayDraftHeadType = 99;
      this._pathwayDraftSnowPiles = [];
      this._pathwayDraftTrimmingEdges = [];
      this._pathwayDraftTrimmingEdgeAnchors = [];
      this._pathwayDraftPendingName = "";
      this._pathwayDraftOriginalSignature = "";
      this._editContextMenu = null;
      this._memoryPathSettingsDialogOpen = false;
      this._unsavedChangesDialogOpen = false;
      this._unsavedChangesAction = null;
      this._unsavedChangesNavigationUrl = "";
      this._unsavedChangesAfterSaveAction = null;
      this._unsavedChangesAfterSaveNavigationUrl = "";
      if (!this._embedded && this._refreshHandle === null && this._hass) {
        void this._startRefreshing();
      }
      if (this._flushDeferredUpdatesAfterUnlock()) {
        return;
      }
    } else {
      if (this._refreshHandle) {
        clearInterval(this._refreshHandle);
        this._refreshHandle = null;
      }
      if (this._reloadHandle) {
        clearTimeout(this._reloadHandle);
        this._reloadHandle = null;
      }
    }
    this._render();
  }

  async _handleEditModeButtonClick() {
    if (this._editMode) {
      if (this._hasUnsavedEditorChanges()) {
        this._openUnsavedChangesDialog("exit-edit-mode");
        return;
      }
      this._toggleEditMode();
      return;
    }

    if (this._editAcknowledged) {
      this._toggleEditMode();
      return;
    }

    this._editConfirmationError = "";
    if (await this._fetchEditAcknowledgement()) {
      this._editAcknowledged = true;
      this._toggleEditMode();
      return;
    }

    this._editConfirmationOpen = true;
    this._render();
  }

  async _acceptEditConfirmation() {
    if (!this._editConfirmationOpen || this._editConfirmationSaving) {
      return;
    }

    this._editConfirmationSaving = true;
    this._editConfirmationError = "";
    this._render();

    if (!await this._saveEditAcknowledgement()) {
      this._editConfirmationSaving = false;
      this._render();
      return;
    }

    this._editAcknowledged = true;
    this._editConfirmationOpen = false;
    this._editConfirmationSaving = false;
    this._toggleEditMode();
  }

  _cancelEditConfirmation() {
    if (!this._editConfirmationOpen || this._editConfirmationSaving) {
      return;
    }

    this._editConfirmationOpen = false;
    this._editConfirmationError = "";
    this._render();
  }

  async _fetchEditAcknowledgement() {
    const entryId = this._entry?.entry_id;
    if (!this._hass || !entryId) {
      this._editConfirmationError =
        "Home Assistant is not ready to check the stored edit acknowledgement.";
      return false;
    }

    try {
      const response = await this._hass.callApi(
        "GET",
        `s2jyarbo/edit_acknowledgement?entry_id=${encodeURIComponent(entryId)}`,
      );
      return response?.acknowledged === true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._editConfirmationError =
        `Could not check the stored edit acknowledgement: ${message}`;
      return false;
    }
  }

  async _saveEditAcknowledgement() {
    const entryId = this._entry?.entry_id;
    if (!this._hass || !entryId) {
      this._editConfirmationError =
        "Home Assistant is not ready to store the edit acknowledgement.";
      return false;
    }

    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/edit_acknowledgement", {
        entry_id: entryId,
        acknowledged: true,
      });
      if (response?.acknowledged !== true) {
        this._editConfirmationError =
          "Home Assistant did not confirm that the edit acknowledgement was stored.";
        return false;
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._editConfirmationError =
        `Could not store the edit acknowledgement in Home Assistant: ${message}`;
      return false;
    }
  }

  _handleEditModeSelectionClick(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return;
    }

    const noGoHit = this._nearestNoGoHit(event.currentTarget, event);
    const memoryPathHit = noGoHit ? null : this._nearestMemoryPathHit(event.currentTarget, event);
    const pathwayHit = noGoHit || memoryPathHit ? null : this._nearestPathwayHit(event.currentTarget, event);
    this._selectedPathwayKey = pathwayHit?.key || "";
    this._selectedMemoryPathKey = memoryPathHit?.key || "";
    this._selectedNoGoKey = noGoHit?.key || "";
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._pathwayDraftNotice = noGoHit
      ? `Selected no-go zone "${noGoHit.shape.name || noGoHit.shape.id || "Unnamed"}".`
      : memoryPathHit
        ? `Selected memory path "${memoryPathHit.shape.name || memoryPathHit.shape.id || "Unnamed"}".`
      : pathwayHit
        ? `Selected pathway "${pathwayHit.shape.name || pathwayHit.shape.id || "Unnamed"}".`
        : "No feature selected.";
    this._render();
  }

  _startSelectedFeatureMove(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const svg = event.currentTarget;
    const selectedPathway = this._selectedPathway();
    const selectedMemoryPath = selectedPathway ? null : this._selectedMemoryPath();
    const selectedNoGoZone = selectedPathway || selectedMemoryPath ? null : this._selectedNoGoZone();
    if (!selectedPathway && !selectedMemoryPath && !selectedNoGoZone) {
      return false;
    }

    const startPoint = this._localPointFromSvgEvent(svg, event);
    if (!startPoint) {
      return false;
    }

    if (selectedPathway) {
      const hit = this._nearestPathwayHit(svg, event);
      if (!hit || hit.key !== this._selectedPathwayKey) {
        return false;
      }

      this._prepareSelectedPathwayMove(selectedPathway);
    } else if (selectedMemoryPath) {
      const hit = this._nearestMemoryPathHit(svg, event);
      if (!hit || hit.key !== this._selectedMemoryPathKey) {
        return false;
      }

      this._prepareSelectedMemoryPathMove(selectedMemoryPath);
    } else {
      const hit = this._nearestNoGoHit(svg, event);
      if (!hit || hit.key !== this._selectedNoGoKey) {
        return false;
      }

      this._prepareSelectedNoGoZoneMove(selectedNoGoZone);
    }

    return this._startPathwayShapeDrag(event, startPoint);
  }

  _startPathwayShapeDrag(event, startPoint = null) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const resolvedStartPoint =
      startPoint || this._localPointFromSvgEvent(event.currentTarget, event);
    if (!resolvedStartPoint || !this._pathwayDraftPoints.length) {
      return false;
    }

    event.preventDefault();
    this._clearActiveDrag();
    this._activeDrag = {
      kind: "pathway-shape",
      pointerId: event.pointerId,
      startPoint: resolvedStartPoint,
      startPoints: this._pathwayDraftPoints.map((point) => ({ ...point })),
      startTrimmingEdges: this._pathwayDraftTrimmingEdges.map((edge) => ({
        ...edge,
        points: Array.isArray(edge.points) ? edge.points.map((point) => ({ ...point })) : [],
      })),
      dragged: false,
      svg: event.currentTarget,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
    return true;
  }

  _prepareSelectedPathwayMove(selectedPathway) {
    this._activeEditTool = "pathway-move";
    this._editToolsExpanded = false;
    this._pathwayDeleteDialogOpen = false;
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftKind = "pathway";
    this._pathwayDraftId = selectedPathway.id ?? null;
    this._pathwayDraftName = selectedPathway.name || "Pathway Draft";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPoints = selectedPathway.points.map((point) => ({ ...point }));
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Moving selected pathway. Release, then click tick to save or cross to cancel.";
  }

  _prepareSelectedMemoryPathMove(selectedMemoryPath) {
    this._activeEditTool = "pathway-move";
    this._editToolsExpanded = false;
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._pathwayNameDialogOpen = false;
    this._setMemoryPathDraftFromShape(selectedMemoryPath);
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Moving selected memory path. Release, then click tick to save or cross to cancel.";
  }

  _prepareSelectedNoGoZoneMove(selectedNoGoZone) {
    this._activeEditTool = "nogozone-move";
    this._editToolsExpanded = false;
    this._pathwayDeleteDialogOpen = false;
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftKind = "nogozone";
    this._pathwayDraftId = selectedNoGoZone.id ?? null;
    this._pathwayDraftName = selectedNoGoZone.name || "No-go Zone";
    this._pathwayDraftEnabled = selectedNoGoZone.enable !== false;
    this._pathwayDraftType = Number.isFinite(Number(selectedNoGoZone.type))
      ? Number(selectedNoGoZone.type)
      : 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPoints = this._editableClosedShapePoints(selectedNoGoZone.points);
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Moving selected no-go zone. Release, then click tick to save or cross to cancel.";
  }

  _beginSelectedPathwayEdit() {
    const selectedPathway = this._selectedPathway();
    if (!selectedPathway) {
      return;
    }

    this._activeEditTool = "pathway-edit";
    this._pathwayDraftKind = "pathway";
    this._pathwayDraftId = selectedPathway.id ?? null;
    this._pathwayDraftName = selectedPathway.name || "Pathway Draft";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPoints = selectedPathway.points.map((point) => ({ ...point }));
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Drag points to move them. Click a point to delete it. Click a line to insert a new point.";
    this._render();
  }

  _beginSelectedPathwayRename() {
    const selectedPathway = this._selectedPathway();
    if (!selectedPathway) {
      return;
    }

    this._pathwayDraftKind = "pathway";
    this._pathwayDraftId = selectedPathway.id ?? null;
    this._pathwayDraftName = selectedPathway.name || "Pathway Draft";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPoints = selectedPathway.points.map((point) => ({ ...point }));
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftPendingName = this._pathwayDraftName;
    this._pathwayNameDialogMode = "rename";
    this._pathwayNameDialogOpen = true;
    this._pathwayDeleteDialogOpen = false;
    this._render();
  }

  _beginSelectedPathwayDelete() {
    if (!this._selectedPathway()) {
      return;
    }

    this._pathwayDeleteDialogOpen = true;
    this._render();
  }

  _beginSelectedMemoryPathEdit() {
    const selectedMemoryPath = this._selectedMemoryPath();
    if (!selectedMemoryPath) {
      return;
    }

    this._activeEditTool = "pathway-edit";
    this._setMemoryPathDraftFromShape(selectedMemoryPath);
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Drag memory path points to move them. Click a point to delete it. Click a line to insert a new point.";
    this._render();
  }

  _beginSelectedMemoryPathRename() {
    const selectedMemoryPath = this._selectedMemoryPath();
    if (!selectedMemoryPath) {
      return;
    }

    this._setMemoryPathDraftFromShape(selectedMemoryPath);
    this._markPathwayDraftClean();
    this._pathwayDraftPendingName = this._pathwayDraftName;
    this._pathwayNameDialogMode = "rename";
    this._pathwayNameDialogOpen = true;
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._render();
  }

  _beginSelectedMemoryPathSettings() {
    const selectedMemoryPath = this._selectedMemoryPath();
    if (!selectedMemoryPath) {
      return;
    }

    this._memoryPathSettings = {
      en_blade: selectedMemoryPath.en_blade !== false,
      blade_height: Number.isFinite(Number(selectedMemoryPath.blade_height))
        ? Number(selectedMemoryPath.blade_height)
        : 0,
      plan_speed: Number.isFinite(Number(selectedMemoryPath.plan_speed))
        ? Number(selectedMemoryPath.plan_speed)
        : 0.5,
    };
    this._pathwayDeleteDialogOpen = false;
    this._pathwayNameDialogOpen = false;
    this._memoryPathSettingsDialogOpen = true;
    this._render();
  }

  _beginSelectedMemoryPathDelete() {
    if (!this._selectedMemoryPath()) {
      return;
    }

    this._memoryPathSettingsDialogOpen = false;
    this._pathwayDeleteDialogOpen = true;
    this._render();
  }

  _beginSelectedNoGoZoneEdit() {
    const selectedNoGoZone = this._selectedNoGoZone();
    if (!selectedNoGoZone) {
      return;
    }

    this._activeEditTool = "nogozone-edit";
    this._pathwayDraftKind = "nogozone";
    this._pathwayDraftId = selectedNoGoZone.id ?? null;
    this._pathwayDraftName = selectedNoGoZone.name || "No-go Zone";
    this._pathwayDraftEnabled = selectedNoGoZone.enable !== false;
    this._pathwayDraftType = Number.isFinite(Number(selectedNoGoZone.type))
      ? Number(selectedNoGoZone.type)
      : 0;
    this._pathwayDraftPoints = this._editableClosedShapePoints(selectedNoGoZone.points);
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Drag points to move them. Click a point to delete it. Click an edge to insert a new point.";
    this._render();
  }

  _beginSelectedNoGoZoneRename() {
    const selectedNoGoZone = this._selectedNoGoZone();
    if (!selectedNoGoZone) {
      return;
    }

    this._pathwayDraftKind = "nogozone";
    this._pathwayDraftId = selectedNoGoZone.id ?? null;
    this._pathwayDraftName = selectedNoGoZone.name || "No-go Zone";
    this._pathwayDraftEnabled = selectedNoGoZone.enable !== false;
    this._pathwayDraftType = Number.isFinite(Number(selectedNoGoZone.type))
      ? Number(selectedNoGoZone.type)
      : 0;
    this._pathwayDraftPoints = this._editableClosedShapePoints(selectedNoGoZone.points);
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._markPathwayDraftClean();
    this._pathwayDraftPendingName = this._pathwayDraftName;
    this._pathwayNameDialogMode = "rename";
    this._pathwayNameDialogOpen = true;
    this._pathwayDeleteDialogOpen = false;
    this._render();
  }

  _beginSelectedNoGoZoneDelete() {
    if (!this._selectedNoGoZone()) {
      return;
    }

    this._pathwayDeleteDialogOpen = true;
    this._render();
  }

  _beginNoGoZoneDraftSession() {
    this._activeEditTool = "ng";
    this._editContextMenu = null;
    this._editToolsExpanded = false;
    this._selectedPathwayKey = "";
    this._selectedMemoryPathKey = "";
    this._selectedNoGoKey = "";
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._pathwayNameDialogMode = "create";
    this._pathwayDraftKind = "nogozone";
    this._pathwayDraftPoints = [];
    this._pathwayDraftJson = "";
    this._pathwayDraftName = "";
    this._pathwayDraftId = null;
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPendingName = "";
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftSending = false;
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Click on the map to add no-go boundary points. The zone will be closed automatically. Hold Shift and drag to pan.";
    this._render();
  }

  _beginPathwayDraftSession() {
    this._activeEditTool = "pa";
    this._editContextMenu = null;
    this._editToolsExpanded = false;
    this._selectedPathwayKey = "";
    this._selectedMemoryPathKey = "";
    this._selectedNoGoKey = "";
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._pathwayNameDialogMode = "create";
    this._pathwayDraftKind = "pathway";
    this._pathwayDraftPoints = [];
    this._pathwayDraftJson = "";
    this._pathwayDraftName = "";
    this._pathwayDraftId = null;
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPendingName = "";
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftSending = false;
    this._markPathwayDraftClean();
    this._pathwayDraftNotice =
      "Click on the map to add pathway points. While in edit mode, hold Shift and drag to pan.";
    this._render();
  }

  _beginMemoryPathDraftSession() {
    this._activeEditTool = "mp";
    this._editContextMenu = null;
    this._editToolsExpanded = false;
    this._selectedPathwayKey = "";
    this._selectedMemoryPathKey = "";
    this._selectedNoGoKey = "";
    this._pathwayDeleteDialogOpen = false;
    this._memoryPathSettingsDialogOpen = false;
    this._pathwayNameDialogMode = "create";
    this._pathwayDraftKind = "sidewalk";
    this._pathwayDraftPoints = [];
    this._pathwayDraftJson = "";
    this._pathwayDraftName = "";
    this._pathwayDraftId = null;
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPendingName = "";
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftSending = false;
    this._markPathwayDraftClean();
    this._memoryPathAutoAddTrimmingEdges = true;
    this._pathwayDraftNotice =
      "Click on the map to add memory path points. Use Trimmer On to add right-side trimmer sections. Hold Shift and drag to pan.";
    this._render();
  }

  _acceptPathwayDraft() {
    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    if (
      this._activeEditTool !== "pa"
      && this._activeEditTool !== "mp"
      && this._activeEditTool !== "pathway-edit"
      && this._activeEditTool !== "pathway-move"
      && this._activeEditTool !== "ng"
      && this._activeEditTool !== "nogozone-edit"
      && this._activeEditTool !== "nogozone-move"
    ) {
      this._clearPendingUnsavedSaveAction();
      return;
    }

    const minimumPoints = isNoGoZone ? 3 : 2;
    if (this._pathwayDraftPoints.length < minimumPoints) {
      this._clearPendingUnsavedSaveAction();
      this._pathwayDraftNotice = isNoGoZone
        ? "Add at least three no-go zone points before confirming."
        : isMemoryPath
          ? "Add at least two memory path points before confirming."
          : "Add at least two pathway points before confirming.";
      this._render();
      return;
    }

    if (
      this._activeEditTool === "pathway-edit"
      || this._activeEditTool === "pathway-move"
      || this._activeEditTool === "nogozone-edit"
      || this._activeEditTool === "nogozone-move"
    ) {
      void this._saveEditedPathway();
      return;
    }

    this._pathwayDraftPendingName = this._pathwayDraftName || (isNoGoZone ? "No-go Zone" : isMemoryPath ? "Memory Path" : "Pathway Draft");
    this._pathwayNameDialogMode = "create";
    this._pathwayNameDialogOpen = true;
    this._pathwayDraftSending = false;
    this._render();
  }

  _cancelPathwayDraft() {
    if (
      this._activeEditTool !== "pa"
      && this._activeEditTool !== "mp"
      && this._activeEditTool !== "pathway-edit"
      && this._activeEditTool !== "pathway-move"
      && this._activeEditTool !== "ng"
      && this._activeEditTool !== "nogozone-edit"
      && this._activeEditTool !== "nogozone-move"
    ) {
      return;
    }

    this._discardPathwayDraft();
  }

  _discardPathwayDraft(options = {}) {
    const {
      notice = true,
      render = true,
      requestFreshMap = true,
    } = options;
    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    this._editContextMenu = null;
    this._unsavedChangesDialogOpen = false;
    this._unsavedChangesAction = null;
    this._unsavedChangesNavigationUrl = "";
    this._unsavedChangesAfterSaveAction = null;
    this._unsavedChangesAfterSaveNavigationUrl = "";
    this._pathwayDraftPoints = [];
    this._pathwayDraftJson = "";
    this._pathwayDraftName = "";
    this._pathwayDraftId = null;
    this._pathwayDraftKind = "pathway";
    this._pathwayDraftEnabled = true;
    this._pathwayDraftType = 0;
    this._resetMemoryPathDraftDetails();
    this._pathwayDraftPendingName = "";
    this._pathwayDraftOriginalSignature = "";
    this._pathwayNameDialogOpen = false;
    this._pathwayDraftSending = false;
    this._pathwayNameDialogMode = "create";
    if (notice) {
      this._pathwayDraftNotice = `${isNoGoZone ? "No-go zone" : isMemoryPath ? "Memory path" : "Pathway"} draft cancelled.`;
    }
    this._activeEditTool = null;
    if (render) {
      this._render();
    }
    if (requestFreshMap) {
      void this._requestFreshMapAfterEdit();
    }
  }

  _handlePathwayDraftClick(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return;
    }

    const nextPointIndex = this._pathwayDraftPoints.length;
    this._pathwayDraftPoints = [...this._pathwayDraftPoints, localPoint];
    this._selectedDraftPointIndex = nextPointIndex;
    if (this._shouldAutoAddMemoryPathTrimmingEdge()) {
      this._addMemoryPathTrimmingEdgeForCenterPoint(nextPointIndex);
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
      ? "No-go zone point added. The boundary closes automatically. Hold Shift and drag to pan."
      : this._pathwayDraftKind === "sidewalk"
        ? "Memory path point added. Trimmer sections follow the Trimmer On/Off control."
      : "Ready to send. While in edit mode, hold Shift and drag to pan.";
    this._render();
  }

  _handleConnectedPathwayDraftClick(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return false;
    }

    const points = Array.isArray(this._pathwayDraftPoints) ? this._pathwayDraftPoints : [];
    const selectedIndex = Number.isInteger(this._selectedDraftPointIndex)
      && this._selectedDraftPointIndex >= 0
      && this._selectedDraftPointIndex < points.length
        ? this._selectedDraftPointIndex
        : null;
    const insertedPointIndex = selectedIndex === null ? points.length : selectedIndex + 1;
    const nextPoints = [...points];
    nextPoints.splice(insertedPointIndex, 0, localPoint);
    this._pathwayDraftPoints = nextPoints;
    this._selectedDraftPointIndex = insertedPointIndex;
    if (this._shouldAutoAddMemoryPathTrimmingEdge()) {
      this._addMemoryPathTrimmingEdgeForCenterPoint(insertedPointIndex);
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    const connectionTarget = selectedIndex === null
      ? points.length ? "last point" : "end of the draft"
      : "selected point";
    this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
      ? `No-go zone point added after the ${connectionTarget}.`
      : this._pathwayDraftKind === "sidewalk"
        ? `Memory path point added after the ${connectionTarget}.`
        : `Pathway point added after the ${connectionTarget}.`;
    this._render();
    return true;
  }

  _handleExistingPathwayEditClick(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return false;
    }

    const segmentIndex = this._nearestDraftSegmentIndex(localPoint);
    if (segmentIndex === null) {
      return false;
    }

    const nextPoints = [...this._pathwayDraftPoints];
    const insertedPointIndex = segmentIndex + 1;
    nextPoints.splice(insertedPointIndex, 0, localPoint);
    this._pathwayDraftPoints = nextPoints;
    this._selectedDraftPointIndex = insertedPointIndex;
    if (this._shouldAutoAddMemoryPathTrimmingEdge()) {
      this._addMemoryPathTrimmingEdgeForCenterPoint(insertedPointIndex);
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = this._pathwayDraftKind === "nogozone"
      ? "Point inserted on no-go zone."
      : this._pathwayDraftKind === "sidewalk"
        ? "Point inserted on memory path."
      : "Point inserted on pathway.";
    this._render();
    return true;
  }

  _startPathwayPointDrag(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return false;
    }

    const pointIndex = this._nearestDraftPointIndex(localPoint);
    if (pointIndex === null) {
      return false;
    }

    event.preventDefault();
    this._clearActiveDrag();
    this._activeDrag = {
      kind: "pathway-point",
      pointerId: event.pointerId,
      pointIndex,
      startPoints: this._pathwayDraftPoints.map((point) => ({ ...point })),
      startTrimmingEdges: this._pathwayDraftTrimmingEdges.map((edge) => ({
        ...edge,
        points: Array.isArray(edge.points) ? edge.points.map((point) => ({ ...point })) : [],
      })),
      dragged: false,
      svg: event.currentTarget,
    };
    this._selectedDraftPointIndex = pointIndex;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
    return true;
  }

  _startMemoryPathTrimmerPointDrag(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return false;
    }

    const hit = this._nearestMemoryPathTrimmingPointHit(localPoint);
    if (!hit) {
      return false;
    }

    event.preventDefault();
    this._clearActiveDrag();
    const wasSelected = hit.edgeIndex === this._selectedTrimmingEdgeIndex
      && hit.pointIndex === this._selectedTrimmingPointIndex;
    this._selectedTrimmingEdgeIndex = hit.edgeIndex;
    this._selectedTrimmingPointIndex = hit.pointIndex;
    this._selectedTrimmingSelectionKind = "point";
    this._activeDrag = {
      kind: "trimmer-point",
      pointerId: event.pointerId,
      edgeIndex: hit.edgeIndex,
      pointIndex: hit.pointIndex,
      wasSelected,
      dragged: false,
      svg: event.currentTarget,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this._handlePointerMove);
    window.addEventListener("pointerup", this._handlePointerUp);
    window.addEventListener("pointercancel", this._handlePointerUp);
    return true;
  }

  _handleMemoryPathTrimmerPointerDown(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    if (event.shiftKey) {
      return this._handleMemoryPathTrimmerCanvasClick(event);
    }

    if (this._startMemoryPathTrimmerPointDrag(event)) {
      return true;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    if (!localPoint) {
      return false;
    }

    const lineHit = this._nearestMemoryPathTrimmingSegmentHit(localPoint);
    if (lineHit) {
      event.preventDefault();
      this._selectedTrimmingEdgeIndex = lineHit.edgeIndex;
      this._selectedTrimmingPointIndex = lineHit.segmentIndex;
      this._selectedTrimmingSelectionKind = "segment";
      this._pathwayDraftNotice = `Selected trimmer segment ${lineHit.edgeIndex + 1}. Hold Shift and click to add a snapped point.`;
      this._render();
      return true;
    }

    const edgeHit = this._nearestMemoryPathRightEdgeHit(localPoint);
    if (!edgeHit) {
      event.preventDefault();
      this._selectedTrimmingEdgeIndex = null;
      this._selectedTrimmingPointIndex = null;
      this._selectedTrimmingSelectionKind = null;
      this._pathwayDraftNotice = "Trimmer segment unselected.";
      this._render();
      return true;
    }

    return false;
  }

  _handleMemoryPathTrimmerCanvasClick(event) {
    if (!(event.currentTarget instanceof SVGSVGElement) || event.button !== 0) {
      return false;
    }

    const localPoint = this._localPointFromSvgEvent(event.currentTarget, event);
    const snappedPoint = localPoint ? this._snapMemoryPathTrimmerPoint(localPoint) : null;
    if (!snappedPoint) {
      this._pathwayDraftNotice = "Hold Shift near the sidewalk edge to add trimmer points.";
      this._render();
      return false;
    }

    event.preventDefault();
    const lineHit = this._nearestMemoryPathTrimmingSegmentHit(localPoint);
    let edgeIndex = Number.isInteger(this._selectedTrimmingEdgeIndex)
      ? this._selectedTrimmingEdgeIndex
      : -1;
    let insertIndex = Number.isInteger(this._selectedTrimmingPointIndex)
      ? this._selectedTrimmingSelectionKind === "segment"
        ? this._selectedTrimmingPointIndex + 1
        : this._selectedTrimmingPointIndex + 1
      : null;

    if (lineHit) {
      edgeIndex = lineHit.edgeIndex;
      insertIndex = lineHit.segmentIndex + 1;
    }

    if (edgeIndex < 0 || edgeIndex >= this._pathwayDraftTrimmingEdges.length) {
      edgeIndex = this._pathwayDraftTrimmingEdges.length;
      this._pathwayDraftTrimmingEdges = [
        ...this._pathwayDraftTrimmingEdges,
        {
          id: this._nextMemoryPathTrimmingEdgeId(),
          ref: {
            latitude: 0.0,
            longitude: 0.0,
          },
          points: [],
        },
      ];
      insertIndex = 0;
    }

    const nextEdges = this._pathwayDraftTrimmingEdges.map((edge, index) => {
      if (index !== edgeIndex) {
        return edge;
      }

      const points = Array.isArray(edge.points) ? [...edge.points] : [];
      const safeInsertIndex = insertIndex === null
        ? points.length
        : Math.max(0, Math.min(points.length, insertIndex));
      points.splice(safeInsertIndex, 0, snappedPoint);
      this._selectedTrimmingPointIndex = safeInsertIndex;
      this._selectedTrimmingSelectionKind = "point";
      return {
        ...edge,
        points,
      };
    });

    this._pathwayDraftTrimmingEdges = nextEdges;
    this._selectedTrimmingEdgeIndex = edgeIndex;
    this._pathwayDraftTrimmingEdgeAnchors =
      this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = `Trimmer point added to segment ${edgeIndex + 1}.`;
    this._render();
    return true;
  }

  _removePathwayDraftPoint(pointIndex) {
    if (pointIndex < 0 || pointIndex >= this._pathwayDraftPoints.length) {
      return;
    }

    const minimumPoints = this._pathwayDraftKind === "nogozone" ? 3 : 2;
    const nextPoints = [...this._pathwayDraftPoints];
    nextPoints.splice(pointIndex, 1);
    this._pathwayDraftPoints = nextPoints;
    this._selectedDraftPointIndex = nextPoints.length
      ? Math.min(pointIndex, nextPoints.length - 1)
      : null;
    if (this._pathwayDraftKind === "sidewalk") {
      this._pathwayDraftTrimmingEdgeAnchors =
        this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice =
      nextPoints.length >= minimumPoints
        ? `Point removed from ${this._pathwayDraftKind === "nogozone" ? "no-go zone" : this._pathwayDraftKind === "sidewalk" ? "memory path" : "pathway"}.`
        : `Point removed. Add at least ${minimumPoints} points before confirming.`;
  }

  _nearestDraftPointIndex(localPoint, tolerance = 0.35) {
    let bestIndex = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, point] of this._pathwayDraftPoints.entries()) {
      const distance = Math.hypot(Number(point.x) - Number(localPoint.x), Number(point.y) - Number(localPoint.y));
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  _nearestMemoryPathTrimmingPointHit(localPoint, tolerance = 0.35) {
    let bestHit = null;
    for (const [edgeIndex, edge] of this._pathwayDraftTrimmingEdges.entries()) {
      const points = Array.isArray(edge?.points) ? edge.points : [];
      for (const [pointIndex, point] of points.entries()) {
        const distance = Math.hypot(
          Number(point.x) - Number(localPoint.x),
          Number(point.y) - Number(localPoint.y),
        );
        if (distance <= tolerance && (!bestHit || distance < bestHit.distance)) {
          bestHit = {
            edgeIndex,
            pointIndex,
            distance,
          };
        }
      }
    }
    return bestHit;
  }

  _nearestMemoryPathTrimmingSegmentHit(localPoint, tolerance = 0.35) {
    let bestHit = null;
    for (const [edgeIndex, edge] of this._pathwayDraftTrimmingEdges.entries()) {
      const points = Array.isArray(edge?.points) ? edge.points : [];
      for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        const distance = this._distancePointToSegment(
          localPoint,
          points[segmentIndex],
          points[segmentIndex + 1],
        );
        if (distance <= tolerance && (!bestHit || distance < bestHit.distance)) {
          bestHit = {
            edgeIndex,
            segmentIndex,
            distance,
          };
        }
      }
    }
    return bestHit;
  }

  _nearestMemoryPathRightEdgeHit(localPoint, tolerance = 0.45) {
    const points = this._memoryPathRightEdgeFromPoints(this._pathwayDraftPoints);
    if (points.length < 2) {
      return null;
    }

    let bestHit = null;
    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
      const distance = this._distancePointToSegment(
        localPoint,
        points[segmentIndex],
        points[segmentIndex + 1],
      );
      if (distance <= tolerance && (!bestHit || distance < bestHit.distance)) {
        bestHit = {
          segmentIndex,
          distance,
        };
      }
    }
    return bestHit;
  }

  _updateMemoryPathTrimmingPoint(edgeIndex, pointIndex, point) {
    if (
      edgeIndex < 0
      || pointIndex < 0
      || edgeIndex >= this._pathwayDraftTrimmingEdges.length
    ) {
      return false;
    }

    const edge = this._pathwayDraftTrimmingEdges[edgeIndex];
    const points = Array.isArray(edge?.points) ? [...edge.points] : [];
    if (pointIndex >= points.length) {
      return false;
    }

    points[pointIndex] = point;
    this._pathwayDraftTrimmingEdges = this._pathwayDraftTrimmingEdges.map((candidate, index) =>
      index === edgeIndex
        ? {
            ...candidate,
            points,
          }
        : candidate,
    );
    return true;
  }

  _removeMemoryPathTrimmingPoint(edgeIndex, pointIndex) {
    if (
      edgeIndex < 0
      || pointIndex < 0
      || edgeIndex >= this._pathwayDraftTrimmingEdges.length
    ) {
      return false;
    }

    const nextEdges = this._pathwayDraftTrimmingEdges
      .map((edge, index) => {
        if (index !== edgeIndex) {
          return edge;
        }

        const points = Array.isArray(edge.points) ? [...edge.points] : [];
        points.splice(pointIndex, 1);
        return {
          ...edge,
          points,
        };
      })
      .filter((edge) => Array.isArray(edge.points) && edge.points.length > 0);

    this._pathwayDraftTrimmingEdges = nextEdges;
    if (edgeIndex >= nextEdges.length) {
      this._selectedTrimmingEdgeIndex = nextEdges.length ? nextEdges.length - 1 : null;
      this._selectedTrimmingPointIndex = null;
      this._selectedTrimmingSelectionKind = null;
    } else {
      this._selectedTrimmingEdgeIndex = edgeIndex;
      const pointCount = nextEdges[edgeIndex]?.points?.length || 0;
      this._selectedTrimmingPointIndex = pointCount
        ? Math.min(pointIndex, pointCount - 1)
        : null;
      this._selectedTrimmingSelectionKind = pointCount ? "point" : null;
    }
    this._pathwayDraftTrimmingEdgeAnchors =
      this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    this._pathwayDraftNotice = "Trimmer point removed.";
    return true;
  }

  _nearestDraftSegmentIndex(localPoint, tolerance = 0.5) {
    if (this._pathwayDraftPoints.length < 2) {
      return null;
    }

    const closed = this._pathwayDraftKind === "nogozone";
    let bestIndex = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const segmentCount = closed ? this._pathwayDraftPoints.length : this._pathwayDraftPoints.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = this._pathwayDraftPoints[index];
      const end = this._pathwayDraftPoints[(index + 1) % this._pathwayDraftPoints.length];
      const distance = this._distancePointToSegment(localPoint, start, end);
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  _localPointFromSvgEvent(svg, event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const viewBox = svg.viewBox.baseVal;
    const svgX = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width;
    const svgY = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height;
    const contentX = (svgX - this._viewState.panX) / this._viewState.scale;
    const contentY = (svgY - this._viewState.panY) / this._viewState.scale;

    return {
      x: -contentX,
      y: -contentY,
    };
  }

  _nearestPathwayHit(svg, event, tolerance = 0.5) {
    const localPoint = this._localPointFromSvgEvent(svg, event);
    if (!localPoint) {
      return null;
    }

    let bestHit = null;
    for (const [index, shape] of this._sitePathways().entries()) {
      const points = Array.isArray(shape?.points) ? shape.points : [];
      for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        const distance = this._distancePointToSegment(localPoint, points[segmentIndex], points[segmentIndex + 1]);
        if (distance <= tolerance && (!bestHit || distance < bestHit.distance)) {
          bestHit = {
            key: this._pathwayKey(shape, index),
            shape,
            distance,
            segmentIndex,
          };
        }
      }
    }

    return bestHit;
  }

  _nearestMemoryPathHit(svg, event, tolerance = 0.5) {
    const localPoint = this._localPointFromSvgEvent(svg, event);
    if (!localPoint) {
      return null;
    }

    let bestHit = null;
    for (const [index, shape] of this._siteMemoryPaths().entries()) {
      const points = Array.isArray(shape?.points) ? shape.points : [];
      for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        const distance = this._distancePointToSegment(localPoint, points[segmentIndex], points[segmentIndex + 1]);
        if (distance <= tolerance && (!bestHit || distance < bestHit.distance)) {
          bestHit = {
            key: this._memoryPathKey(shape, index),
            shape,
            distance,
            segmentIndex,
          };
        }
      }
    }

    return bestHit;
  }

  _nearestNoGoHit(svg, event, tolerance = 0.5) {
    const localPoint = this._localPointFromSvgEvent(svg, event);
    if (!localPoint) {
      return null;
    }

    let bestHit = null;
    for (const [index, shape] of this._siteNoGoZones().entries()) {
      const points = this._editableClosedShapePoints(shape?.points);
      if (points.length < 3) {
        continue;
      }

      const inside = this._pointInPolygon(localPoint, points);
      let boundaryDistance = Number.POSITIVE_INFINITY;
      for (let segmentIndex = 0; segmentIndex < points.length; segmentIndex += 1) {
        const start = points[segmentIndex];
        const end = points[(segmentIndex + 1) % points.length];
        boundaryDistance = Math.min(
          boundaryDistance,
          this._distancePointToSegment(localPoint, start, end),
        );
      }

      if (!inside && boundaryDistance > tolerance) {
        continue;
      }

      const score = inside ? -1 : boundaryDistance;
      if (!bestHit || score < bestHit.score) {
        bestHit = {
          key: this._noGoKey(shape, index),
          shape,
          score,
        };
      }
    }

    return bestHit;
  }

  _pointInPolygon(point, points) {
    if (!Array.isArray(points) || points.length < 3) {
      return false;
    }

    const x = Number(point.x);
    const y = Number(point.y);
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = Number(points[i].x);
      const yi = Number(points[i].y);
      const xj = Number(points[j].x);
      const yj = Number(points[j].y);
      const intersects = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  _editableClosedShapePoints(points) {
    const source = Array.isArray(points) ? points.map((point) => ({ ...point })) : [];
    if (source.length >= 2) {
      const first = source[0];
      const last = source[source.length - 1];
      if (
        Math.abs(Number(first.x) - Number(last.x)) < 0.0001
        && Math.abs(Number(first.y) - Number(last.y)) < 0.0001
      ) {
        source.pop();
      }
    }
    return source;
  }

  _distancePointToSegment(point, start, end) {
    const px = Number(point.x);
    const py = Number(point.y);
    const x1 = Number(start.x);
    const y1 = Number(start.y);
    const x2 = Number(end.x);
    const y2 = Number(end.y);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0.000001) {
      return Math.hypot(px - x1, py - y1);
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    const projectedX = x1 + t * dx;
    const projectedY = y1 + t * dy;
    return Math.hypot(px - projectedX, py - projectedY);
  }

  _buildPathwayDraftJson() {
    const reference = this._entry?.site_map?.reference;
    if (!reference) {
      return "";
    }

    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    const range = this._pathwayDraftRange();
    const payload = isNoGoZone
      ? {
          range,
          ref: {
            latitude: reference.latitude,
            longitude: reference.longitude,
          },
          name: this._pathwayDraftName || "No-go Zone",
          type: this._pathwayDraftType,
          enable: this._pathwayDraftEnabled !== false,
          trimming_edges: [],
        }
      : isMemoryPath
        ? {
            connectids: Array.isArray(this._pathwayDraftConnectIds) ? this._pathwayDraftConnectIds : [],
            head_type: Number.isFinite(Number(this._pathwayDraftHeadType))
              ? Number(this._pathwayDraftHeadType)
              : 99,
            name: this._pathwayDraftName || "Memory Path",
            range,
            ref: {
              latitude: reference.latitude,
              longitude: reference.longitude,
            },
            snowPiles: Array.isArray(this._pathwayDraftSnowPiles) ? this._pathwayDraftSnowPiles : [],
            trimming_edges: this._memoryPathTrimmingEdges(range),
          }
      : {
          connectids: [],
          leaf_piles: [],
          name: this._pathwayDraftName || "Pathway Draft",
          range,
          ref: {
            latitude: reference.latitude,
            longitude: reference.longitude,
          },
          snowPiles: [],
          trimming_edges: [],
        };

    if (this._pathwayDraftId !== null && this._pathwayDraftId !== undefined && `${this._pathwayDraftId}` !== "") {
      payload.id = this._pathwayDraftId;
    }

    return JSON.stringify(payload, null, 2);
  }

  _dismissPathwayNameDialog() {
    if (this._pathwayDraftSending) {
      return;
    }
    this._clearPendingUnsavedSaveAction();
    this._pathwayNameDialogOpen = false;
    this._render();
  }

  _pathwayDraftCommandName() {
    if (this._pathwayDraftKind === "nogozone") {
      return "save_nogozone";
    }
    if (this._pathwayDraftKind === "sidewalk") {
      return "save_sidewalk";
    }
    return "save_pathway";
  }

  _pathwayDraftSaveApiPath() {
    if (this._pathwayDraftKind === "nogozone") {
      return "s2jyarbo/save_nogozone";
    }
    if (this._pathwayDraftKind === "sidewalk") {
      return "s2jyarbo/save_sidewalk";
    }
    return "s2jyarbo/save_pathway";
  }

  async _confirmPathwayDraftName() {
    if (!this._pathwayNameDialogOpen || this._pathwayDraftSending) {
      return;
    }

    this._pathwayDraftName = (this._pathwayDraftPendingName || "").trim() || "Pathway Draft";
    if (this._pathwayDraftKind === "sidewalk" && !(this._pathwayDraftPendingName || "").trim()) {
      this._pathwayDraftName = "Memory Path";
    } else if (this._pathwayDraftKind === "nogozone" && !(this._pathwayDraftPendingName || "").trim()) {
      this._pathwayDraftName = "No-go Zone";
    }
    this._pathwayDraftJson = this._buildPathwayDraftJson();
    let commandPayload;
    try {
      commandPayload = JSON.parse(this._pathwayDraftJson);
    } catch (_err) {
      this._clearPendingUnsavedSaveAction();
      this._pathwayDraftNotice = "Pathway JSON is invalid and could not be sent.";
      this._render();
      return;
    }

    if (!this._hass || !this._entry?.entry_id) {
      this._clearPendingUnsavedSaveAction();
      this._pathwayDraftNotice = `Home Assistant is not ready to send ${this._pathwayDraftCommandName()}.`;
      this._render();
      return;
    }

    this._pathwayDraftSending = true;
    this._render();

    try {
      const apiPath = this._pathwayDraftSaveApiPath();
      const response = await this._hass.callApi("POST", apiPath, {
        entry_id: this._entry.entry_id,
        payload: commandPayload,
      });
      const topic = response?.topic || "command topic";
      this._pathwayDraftCommittedJson = this._pathwayDraftJson;
      this._pathwayDraftPoints = [];
      this._pathwayDraftOriginalSignature = "";
      this._pathwayNameDialogOpen = false;
      this._pathwayNameDialogMode = "create";
      this._selectedPathwayKey = "";
      this._selectedMemoryPathKey = "";
      this._selectedNoGoKey = "";
      this._pathwayDraftNotice =
        `${this._pathwayDraftCommandName()} sent as "${this._pathwayDraftName}" via ${topic}.`;
      this._activeEditTool = null;
      void this._requestFreshMapAfterEdit();
      this._completePendingUnsavedSaveAction();
    } catch (err) {
      this._clearPendingUnsavedSaveAction();
      const message = err instanceof Error ? err.message : String(err);
      this._pathwayDraftNotice = `${this._pathwayDraftCommandName()} failed: ${message}`;
    } finally {
      this._pathwayDraftSending = false;
      this._render();
    }
  }

  async _saveEditedPathway() {
    if (!this._hass || !this._entry?.entry_id) {
      this._clearPendingUnsavedSaveAction();
      this._pathwayDraftNotice = `Home Assistant is not ready to save the edited ${this._pathwayDraftKind === "nogozone" ? "no-go zone" : this._pathwayDraftKind === "sidewalk" ? "memory path" : "pathway"}.`;
      this._render();
      return;
    }

    this._pathwayDraftJson = this._buildPathwayDraftJson();
    let commandPayload;
    try {
      commandPayload = JSON.parse(this._pathwayDraftJson);
    } catch (_err) {
      this._clearPendingUnsavedSaveAction();
      this._pathwayDraftNotice = `Edited ${this._pathwayDraftKind === "nogozone" ? "no-go zone" : this._pathwayDraftKind === "sidewalk" ? "memory path" : "pathway"} JSON is invalid and could not be sent.`;
      this._render();
      return;
    }

    this._pathwayDraftSending = true;
    this._render();
    try {
      const apiPath = this._pathwayDraftSaveApiPath();
      const response = await this._hass.callApi("POST", apiPath, {
        entry_id: this._entry.entry_id,
        payload: commandPayload,
      });
      const topic = response?.topic || "command topic";
      this._pathwayDraftCommittedJson = this._pathwayDraftJson;
      this._pathwayDraftPoints = [];
      this._pathwayDraftOriginalSignature = "";
      this._selectedPathwayKey = "";
      this._selectedMemoryPathKey = "";
      this._selectedNoGoKey = "";
      this._pathwayDraftNotice =
        `Edited ${this._pathwayDraftKind === "nogozone" ? "no-go zone" : this._pathwayDraftKind === "sidewalk" ? "memory path" : "pathway"} saved as "${this._pathwayDraftName}" via ${topic}.`;
      this._activeEditTool = null;
      void this._requestFreshMapAfterEdit();
      this._completePendingUnsavedSaveAction();
    } catch (err) {
      this._clearPendingUnsavedSaveAction();
      const message = err instanceof Error ? err.message : String(err);
      this._pathwayDraftNotice = `${this._pathwayDraftCommandName()} failed: ${message}`;
    } finally {
      this._pathwayDraftSending = false;
      this._render();
    }
  }

  _dismissPathwayDeleteDialog() {
    if (this._pathwayDraftSending) {
      return;
    }

    this._pathwayDeleteDialogOpen = false;
    this._render();
  }

  _dismissMemoryPathSettingsDialog() {
    if (this._pathwayDraftSending) {
      return;
    }

    this._memoryPathSettingsDialogOpen = false;
    this._render();
  }

  async _saveSelectedMemoryPathSettings() {
    const selectedMemoryPath = this._selectedMemoryPath();
    if (!selectedMemoryPath || this._pathwayDraftSending || !this._hass || !this._entry?.entry_id) {
      return;
    }

    if (selectedMemoryPath.id === null || selectedMemoryPath.id === undefined || `${selectedMemoryPath.id}` === "") {
      this._pathwayDraftNotice = "The selected memory path does not have an id and cannot save settings.";
      this._render();
      return;
    }

    const bladeHeight = Number(this._memoryPathSettings.blade_height);
    const planSpeed = Number(this._memoryPathSettings.plan_speed);
    const payload = {
      blade_speed: 0,
      blade_height: Number.isFinite(bladeHeight) ? bladeHeight : 0,
      turn_type: 0,
      land_push_pod_place: 0,
      route_angle: 0,
      route_dis: 0.0,
      offset_enable: null,
      en_blade: this._memoryPathSettings.en_blade !== false,
      plan_speed: Number.isFinite(planSpeed) ? planSpeed : 0.5,
      id: selectedMemoryPath.id,
    };

    this._pathwayDraftSending = true;
    this._render();
    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/save_memory_path_settings", {
        entry_id: this._entry.entry_id,
        payload,
      });
      const topic = response?.topic || "command topic";
      this._memoryPathSettingsDialogOpen = false;
      this._pathwayDraftNotice =
        `save_mower_path_memory_params sent for "${selectedMemoryPath.name || selectedMemoryPath.id || "memory path"}" via ${topic}.`;
      void this._requestFreshMapAfterEdit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._pathwayDraftNotice = `save_mower_path_memory_params failed: ${message}`;
    } finally {
      this._pathwayDraftSending = false;
      this._render();
    }
  }

  async _confirmDeleteSelectedPathway() {
    const selectedPathway = this._selectedPathway();
    const selectedMemoryPath = selectedPathway ? null : this._selectedMemoryPath();
    const selectedNoGoZone = selectedPathway || selectedMemoryPath ? null : this._selectedNoGoZone();
    if ((!selectedPathway && !selectedMemoryPath && !selectedNoGoZone) || this._pathwayDraftSending || !this._hass || !this._entry?.entry_id) {
      return;
    }

    const isNoGoZone = Boolean(selectedNoGoZone && !selectedPathway);
    const isMemoryPath = Boolean(selectedMemoryPath && !selectedPathway && !selectedNoGoZone);
    const payload = isNoGoZone
      ? { id: selectedNoGoZone.id }
      : {};
    if (isMemoryPath) {
      if (selectedMemoryPath.id !== null && selectedMemoryPath.id !== undefined && `${selectedMemoryPath.id}` !== "") {
        payload.id = selectedMemoryPath.id;
      }
    } else if (!isNoGoZone) {
      if (selectedPathway.id !== null && selectedPathway.id !== undefined && `${selectedPathway.id}` !== "") {
        payload.id = selectedPathway.id;
      }
      if (selectedPathway.name) {
        payload.name = selectedPathway.name;
      }
    }
    if (isNoGoZone && (selectedNoGoZone.id === null || selectedNoGoZone.id === undefined || `${selectedNoGoZone.id}` === "")) {
      this._pathwayDraftNotice = "The selected no-go zone does not have an id and cannot be deleted.";
      this._render();
      return;
    }
    if (isMemoryPath && (selectedMemoryPath.id === null || selectedMemoryPath.id === undefined || `${selectedMemoryPath.id}` === "")) {
      this._pathwayDraftNotice = "The selected memory path does not have an id and cannot be deleted.";
      this._render();
      return;
    }

    this._pathwayDraftSending = true;
    this._render();
    try {
      const apiPath = isNoGoZone
        ? "s2jyarbo/delete_nogozone"
        : isMemoryPath
          ? "s2jyarbo/delete_sidewalk"
          : "s2jyarbo/delete_pathway";
      const response = await this._hass.callApi("POST", apiPath, {
        entry_id: this._entry.entry_id,
        payload,
      });
      const topic = response?.topic || "command topic";
      this._pathwayDeleteDialogOpen = false;
      this._selectedPathwayKey = "";
      this._selectedMemoryPathKey = "";
      this._selectedNoGoKey = "";
      const selectedFeature = selectedNoGoZone || selectedMemoryPath || selectedPathway;
      const commandName = isNoGoZone ? "del_nogozone" : isMemoryPath ? "del_sidewalk" : "del_pathway";
      const fallbackLabel = isNoGoZone ? "no-go zone" : isMemoryPath ? "memory path" : "pathway";
      this._pathwayDraftNotice =
        `${commandName} sent for "${selectedFeature.name || selectedFeature.id || fallbackLabel}" via ${topic}.`;
      void this._requestFreshMapAfterEdit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._pathwayDraftNotice = `${isNoGoZone ? "del_nogozone" : isMemoryPath ? "del_sidewalk" : "del_pathway"} failed: ${message}`;
    } finally {
      this._pathwayDraftSending = false;
      this._render();
    }
  }

  async _toggleSelectedNoGoZoneEnabled() {
    const selectedNoGoZone = this._selectedNoGoZone();
    if (!selectedNoGoZone || this._pathwayDraftSending || !this._hass || !this._entry?.entry_id) {
      return;
    }

    this._pathwayDraftKind = "nogozone";
    this._pathwayDraftId = selectedNoGoZone.id ?? null;
    this._pathwayDraftName = selectedNoGoZone.name || "No-go Zone";
    this._pathwayDraftEnabled = !(selectedNoGoZone.enable !== false);
    this._pathwayDraftType = Number.isFinite(Number(selectedNoGoZone.type))
      ? Number(selectedNoGoZone.type)
      : 0;
    this._pathwayDraftPoints = this._editableClosedShapePoints(selectedNoGoZone.points);
    this._pathwayDraftJson = this._buildPathwayDraftJson();

    let commandPayload;
    try {
      commandPayload = JSON.parse(this._pathwayDraftJson);
    } catch (_err) {
      this._pathwayDraftNotice = "No-go zone JSON is invalid and could not be sent.";
      this._render();
      return;
    }

    this._pathwayDraftSending = true;
    this._render();
    try {
      const response = await this._hass.callApi("POST", "s2jyarbo/save_nogozone", {
        entry_id: this._entry.entry_id,
        payload: commandPayload,
      });
      const topic = response?.topic || "command topic";
      this._pathwayDraftCommittedJson = this._pathwayDraftJson;
      this._pathwayDraftNotice =
        `save_nogozone sent for "${this._pathwayDraftName}" (${this._pathwayDraftEnabled ? "enabled" : "disabled"}) via ${topic}.`;
      void this._requestFreshMapAfterEdit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._pathwayDraftNotice = `save_nogozone failed: ${message}`;
    } finally {
      this._pathwayDraftSending = false;
      this._render();
    }
  }

  _pathwayDraftRange() {
    const points = this._pathwayDraftPoints;
    if (!points.length) {
      return [];
    }

    if (this._pathwayDraftKind === "nogozone") {
      const closedPoints = points.map((point) => ({
        x: Number(this._number(point.x)),
        y: Number(this._number(point.y)),
        phi: 0,
      }));
      if (closedPoints.length) {
        const first = closedPoints[0];
        const last = closedPoints[closedPoints.length - 1];
        if (
          Math.abs(Number(first.x) - Number(last.x)) > 0.0001
          || Math.abs(Number(first.y) - Number(last.y)) > 0.0001
        ) {
          closedPoints.push({ ...first });
        }
      }
      return closedPoints;
    }

    return this._rangeFromOpenPoints(points);
  }

  _rangeFromOpenPoints(points) {
    return points.map((point, index) => {
      let phi = 0;
      if (points.length > 1) {
        let fromPoint;
        let toPoint;
        if (index === 0) {
          fromPoint = point;
          toPoint = points[index + 1];
        } else if (index === points.length - 1) {
          fromPoint = points[index - 1];
          toPoint = point;
        } else {
          fromPoint = points[index - 1];
          toPoint = points[index + 1];
        }
        phi = Math.atan2(
          Number(toPoint.y) - Number(fromPoint.y),
          Number(toPoint.x) - Number(fromPoint.x),
        );
      }

      return {
        x: Number(this._number(point.x)),
        y: Number(this._number(point.y)),
        phi: Number(this._number(phi)),
      };
    });
  }

  _memoryPathTrimmingEdges(range) {
    if (Array.isArray(this._pathwayDraftTrimmingEdges) && this._pathwayDraftTrimmingEdges.length) {
      return this._pathwayDraftTrimmingEdges
        .map((edge, index) => {
          const edgeRange = this._rangeFromOpenPoints(Array.isArray(edge.points) ? edge.points : []);
          if (edgeRange.length < 2) {
            return null;
          }

          return {
            id: edge.id ?? index,
            range: edgeRange,
            ref: edge.ref || {
              latitude: 0.0,
              longitude: 0.0,
            },
          };
        })
        .filter((edge) => edge !== null);
    }

    return [];
  }

  _memoryPathDraftEdgePoints() {
    if (Array.isArray(this._pathwayDraftTrimmingEdges) && this._pathwayDraftTrimmingEdges.length) {
      return this._pathwayDraftTrimmingEdges
        .map((edge) => ({
          ...edge,
          points: Array.isArray(edge.points) ? edge.points : [],
        }))
        .filter((edge) => edge.points.length >= 2);
    }

    return [];
  }

  _shouldAutoAddMemoryPathTrimmingEdge() {
    return (
      this._pathwayDraftKind === "sidewalk"
      && this._activeEditTool === "mp"
      && this._memoryPathAutoAddTrimmingEdges === true
    );
  }

  _addMemoryPathTrimmingEdgeForCenterPoint(pointIndex) {
    if (
      this._pathwayDraftKind !== "sidewalk"
      || !Array.isArray(this._pathwayDraftPoints)
      || this._pathwayDraftPoints.length < 2
      || pointIndex < 0
      || pointIndex >= this._pathwayDraftPoints.length
    ) {
      return false;
    }

    const segmentPoints = [];
    if (pointIndex > 0) {
      segmentPoints.push(this._pathwayDraftPoints[pointIndex - 1]);
    }
    segmentPoints.push(this._pathwayDraftPoints[pointIndex]);
    if (pointIndex < this._pathwayDraftPoints.length - 1) {
      segmentPoints.push(this._pathwayDraftPoints[pointIndex + 1]);
    }

    const edgePoints = this._memoryPathRightEdgeFromPoints(segmentPoints);
    if (edgePoints.length < 2) {
      return false;
    }

    const edge = {
      id: this._nextMemoryPathTrimmingEdgeId(),
      ref: {
        latitude: 0.0,
        longitude: 0.0,
      },
      points: edgePoints,
    };
    const edgeIndex = this._pathwayDraftTrimmingEdges.length;
    this._pathwayDraftTrimmingEdges = [
      ...this._pathwayDraftTrimmingEdges,
      edge,
    ];
    this._selectedTrimmingEdgeIndex = edgeIndex;
    this._selectedTrimmingPointIndex = pointIndex > 0 ? 1 : 0;
    this._pathwayDraftTrimmingEdgeAnchors =
      this._memoryPathTrimmingEdgeAnchors(this._pathwayDraftPoints, this._pathwayDraftTrimmingEdges);
    return true;
  }

  _nextMemoryPathTrimmingEdgeId() {
    const ids = this._pathwayDraftTrimmingEdges
      .map((edge) => Number(edge?.id))
      .filter((id) => Number.isFinite(id));
    return ids.length ? Math.max(...ids) + 1 : 0;
  }

  _snapMemoryPathTrimmerPoint(localPoint) {
    if (!Array.isArray(this._pathwayDraftPoints) || this._pathwayDraftPoints.length < 2) {
      return null;
    }

    const ratio = this._polylineProjectionRatio(this._pathwayDraftPoints, localPoint);
    return this._memoryPathRightEdgePointAtRatio(this._pathwayDraftPoints, ratio);
  }

  _memoryPathTrimmingEdgeAnchors(pathPoints, trimmingEdges) {
    if (!Array.isArray(pathPoints) || pathPoints.length < 2 || !Array.isArray(trimmingEdges)) {
      return [];
    }

    return trimmingEdges
      .map((edge) => {
        const points = Array.isArray(edge.points) ? edge.points : [];
        return {
          id: edge.id,
          ref: edge.ref,
          ratios: points
            .map((point) => this._polylineProjectionRatio(pathPoints, point))
            .filter((ratio) => Number.isFinite(ratio)),
        };
      })
      .filter((edge) => edge.ratios.length >= 2);
  }

  _refreshMemoryPathDraftTrimmingEdgesFromAnchors() {
    if (this._pathwayDraftKind !== "sidewalk" || !Array.isArray(this._pathwayDraftTrimmingEdgeAnchors)) {
      return false;
    }

    const anchors = this._pathwayDraftTrimmingEdgeAnchors;
    if (!anchors.length || !Array.isArray(this._pathwayDraftPoints) || this._pathwayDraftPoints.length < 2) {
      return false;
    }

    this._pathwayDraftTrimmingEdges = anchors
      .map((edge) => ({
        id: edge.id,
        ref: edge.ref,
        points: edge.ratios
          .map((ratio) => this._memoryPathRightEdgePointAtRatio(this._pathwayDraftPoints, ratio))
          .filter((point) => point !== null),
      }))
      .filter((edge) => edge.points.length >= 2);
    return true;
  }

  _polylineProjectionRatio(pathPoints, point) {
    const totalLength = this._polylineLength(pathPoints);
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return 0;
    }

    const px = Number(point?.x);
    const py = Number(point?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return 0;
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestLength = 0;
    let walkedLength = 0;
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const start = pathPoints[index];
      const end = pathPoints[index + 1];
      const x1 = Number(start.x);
      const y1 = Number(start.y);
      const x2 = Number(end.x);
      const y2 = Number(end.y);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length <= 0.000001) {
        continue;
      }

      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
      const projectedX = x1 + t * dx;
      const projectedY = y1 + t * dy;
      const distance = Math.hypot(px - projectedX, py - projectedY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLength = walkedLength + t * length;
      }
      walkedLength += length;
    }

    return Math.max(0, Math.min(1, bestLength / totalLength));
  }

  _nearestPolylineProjection(pathPoints, point) {
    if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
      return null;
    }

    const px = Number(point?.x);
    const py = Number(point?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return null;
    }

    let bestProjection = null;
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const start = pathPoints[index];
      const end = pathPoints[index + 1];
      const x1 = Number(start.x);
      const y1 = Number(start.y);
      const x2 = Number(end.x);
      const y2 = Number(end.y);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      if (!Number.isFinite(lengthSquared) || lengthSquared <= 0.000001) {
        continue;
      }

      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
      const projectedX = x1 + t * dx;
      const projectedY = y1 + t * dy;
      const distance = Math.hypot(px - projectedX, py - projectedY);
      if (!bestProjection || distance < bestProjection.distance) {
        bestProjection = {
          segmentIndex: index,
          segmentRatio: t,
          distance,
        };
      }
    }

    return bestProjection;
  }

  _resnapMemoryPathTrimmingEdgesForMovedCenterPoint(pointIndex, oldPathPoints, newPathPoints, oldTrimmingEdges) {
    if (
      !Array.isArray(oldPathPoints)
      || !Array.isArray(newPathPoints)
      || oldPathPoints.length !== newPathPoints.length
      || !Array.isArray(oldTrimmingEdges)
      || oldPathPoints.length < 2
    ) {
      return Array.isArray(this._pathwayDraftTrimmingEdges) ? this._pathwayDraftTrimmingEdges : [];
    }

    const affectedSegments = new Set();
    if (pointIndex > 0) {
      affectedSegments.add(pointIndex - 1);
    }
    if (pointIndex < oldPathPoints.length - 1) {
      affectedSegments.add(pointIndex);
    }

    if (!affectedSegments.size) {
      return oldTrimmingEdges;
    }

    return oldTrimmingEdges.map((edge) => ({
      ...edge,
      points: Array.isArray(edge.points)
        ? edge.points.map((point) => {
            const projection = this._nearestPolylineProjection(oldPathPoints, point);
            if (!projection || !affectedSegments.has(projection.segmentIndex)) {
              return { ...point };
            }

            return this._memoryPathRightEdgePointOnSegment(
              newPathPoints,
              projection.segmentIndex,
              projection.segmentRatio,
            ) || { ...point };
          })
        : [],
    }));
  }

  _polylineLength(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return 0;
    }

    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      total += Math.hypot(
        Number(points[index + 1].x) - Number(points[index].x),
        Number(points[index + 1].y) - Number(points[index].y),
      );
    }
    return total;
  }

  _memoryPathRightEdgePointAtRatio(pathPoints, ratio) {
    if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
      return null;
    }

    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const totalLength = this._polylineLength(pathPoints);
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return null;
    }

    const targetLength = totalLength * safeRatio;
    let walkedLength = 0;
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const start = pathPoints[index];
      const end = pathPoints[index + 1];
      const x1 = Number(start.x);
      const y1 = Number(start.y);
      const x2 = Number(end.x);
      const y2 = Number(end.y);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length <= 0.000001) {
        continue;
      }

      if (walkedLength + length >= targetLength || index === pathPoints.length - 2) {
        const segmentRatio = Math.max(0, Math.min(1, (targetLength - walkedLength) / length));
        const phi = Math.atan2(dy, dx);
        const x = x1 + dx * segmentRatio;
        const y = y1 + dy * segmentRatio;
        return {
          x: Number(this._number(x - Math.sin(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
          y: Number(this._number(y + Math.cos(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
        };
      }

      walkedLength += length;
    }

    return null;
  }

  _memoryPathRightEdgePointOnSegment(pathPoints, segmentIndex, segmentRatio) {
    if (
      !Array.isArray(pathPoints)
      || segmentIndex < 0
      || segmentIndex >= pathPoints.length - 1
    ) {
      return null;
    }

    const start = pathPoints[segmentIndex];
    const end = pathPoints[segmentIndex + 1];
    const x1 = Number(start.x);
    const y1 = Number(start.y);
    const x2 = Number(end.x);
    const y2 = Number(end.y);
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      return null;
    }

    const safeRatio = Math.max(0, Math.min(1, Number(segmentRatio) || 0));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const phi = Math.atan2(dy, dx);
    const x = x1 + dx * safeRatio;
    const y = y1 + dy * safeRatio;
    return {
      x: Number(this._number(x - Math.sin(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
      y: Number(this._number(y + Math.cos(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
    };
  }

  _memoryPathRightEdgeFromPoints(points) {
    return this._memoryPathRightEdgeFromRange(this._rangeFromOpenPoints(points));
  }

  _memoryPathRightEdgeFromRange(range) {
    if (!Array.isArray(range) || range.length < 2) {
      return [];
    }

    return range.map((point) => {
      const phi = Number(point.phi) || 0;
      return {
        x: Number(this._number(Number(point.x) - Math.sin(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
        y: Number(this._number(Number(point.y) + Math.cos(phi) * MEMORY_PATH_HALF_WIDTH_METERS)),
        phi: Number(this._number(phi)),
      };
    });
  }

  _renderPathwayDraftShapes() {
    if (
      (this._activeEditTool !== "pa"
        && this._activeEditTool !== "mp"
        && this._activeEditTool !== "pathway-edit"
        && this._activeEditTool !== "pathway-move"
        && this._activeEditTool !== "ng"
        && this._activeEditTool !== "nogozone-edit"
        && this._activeEditTool !== "nogozone-move")
      || !this._pathwayDraftPoints.length
    ) {
      return "";
    }

    const isNoGoZone = this._pathwayDraftKind === "nogozone";
    const isMemoryPath = this._pathwayDraftKind === "sidewalk";
    const noGoClosedPoints = isNoGoZone && this._pathwayDraftPoints.length >= 2
      ? [...this._pathwayDraftPoints, this._pathwayDraftPoints[0]]
      : [];
    const polyline = this._pathwayDraftPoints.length >= 2
      ? isNoGoZone
        ? this._pathwayDraftPoints.length >= 3
          ? `
          <polygon
            points="${this._escape(this._svgPoints(this._pathwayDraftPoints))}"
            fill="rgba(255, 0, 0, 0.16)"
            stroke="rgba(255, 0, 0, 0.95)"
            stroke-width="2.2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          ></polygon>
        `
          : `
          <polyline
            points="${this._escape(this._svgPoints(noGoClosedPoints))}"
            fill="none"
            stroke="rgba(255, 0, 0, 0.95)"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          ></polyline>
        `
        : isMemoryPath
          ? `
          <polyline
            points="${this._escape(this._svgPoints(this._pathwayDraftPoints))}"
            fill="none"
            stroke="rgba(56, 189, 248, 0.24)"
            stroke-width="${this._number(MEMORY_PATH_WIDTH_METERS)}"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></polyline>
          <polyline
            points="${this._escape(this._svgPoints(this._pathwayDraftPoints))}"
            fill="none"
            stroke="rgba(14, 165, 233, 0.95)"
            stroke-width="0.06"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></polyline>
          ${this._memoryPathDraftEdgePoints().map((edge) => `
            <polyline
              points="${this._escape(this._svgPoints(edge.points))}"
              fill="none"
              stroke="#facc15"
              stroke-width="0.08"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></polyline>
          `).join("")}
        `
        : `
          <polyline
            points="${this._escape(this._svgPoints(this._pathwayDraftPoints))}"
            fill="none"
            stroke="rgba(34, 211, 238, 0.95)"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          ></polyline>
        `
      : "";
    const markers = isMemoryPath && this._memoryPathTrimmerMode
      ? this._renderMemoryPathTrimmerMarkers()
      : this._pathwayDraftPoints
        .map((point, index) => {
          const displayPoint = this._displayPoint(point);
          const selectedPoint = index === this._selectedDraftPointIndex;
          return `
            <circle
              cx="${this._number(displayPoint.x)}"
              cy="${this._number(displayPoint.y)}"
              r="${selectedPoint ? "0.22" : "0.16"}"
              fill="${selectedPoint ? "#ffffff" : index === 0 ? "rgba(255, 255, 255, 0.95)" : isNoGoZone ? "rgba(255, 0, 0, 0.95)" : isMemoryPath ? "#facc15" : "rgba(34, 211, 238, 0.95)"}"
              stroke="${selectedPoint ? "rgba(15, 23, 42, 0.95)" : "rgba(15, 23, 42, 0.7)"}"
              stroke-width="${selectedPoint ? "0.06" : "0.04"}"
              vector-effect="non-scaling-stroke"
            ></circle>
          `;
        })
        .join("");

    return `${polyline}${markers}`;
  }

  _renderMemoryPathTrimmerMarkers() {
    if (!Array.isArray(this._pathwayDraftTrimmingEdges)) {
      return "";
    }

    return this._pathwayDraftTrimmingEdges
      .map((edge, edgeIndex) => {
        const selectedEdge = edgeIndex === this._selectedTrimmingEdgeIndex;
        const points = Array.isArray(edge.points) ? edge.points : [];
        return points
          .map((point, pointIndex) => {
            const selectedPoint =
              selectedEdge
              && this._selectedTrimmingSelectionKind === "point"
              && pointIndex === this._selectedTrimmingPointIndex;
            const displayPoint = this._displayPoint(point);
            return `
              <circle
                cx="${this._number(displayPoint.x)}"
                cy="${this._number(displayPoint.y)}"
                r="${selectedPoint ? "0.22" : selectedEdge ? "0.18" : "0.15"}"
                fill="${selectedPoint ? "#ffffff" : selectedEdge ? "#fef08a" : "#facc15"}"
                stroke="${selectedEdge ? "rgba(15, 23, 42, 0.95)" : "rgba(15, 23, 42, 0.62)"}"
                stroke-width="${selectedPoint ? "0.06" : "0.04"}"
                vector-effect="non-scaling-stroke"
              ></circle>
            `;
          })
          .join("");
      })
      .join("");
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
    let heading = null;
    const statusState = entry.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    if (statusState?.attributes?.heading !== null && statusState?.attributes?.heading !== undefined) {
      heading = statusState.attributes.heading;
      return this._applyStationaryHeadingLock(entry, heading);
    }

    const trackerState = entry.tracker_entity_id
      ? this._hass?.states?.[entry.tracker_entity_id]
      : null;
    if (trackerState?.attributes?.heading !== null && trackerState?.attributes?.heading !== undefined) {
      heading = trackerState.attributes.heading;
      return this._applyStationaryHeadingLock(entry, heading);
    }

    if (entry.summary?.heading !== null && entry.summary?.heading !== undefined) {
      heading = entry.summary.heading;
      return this._applyStationaryHeadingLock(entry, heading);
    }

    if (
      entry.summary?.combined_odom_heading !== null &&
      entry.summary?.combined_odom_heading !== undefined
    ) {
      heading = entry.summary.combined_odom_heading;
      return this._applyStationaryHeadingLock(entry, heading);
    }

    return this._applyStationaryHeadingLock(entry, heading);
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

    const correctedPoint = {
      x:
        Number(point.x)
        + forward.x * this._gpsCalibration.longitudinal
        + perpendicular.x * this._gpsCalibration.lateral,
      y:
        Number(point.y)
        + forward.y * this._gpsCalibration.longitudinal
        + perpendicular.y * this._gpsCalibration.lateral,
    };

    return this._applyStationaryLock(entry, correctedPoint);
  }

  _applyStationaryLock(entry, point) {
    if (!point) {
      return null;
    }

    if (!this._entryIsStationary(entry)) {
      this._stationaryLockPoint = null;
      return point;
    }

    if (!this._stationaryLockPoint) {
      this._stationaryLockPoint = {
        x: Number(point.x),
        y: Number(point.y),
      };
    }

    return {
      x: Number(this._stationaryLockPoint.x),
      y: Number(this._stationaryLockPoint.y),
    };
  }

  _applyStationaryHeadingLock(entry, heading) {
    if (!this._entryIsStationary(entry)) {
      this._stationaryLockHeading = null;
      return heading;
    }

    const numericHeading = Number(heading);
    if (Number.isFinite(numericHeading) && this._stationaryLockHeading === null) {
      this._stationaryLockHeading = numericHeading;
    }

    return this._stationaryLockHeading ?? heading;
  }

  _entryIsStationary(entry) {
    const [leftWheelSpeed, rightWheelSpeed] = this._entryWheelSpeeds(entry);
    if (!Number.isFinite(leftWheelSpeed) || !Number.isFinite(rightWheelSpeed)) {
      return false;
    }

    return Math.abs(leftWheelSpeed) <= 0.001 && Math.abs(rightWheelSpeed) <= 0.001;
  }

  _entryWheelSpeeds(entry) {
    const statusState = entry?.status_entity_id
      ? this._hass?.states?.[entry.status_entity_id]
      : null;
    const statusAttrs = statusState?.attributes || null;
    const statusLeft = Number(statusAttrs?.left_wheel_speed);
    const statusRight = Number(statusAttrs?.right_wheel_speed);
    if (Number.isFinite(statusLeft) && Number.isFinite(statusRight)) {
      return [statusLeft, statusRight];
    }

    const summaryLeft = Number(entry?.summary?.left_wheel_speed);
    const summaryRight = Number(entry?.summary?.right_wheel_speed);
    if (Number.isFinite(summaryLeft) && Number.isFinite(summaryRight)) {
      return [summaryLeft, summaryRight];
    }

    return [Number.NaN, Number.NaN];
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
    const [leftWheelSpeed, rightWheelSpeed] = this._entryWheelSpeeds(entry);
    if (Number.isFinite(leftWheelSpeed) && Number.isFinite(rightWheelSpeed)) {
      return leftWheelSpeed < 0 && rightWheelSpeed < 0;
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

if (!customElements.get("s2jyarbo-map-widget")) {
  customElements.define("s2jyarbo-map-widget", S2JYarboMapCard);
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
    description: "S2JYarbo map view and map editing controls.",
    preview: false,
  });
}
